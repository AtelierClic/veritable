import { INTEREST_GROUPS, NationId } from "../../data/schemas/common";
import {
  EventCondition,
  EventEffect,
  VeritableEvent,
} from "../../data/schemas/event";
import { GoodId } from "../../data/schemas/goods";
import { NationData } from "../../data/schemas/nation";
import {
  DiplomacyState,
  EconomyState,
  EventInstance,
  EventsState,
  MilitaryState,
  NationState,
  NuclearState,
  PoliticsState,
  TerritoryState,
} from "../../data/schemas/save";
import { addRelation, enemiesOf, relation } from "../diplomacy/diplomacy";
import { deficitToGdp } from "../economy/budget";
import { EconomyContext } from "../economy/context";
import { addMonths } from "../politics/state";
import { Rng } from "../rng";

// Events (J5): one trigger engine for the scripted events of 2026-2030 and
// the procedural templates. Once a game month, for every event and every
// nation it may concern: the date window, the once / cooldown rule, the
// conditions on the state, then the monthly probability. A world event
// happens once in the world. The player answers in a pop-up (at most
// `maxPopupsPerMonth` a month; the others wait for the next month); an
// unanswered pop-up is decided by the government after `answerMonths`. The
// AI chooses by its agenda. Effects: data/schemas/event.ts.

export interface EventsEnv {
  ctx: EconomyContext;
  rng: Rng;
  events: EventsState;
  economy: EconomyState;
  politics: PoliticsState;
  diplomacy: DiplomacyState;
  military: MilitaryState;
  nuclear: NuclearState;
  territory: TerritoryState;
  nations: readonly NationState[];
  sheets: ReadonlyMap<NationId, NationData>;
  // The nation of the player when it plays (null in autopilot): its events
  // are pop-ups.
  player: NationId | null;
  date: string;
}

export type EventsEvent =
  | { type: "event-occurred"; nation: NationId; params: Record<string, string> }
  | { type: "event-popup"; nation: NationId; instance: EventInstance };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function initEvents(): EventsState {
  return {
    nextId: 1,
    pending: [],
    history: [],
    fired: {},
    cooldowns: {},
    growth: [],
    popupMonth: "",
    popups: 0,
  };
}

export function eventData(ctx: EconomyContext, id: string): VeritableEvent {
  const event = ctx.events.find((e) => e.id === id);
  if (event === undefined) throw new Error(`unknown event ${id}`);
  return event;
}

// Extra trend growth of a nation from its events (per year).
export function eventGrowth(events: EventsState, nation: NationId): number {
  let g = 0;
  for (const m of events.growth) if (m.nation === nation) g += m.value;
  return g;
}

// --- conditions ------------------------------------------------------------

export function conditionValue(
  env: EventsEnv,
  nation: NationId,
  target: string,
): number | string {
  const { ctx } = env;
  const e = env.economy.nations[nation];
  const p = env.politics.nations[nation];
  const [head, tail] = target.split(".");
  switch (head) {
    case "stability":
      return p.stability;
    case "opinion":
      return p.opinion;
    case "legitimacy":
      return p.legitimacy;
    case "exhaustion":
      return env.military.nations[nation]?.exhaustion ?? 0;
    case "debtToGdp":
      return e.debt / e.gdp;
    case "deficitToGdp":
      return deficitToGdp(e);
    case "growth":
      return e.growthAnnual;
    case "shortage":
      return e.shortage;
    case "coverage":
      return e.coverage[tail as GoodId];
    case "price":
      return (
        env.economy.market.prices[tail as GoodId] /
        ctx.good(tail as GoodId).basePrice
      );
    case "atWar":
      return enemiesOf(env.diplomacy, nation).length > 0 ? 1 : 0;
    case "unrest":
      return p.unrest ? 1 : 0;
    case "democratic":
      return ctx.regime(p.regime).democratic ? 1 : 0;
    case "nuclear":
      return (env.nuclear.nations[nation]?.warheads ?? 0) > 0 ? 1 : 0;
    case "player":
      return nation === env.player ? 1 : 0;
    case "lostTiles": {
      const start = env.territory.initialTiles[nation] ?? 0;
      const now = env.nations.find((n) => n.id === nation)?.tileCount ?? 0;
      return start > 0 ? Math.max(0, 1 - now / start) : 0;
    }
    case "gdpPerCapita":
      return e.gdp / (env.sheets.get(nation)?.population.value ?? 1);
    case "regime":
      return p.regime;
    case "bloc":
      return ctx.blocsOf(nation).includes(tail) ? 1 : 0;
  }
  throw new Error(`unknown event condition ${target}`);
}

function holds(env: EventsEnv, nation: NationId, c: EventCondition): boolean {
  const v = conditionValue(env, nation, c.target);
  switch (c.op) {
    case "eq":
      return v === c.value;
    case "ne":
      return v !== c.value;
    case "lt":
      return v < c.value;
    case "le":
      return v <= c.value;
    case "gt":
      return v > c.value;
    case "ge":
      return v >= c.value;
  }
}

// --- effects ---------------------------------------------------------------

function otherOf(
  env: EventsEnv,
  nation: NationId,
  kind: "neighbor" | "any" | "rival",
): NationId | null {
  const others = env.ctx.nationIds.filter((n) => n !== nation);
  if (kind === "rival") {
    let worst: NationId | null = null;
    for (const n of others) {
      if (
        worst === null ||
        relation(env.diplomacy, nation, n) <
          relation(env.diplomacy, nation, worst)
      )
        worst = n;
    }
    return worst;
  }
  const pool =
    kind === "neighbor"
      ? others.filter((n) => env.ctx.landNeighbours(nation, n))
      : others;
  return pool.length === 0 ? null : env.rng.pick(pool);
}

function goodOf(
  env: EventsEnv,
  kind: "any" | "energy" | "food" | "industrial",
): string {
  const goods = env.ctx.goods.filter((g) =>
    kind === "any"
      ? true
      : kind === "food"
        ? g.id === "food"
        : kind === "energy"
          ? ["oil", "gas", "coal", "electricity"].includes(g.id)
          : g.industrial === true,
  );
  return env.rng.pick(goods.length > 0 ? goods : env.ctx.goods).id;
}

export function applyEffects(
  env: EventsEnv,
  nation: NationId,
  other: NationId | null,
  effects: readonly EventEffect[],
): void {
  const { ctx } = env;
  const cfg = ctx.config.events;
  const opinionWeight = ctx.config.politics.stability.opinion;
  for (const effect of effects) {
    if (effect.uncertain === true && !env.rng.chance(cfg.uncertainProbability))
      continue;
    const [head, tail] = effect.target.split(".");
    const e = env.economy.nations[nation];
    const p = env.politics.nations[nation];
    // Opinion shocks: on every group of the player's nation, on the proxy of
    // an AI nation (both converge back week by week).
    const shockOpinion = (delta: number) => {
      if (p.groups !== null) {
        for (const g of INTEREST_GROUPS)
          p.groups[g] = clamp01(p.groups[g] + delta);
      }
      p.opinion = clamp01(p.opinion + delta);
    };
    switch (head) {
      case "budget":
        e.debt -= effect.value * e.gdp;
        break;
      case "gdp":
        e.gdp *= effect.value;
        break;
      case "growth":
        env.events.growth.push({
          nation,
          value: effect.value,
          until: addMonths(env.date, effect.months ?? 12),
        });
        break;
      case "stability":
        shockOpinion(effect.value / opinionWeight);
        break;
      case "opinion":
        shockOpinion(effect.value);
        break;
      case "legitimacy":
        p.legitimacy = clamp01(p.legitimacy + effect.value);
        break;
      case "exhaustion": {
        const m = env.military.nations[nation];
        if (m !== undefined)
          m.exhaustion = clamp01(m.exhaustion + effect.value);
        break;
      }
      case "group":
        if (p.groups !== null) {
          const g = tail as (typeof INTEREST_GROUPS)[number];
          p.groups[g] = clamp01(p.groups[g] + effect.value);
        }
        break;
      case "capital":
        p.capital = Math.max(0, p.capital + effect.value);
        break;
      case "production":
        e.production[tail as GoodId] *= effect.value;
        break;
      case "consumption":
        e.consumption[tail as GoodId] *= effect.value;
        break;
      case "worldSupply":
        env.economy.market.rowSupplyShock[tail as GoodId] += effect.value;
        break;
      case "spending": {
        const post = tail as "defense" | "research";
        const max = ctx.config.budget.maxSpendingShare;
        e.spending[post] = Math.min(
          max,
          Math.max(0, e.spending[post] + effect.value),
        );
        e.spendingTargets[post] = Math.min(
          max,
          Math.max(0, e.spendingTargets[post] + effect.value),
        );
        break;
      }
      case "unrest": {
        // Stability (recomputed weekly) goes under the unrest threshold:
        // opinion first, then legitimacy for what opinion cannot carry
        // (it comes back slowly: the unrest lasts).
        const s = ctx.config.politics.stability;
        let gap = p.stability - (s.unrestThreshold - cfg.unrestMargin);
        if (gap <= 0) break;
        const fromOpinion = Math.min(gap, p.opinion * opinionWeight);
        shockOpinion(-fromOpinion / opinionWeight);
        gap -= fromOpinion;
        if (gap > 0) {
          p.legitimacy = clamp01(p.legitimacy - gap / s.legitimacy);
        }
        break;
      }
      case "relations": {
        const targets =
          tail === "all"
            ? ctx.nationIds.filter((n) => n !== nation)
            : tail === "neighbors"
              ? ctx.nationIds.filter(
                  (n) => n !== nation && ctx.landNeighbours(nation, n),
                )
              : tail === "other"
                ? other === null
                  ? []
                  : [other]
                : ctx.nationIds.includes(tail) && tail !== nation
                  ? [tail]
                  : [];
        for (const n of targets)
          addRelation(env.diplomacy, nation, n, effect.value);
        break;
      }
      case "grievance": {
        const against = tail === "other" ? other : tail;
        if (
          against === null ||
          against === nation ||
          !ctx.nationIds.includes(against)
        )
          break;
        env.diplomacy.grievances = env.diplomacy.grievances.filter(
          (g) => !(g.by === nation && g.against === against),
        );
        env.diplomacy.grievances.push({
          by: nation,
          against,
          until: addMonths(env.date, effect.months ?? cfg.grievanceMonths),
        });
        break;
      }
    }
  }
}

// --- choices ---------------------------------------------------------------

function agenda(env: EventsEnv, nation: NationId, goal: string): number {
  const list = env.sheets.get(nation)?.aiAgenda;
  if (list === undefined) return 0.25;
  return list.find((g) => g.goal === goal)?.weight ?? 0;
}

// What a choice is worth to a government: stability first, then money and
// growth (growth goal), relations (influence), arms (security); an
// aggressive leader likes a grievance. Uncertain effects count half.
export function choiceScore(
  env: EventsEnv,
  nation: NationId,
  effects: readonly EventEffect[],
): number {
  const w = env.ctx.config.events.ai;
  const growth = 0.5 + agenda(env, nation, "growth");
  const security = 0.5 + agenda(env, nation, "security");
  const influence = 0.5 + agenda(env, nation, "regional-influence");
  const aggressiveness =
    env.politics.nations[nation]?.leader.traits.aggressiveness ?? 0.5;
  let score = 0;
  for (const effect of effects) {
    const [head] = effect.target.split(".");
    const odds = effect.uncertain === true ? 0.5 : 1;
    let s = 0;
    switch (head) {
      case "stability":
      case "opinion":
      case "legitimacy":
        s = w.stability * effect.value;
        break;
      case "exhaustion":
        s = -w.stability * effect.value;
        break;
      case "budget":
        s = w.budget * effect.value * growth;
        break;
      case "gdp":
        s = w.budget * (effect.value - 1) * growth;
        break;
      case "growth":
        s = w.budget * effect.value * ((effect.months ?? 12) / 12) * growth;
        break;
      case "production":
        s = w.capacity * (effect.value - 1) * growth;
        break;
      case "consumption":
        s = -w.capacity * (effect.value - 1) * growth;
        break;
      case "relations":
        s = w.relations * effect.value * influence;
        break;
      case "grievance":
        s = w.grievance * (aggressiveness - 0.5) * security;
        break;
      case "spending":
        s =
          effect.target === "spending.defense"
            ? w.military * effect.value * (security - 0.75)
            : w.budget * effect.value * 0.5;
        break;
      case "unrest":
        s = -w.unrest;
        break;
      case "group":
        s = w.group * effect.value;
        break;
      case "capital":
        s = (w.group * effect.value) / 100;
        break;
    }
    score += odds * s;
  }
  return score;
}

// The best choice for the government; sometimes another one (governments
// err).
export function aiChoice(
  env: EventsEnv,
  nation: NationId,
  event: VeritableEvent,
): string {
  let best = event.choices[0];
  let bestScore = choiceScore(env, nation, best.effects);
  for (const choice of event.choices.slice(1)) {
    const score = choiceScore(env, nation, choice.effects);
    if (score > bestScore) {
      best = choice;
      bestScore = score;
    }
  }
  const others = event.choices.filter((c) => c.id !== best.id);
  if (
    others.length > 0 &&
    env.rng.chance(env.ctx.config.events.aiMistakeProbability)
  ) {
    return env.rng.pick(others).id;
  }
  return best.id;
}

function resolve(
  env: EventsEnv,
  instance: EventInstance,
  choiceId: string,
): EventsEvent {
  const event = eventData(env.ctx, instance.event);
  const choice =
    event.choices.find((c) => c.id === choiceId) ?? event.choices[0];
  applyEffects(env, instance.nation, instance.other, choice.effects);
  const history = env.events.history;
  history.push({ ...instance, choice: choice.id });
  if (history.length > env.ctx.config.events.historyKept) history.shift();
  return {
    type: "event-occurred",
    nation: instance.nation,
    params: {
      event: event.id,
      choice: choice.id,
      other: instance.other ?? "",
      good: instance.good ?? "",
    },
  };
}

// The player's answer to a pop-up.
export function chooseEvent(
  env: EventsEnv,
  id: number,
  choice: string,
): EventsEvent[] {
  const at = env.events.pending.findIndex((p) => p.id === id);
  if (at < 0) throw new Error("event-choose: no such pending event");
  const [pending] = env.events.pending.splice(at, 1);
  const event = eventData(env.ctx, pending.event);
  if (!event.choices.some((c) => c.id === choice)) {
    throw new Error("event-choose: no such choice");
  }
  const { deadline, ...instance } = pending;
  void deadline;
  return [resolve(env, instance, choice)];
}

// --- the monthly step --------------------------------------------------------

export function stepEventsMonth(env: EventsEnv): EventsEvent[] {
  const { ctx, events, date } = env;
  const cfg = ctx.config.events;
  const out: EventsEvent[] = [];
  const month = date.slice(0, 7);
  if (events.popupMonth !== month) {
    events.popupMonth = month;
    events.popups = 0;
  }
  // Expired effects and grievances.
  events.growth = events.growth.filter((m) => date < m.until);
  env.diplomacy.grievances = env.diplomacy.grievances.filter(
    (g) => date < g.until,
  );
  for (const [key, until] of Object.entries(events.cooldowns)) {
    if (date >= until) delete events.cooldowns[key];
  }
  // Pop-ups nobody answered: the government decides.
  for (const pending of [...events.pending]) {
    if (date < pending.deadline) continue;
    events.pending.splice(events.pending.indexOf(pending), 1);
    const { deadline, ...instance } = pending;
    void deadline;
    out.push(
      resolve(
        env,
        instance,
        aiChoice(env, instance.nation, eventData(ctx, instance.event)),
      ),
    );
  }

  // J6c: lookups by set (at 208 nations, lists cost milliseconds a month).
  const known = new Set(ctx.nationIds);
  for (const event of ctx.events) {
    const t = event.trigger;
    if (
      t.dateRange !== undefined &&
      (date < t.dateRange[0] || date > t.dateRange[1])
    )
      continue;
    const once = t.once ?? event.kind === "scripted";
    const cooldown = t.cooldownMonths ?? (once ? 0 : cfg.defaultCooldownMonths);
    const subjects =
      event.scope === "world"
        ? ["world"]
        : t.nations === undefined
          ? ctx.nationIds
          : t.nations.filter((n) => known.has(n));
    const fired = new Set(events.fired[event.id] ?? []);
    for (const subject of subjects) {
      if (once && fired.has(subject)) continue;
      if (events.cooldowns[`${event.id}|${subject}`] !== undefined) continue;
      const nation = subject === "world" ? env.player : subject;
      if (nation !== null && !t.conditions.every((c) => holds(env, nation, c)))
        continue;
      // The player's events wait when its pop-ups of the month are spent.
      const popup =
        nation !== null && nation === env.player && event.choices.length > 0;
      if (popup && events.popups >= cfg.maxPopupsPerMonth) continue;
      if (!env.rng.chance(t.monthlyProbability)) continue;
      const other =
        event.params?.other === undefined || nation === null
          ? null
          : otherOf(env, nation, event.params.other);
      if (event.params?.other !== undefined && other === null) continue;
      const good =
        event.params?.good === undefined
          ? null
          : goodOf(env, event.params.good);

      if (once) (events.fired[event.id] ??= []).push(subject);
      if (cooldown > 0) {
        events.cooldowns[`${event.id}|${subject}`] = addMonths(date, cooldown);
      }
      if (event.worldEffects !== undefined) {
        applyEffects(
          env,
          nation ?? ctx.nationIds[0],
          other,
          event.worldEffects.filter((e) => e.target.startsWith("worldSupply")),
        );
        if (nation !== null) {
          applyEffects(
            env,
            nation,
            other,
            event.worldEffects.filter(
              (e) => !e.target.startsWith("worldSupply"),
            ),
          );
        }
      }
      if (nation !== null && event.effects !== undefined) {
        applyEffects(env, nation, other, event.effects);
      }
      if (nation === null) {
        // A world event in autopilot: nobody chooses.
        out.push({
          type: "event-occurred",
          nation: ctx.nationIds[0],
          params: { event: event.id, choice: "", other: "", good: good ?? "" },
        });
        continue;
      }
      const instance: EventInstance = {
        id: events.nextId++,
        event: event.id,
        nation,
        other,
        good,
        date,
      };
      if (popup) {
        events.popups += 1;
        const pending = {
          ...instance,
          deadline: addMonths(date, cfg.answerMonths),
        };
        events.pending.push(pending);
        out.push({ type: "event-popup", nation, instance });
      } else {
        out.push(resolve(env, instance, aiChoice(env, nation, event)));
      }
    }
  }
  return out;
}
