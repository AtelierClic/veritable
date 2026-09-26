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
import { windowDistance } from "../politics/ideology";
import { enactLaw } from "../politics/laws";
import { addMonths } from "../politics/state";
import { Rng } from "../rng";
import { addDays, chanceOver, daysInMonth } from "../time";

// Events (J5): one trigger engine for the scripted events of 2026-2030 and
// the procedural templates. J7: every game day (until the J6, once a month
// on the 1st), for every event and every nation it may concern: the date
// window, the once / cooldown rule, the probability of the day (the
// monthly one spread over the days of the month), then the conditions on
// the state. A world event happens once in the world. The player answers a
// card (at most `maxPopupsPerMonth` decisions a month; the others wait for
// the next month); unanswered after `answerDays`, its government decides
// (governmentChoice). The AI chooses by its agenda and its ideology.
// Effects: data/schemas/event.ts.

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
  // Seed of the campaign: the tie-break of a government, the day of a sure
  // event (J7).
  seed: number;
  // The nations and their index, cached by the caller (J7).
  known?: ReadonlySet<NationId>;
  nationIndex?: ReadonlyMap<NationId, number>;
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
      return e.gdp / Math.max(1, e.population);
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
  kind: "neighbor" | "tense-neighbor" | "any" | "rival",
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
  const tense = env.ctx.config.events.tenseNeighbourRelations;
  const pool =
    kind === "neighbor"
      ? others.filter((n) => env.ctx.landNeighbours(nation, n))
      : kind === "tense-neighbor"
        ? others.filter(
            (n) =>
              env.ctx.landNeighbours(nation, n) &&
              relation(env.diplomacy, nation, n) <= tense,
          )
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
      case "law": {
        // J7: an event may enact a law, capital aside (the regime, its
        // domains and the window of the government still decide).
        const law = ctx.laws.find((l) => l.id === tail);
        if (law === undefined) break;
        const capital = p.capital;
        p.capital += law.capitalCost;
        enactLaw(ctx, nation, p, e, law, env.date);
        p.capital = Math.min(capital, p.capital);
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

// What a government brings to an event choice (J7): its ideology and the
// aggressiveness of the leader in play.
export interface ChoiceTraits {
  economic: number;
  authority: number;
  sovereignty: number;
  aggressiveness: number;
}

// The traits a government decides with: the ideology of the party of the
// head of government (the leading party of the government), or, without a
// party (a junta, a monarch), the traits of the leader in play.
export function governmentTraits(
  env: EventsEnv,
  nation: NationId,
): ChoiceTraits {
  const p = env.politics.nations[nation];
  if (p === undefined) {
    return { economic: 0, authority: 0, sovereignty: 0, aggressiveness: 0.5 };
  }
  const lead = p.parties.find((x) => x.id === p.government.parties[0]);
  const ideology = lead?.ideology ?? p.leader.traits;
  return {
    economic: ideology.economic,
    authority: ideology.authority,
    sovereignty: ideology.sovereignty,
    aggressiveness: p.leader.traits.aggressiveness,
  };
}

// The party a government decides for, or null (no party).
// The traits an AI nation chooses its own events with (J7a.7): its
// leader's aggressiveness, no ideology — the scoring of the J5 to the J6.
// The ideology of the government shades the choice its government makes
// for the player (governmentChoice) only: applied to every AI nation, it
// made the sovereignist governments of the world take every grievance
// (Russia three times as many against Ukraine, a war every six to eight
// years on europe-10).
export function aiTraits(env: EventsEnv, nation: NationId): ChoiceTraits {
  return {
    economic: 0,
    authority: 0,
    sovereignty: 0,
    aggressiveness:
      env.politics.nations[nation]?.leader.traits.aggressiveness ?? 0.5,
  };
}

export function governmentParty(
  env: EventsEnv,
  nation: NationId,
): string | null {
  const p = env.politics.nations[nation];
  if (p === undefined) return null;
  const lead = p.government.parties[0];
  return lead !== undefined && p.parties.some((x) => x.id === lead)
    ? lead
    : null;
}

// What a choice is worth to a government: stability first, then money and
// growth (growth goal), relations (influence), arms (security); an
// aggressive leader likes a grievance. Uncertain effects count half. J7: the
// ideology of the government shades the weights — the right values money,
// the left the groups, a sovereignist cares less for relations abroad and
// more for a grievance, an authoritarian more for defence and less about
// unrest.
export function choiceScore(
  env: EventsEnv,
  nation: NationId,
  effects: readonly EventEffect[],
  traits: ChoiceTraits = aiTraits(env, nation),
): number {
  const w = env.ctx.config.events.ai;
  const shade = env.ctx.config.events.ideology;
  const growth = 0.5 + agenda(env, nation, "growth");
  const security = 0.5 + agenda(env, nation, "security");
  const influence = 0.5 + agenda(env, nation, "regional-influence");
  const money = 1 + shade.economic * traits.economic;
  const groups = 1 - shade.economic * traits.economic;
  const abroad = 1 - shade.sovereignty * traits.sovereignty;
  const force = 1 + shade.authority * traits.authority;
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
        s = w.budget * effect.value * growth * money;
        break;
      case "gdp":
        s = w.budget * (effect.value - 1) * growth * money;
        break;
      case "growth":
        s =
          w.budget *
          effect.value *
          ((effect.months ?? 12) / 12) *
          growth *
          money;
        break;
      case "production":
        s = w.capacity * (effect.value - 1) * growth;
        break;
      case "consumption":
        s = -w.capacity * (effect.value - 1) * growth;
        break;
      case "relations":
        s = w.relations * effect.value * influence * abroad;
        break;
      case "grievance":
        s =
          w.grievance *
          (traits.aggressiveness -
            0.5 +
            shade.sovereignty * traits.sovereignty) *
          security;
        break;
      case "spending":
        s =
          effect.target === "spending.defense"
            ? w.military * effect.value * (security - 0.75) * force
            : w.budget * effect.value * 0.5;
        break;
      case "unrest":
        s = -w.unrest * (2 - force);
        break;
      case "group":
        s = w.group * effect.value * groups;
        break;
      case "capital":
        s = (w.group * effect.value) / 100;
        break;
    }
    score += odds * s;
  }
  return score;
}

// The laws a choice would enact outside the window of the government's
// ideology (J7): the government sets such a choice aside.
function outsideWindow(
  env: EventsEnv,
  nation: NationId,
  effects: readonly EventEffect[],
): number {
  const p = env.politics.nations[nation];
  if (p === undefined) return 0;
  let distance = 0;
  for (const effect of effects) {
    if (!effect.target.startsWith("law.")) continue;
    const law = env.ctx.laws.find((l) => l.id === effect.target.slice(4));
    if (law === undefined) continue;
    distance += windowDistance(law.window, p.government.ideology);
  }
  return distance;
}

// A number from the seed of the campaign, an instance and a choice: the
// tie-break of the government.
function tieBreak(env: EventsEnv, instance: number, choice: string): number {
  let h = (2166136261 ^ env.seed) >>> 0;
  const key = `${instance}|${choice}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

// The choice of a government for an event (J7): the best for its traits
// among the choices that enact no law outside its window (when none is
// left, the closest to it), ties broken by the seed. The player's
// government takes it when the player has not chosen in time, and the card
// shows it from the start ("the government leans towards").
export function governmentChoice(
  env: EventsEnv,
  nation: NationId,
  event: VeritableEvent,
  instance: number,
): string {
  const traits = governmentTraits(env, nation);
  const scored = event.choices.map((c) => ({
    id: c.id,
    outside: outsideWindow(env, nation, c.effects),
    score: choiceScore(env, nation, c.effects, traits),
  }));
  const closest = Math.min(...scored.map((c) => c.outside));
  const allowed = scored.filter((c) => c.outside === closest);
  allowed.sort(
    (a, b) =>
      b.score - a.score ||
      tieBreak(env, instance, a.id) - tieBreak(env, instance, b.id),
  );
  return allowed[0].id;
}

// The choice of an AI nation: its government's, and sometimes another one
// (governments err).
export function aiChoice(
  env: EventsEnv,
  nation: NationId,
  event: VeritableEvent,
): string {
  const traits = aiTraits(env, nation);
  let best = event.choices[0];
  let bestScore = choiceScore(env, nation, best.effects, traits);
  for (const choice of event.choices.slice(1)) {
    const score = choiceScore(env, nation, choice.effects, traits);
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

// Who took a choice (J7, the journal): the player, its government when the
// player did not choose in time, an AI nation.
export type ChosenBy = "player" | "government" | "ai" | "none";

function resolve(
  env: EventsEnv,
  instance: EventInstance,
  choiceId: string,
  by: ChosenBy,
): EventsEvent {
  const event = eventData(env.ctx, instance.event);
  const choice =
    event.choices.find((c) => c.id === choiceId) ?? event.choices[0];
  applyEffects(env, instance.nation, instance.other, choice.effects);
  const history = env.events.history;
  history.push({ ...instance, choice: choice.id });
  if (history.length > env.ctx.config.events.historyKept) history.shift();
  const party =
    by === "government" ? governmentParty(env, instance.nation) : null;
  return {
    type: "event-occurred",
    nation: instance.nation,
    params: {
      event: event.id,
      choice: choice.id,
      other: instance.other ?? "",
      good: instance.good ?? "",
      by,
      party: party ?? "",
      instance: String(instance.id),
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
  return [resolve(env, instance, choice, "player")];
}

// --- the daily steps (J7) ------------------------------------------------------

// Once a game day: expired effects and grievances, cooldowns over, and the
// pop-ups the player left unanswered past their deadline, which its
// government decides.
export function stepEventsHousekeeping(env: EventsEnv): EventsEvent[] {
  const { ctx, events, date } = env;
  const out: EventsEvent[] = [];
  const month = date.slice(0, 7);
  if (events.popupMonth !== month) {
    events.popupMonth = month;
    events.popups = 0;
  }
  events.growth = events.growth.filter((m) => date < m.until);
  env.diplomacy.grievances = env.diplomacy.grievances.filter(
    (g) => date < g.until,
  );
  for (const [key, until] of Object.entries(events.cooldowns)) {
    if (date >= until) delete events.cooldowns[key];
  }
  for (const pending of [...events.pending]) {
    if (date < pending.deadline) continue;
    events.pending.splice(events.pending.indexOf(pending), 1);
    const { deadline, ...instance } = pending;
    void deadline;
    const event = eventData(ctx, instance.event);
    out.push(
      resolve(
        env,
        instance,
        governmentChoice(env, instance.nation, event, instance.id),
        "government",
      ),
    );
  }
  return out;
}

// The day of the month a sure event (probability 1 a month) falls on: drawn
// from the seed, the event and the subject (J7: "a scripted event dated to
// the month falls on a day drawn with the seed").
function seededDay(env: EventsEnv, event: string, subject: string): number {
  let h = (2166136261 ^ env.seed) >>> 0;
  const key = `${event}|${subject}|${env.date.slice(0, 7)}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return 1 + (h % daysInMonth(env.date));
}

// Number of successes among n draws of probability p (by inversion: p is
// small, a success is rare).
function binomial(n: number, p: number, rng: Rng): number {
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n;
  const q = 1 - p;
  let pk = Math.pow(q, n);
  let cumulative = pk;
  const u = rng.next();
  let k = 0;
  while (u > cumulative && k < n) {
    pk *= ((n - k) / (k + 1)) * (p / q);
    k++;
    cumulative += pk;
  }
  return k;
}

// `k` distinct items of a list drawn at random, in the order of the list.
function drawDistinct<T>(items: readonly T[], k: number, rng: Rng): T[] {
  if (k >= items.length) return [...items];
  const picked = new Set<number>();
  while (picked.size < k) picked.add(rng.nextInt(0, items.length));
  return [...picked].sort((a, b) => a - b).map((i) => items[i]);
}

// The draws of the day for the subjects of one slot: the draws of a day are
// spread over the ticks of the day, subject k drawing at the slot k % slots
// (the world's at slot 0). Probability of a day = 1 - (1 - p_month)^(1 /
// days of the month): the mean frequency of the J5. `months` > 0 draws for
// that many months instead (the monthly step of the tests). J7: one draw of
// the number of subjects hit among those of the slot (binomial), then who
// they are — the law of a draw per subject, at a draw per event.
export function stepEventsDraws(
  env: EventsEnv,
  slot = 0,
  slots = 1,
  months = 1 / daysInMonth(env.date),
): EventsEvent[] {
  const { ctx, events, date } = env;
  const cfg = ctx.config.events;
  const out: EventsEvent[] = [];
  const known = env.known ?? new Set(ctx.nationIds);
  const index = env.nationIndex ?? new Map(ctx.nationIds.map((n, i) => [n, i]));
  const daily = months < 1;
  const day = Number(date.slice(8, 10));
  const inSlot = (subject: string) =>
    (subject === "world" ? 0 : (index.get(subject) ?? 0)) % slots === slot;
  const everyone = ctx.nationIds.filter(inSlot);
  for (const event of ctx.events) {
    const t = event.trigger;
    if (
      t.dateRange !== undefined &&
      (date < t.dateRange[0] || date > t.dateRange[1])
    )
      continue;
    const once = t.once ?? event.kind === "scripted";
    const cooldown = t.cooldownMonths ?? (once ? 0 : cfg.defaultCooldownMonths);
    const sure = t.monthlyProbability >= 1;
    const p = sure ? 1 : chanceOver(t.monthlyProbability, months);
    const subjects =
      event.scope === "world"
        ? slot === 0
          ? ["world"]
          : []
        : t.nations === undefined
          ? everyone
          : t.nations.filter((n) => known.has(n) && inSlot(n));
    if (subjects.length === 0) continue;
    // The draw first, the conditions after (the same odds, far fewer
    // conditions read at 208 nations and a draw a day).
    const hit = sure
      ? subjects.filter(
          (subject) => !daily || seededDay(env, event.id, subject) === day,
        )
      : drawDistinct(subjects, binomial(subjects.length, p, env.rng), env.rng);
    const fired = events.fired[event.id];
    for (const subject of hit) {
      if (once && fired !== undefined && fired.includes(subject)) continue;
      if (events.cooldowns[`${event.id}|${subject}`] !== undefined) continue;
      const nation = subject === "world" ? env.player : subject;
      if (nation !== null && !t.conditions.every((c) => holds(env, nation, c)))
        continue;
      // The player's events wait when its pop-ups of the month are spent.
      const popup =
        nation !== null && nation === env.player && event.choices.length > 0;
      if (popup && events.popups >= cfg.maxPopupsPerMonth) continue;
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
          params: {
            event: event.id,
            choice: "",
            other: "",
            good: good ?? "",
            by: "none",
            party: "",
            instance: "",
          },
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
          deadline: addDays(date, cfg.answerDays),
        };
        events.pending.push(pending);
        out.push({ type: "event-popup", nation, instance });
      } else {
        out.push(resolve(env, instance, aiChoice(env, nation, event), "ai"));
      }
    }
  }
  return out;
}

// A month at once (the tests; the rhythm of the J5 and the J6): the
// housekeeping, then one draw of the monthly probability for every subject.
export function stepEventsMonth(env: EventsEnv): EventsEvent[] {
  return [...stepEventsHousekeeping(env), ...stepEventsDraws(env, 0, 1, 1)];
}
