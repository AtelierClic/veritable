import { NationId } from "../../data/schemas/common";
import { NationData } from "../../data/schemas/nation";
import {
  DiplomacyState,
  EconomyState,
  MilitaryState,
  PoliticsState,
  War,
} from "../../data/schemas/save";
import { Scenario } from "../../data/schemas/scenario";
import { EconomyContext } from "../economy/context";
import { Rng } from "../rng";
import { militaryPower } from "../war/military";

// Diplomacy and the international reaction (J3a).
//
// relations[a][b] in [-100, 100]: +blocRelation per common bloc (capped) on
// the first day, warRelation between belligerents, 0 otherwise; every month
// they drift back towards 0 by relationDecayPerMonth.
//
// Declaring war costs relations with every nation: (cost of the casus belli)
// x (1 + share of the aggressor in the total military power), at the
// declaration and again every month of the war. Wars the scenario starts
// with are already priced in: no monthly cost.
//
// Reaction of an AI nation, once a month: it sanctions an aggressor (every
// good but the exempt ones, both ways) when its relations with it are under
// the threshold and either it shares a bloc with the victim or the aggressor
// weighs more than a share of the total power; the full members of a bloc
// entity align (layer 1). Coalition: against an aggressor without casus
// belli that outweighs its victim, every nation whose relations with it are
// under the coalition threshold may join the defenders within a window, with
// a monthly probability drawn from the Rng.

export type DiplomacyEvent =
  | {
      type: "war-declared";
      nation: NationId; // aggressor
      target: NationId;
      casusBelli: string | null;
      war: string;
    }
  | { type: "war-joined"; nation: NationId; war: string; against: NationId }
  | {
      type: "sanctions-imposed" | "sanctions-lifted";
      nation: NationId; // sanctioned
      by: NationId;
    };

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

// --- relations ----------------------------------------------------------------

function pair(a: NationId, b: NationId): [NationId, NationId] {
  return a < b ? [a, b] : [b, a];
}

export function relation(
  state: DiplomacyState,
  a: NationId,
  b: NationId,
): number {
  if (a === b) return 100;
  const [x, y] = pair(a, b);
  return state.relations[x]?.[y] ?? 0;
}

export function setRelation(
  state: DiplomacyState,
  a: NationId,
  b: NationId,
  value: number,
): void {
  if (a === b) return;
  const [x, y] = pair(a, b);
  (state.relations[x] ??= {})[y] = clamp(value, -100, 100);
}

export function addRelation(
  state: DiplomacyState,
  a: NationId,
  b: NationId,
  delta: number,
): void {
  setRelation(state, a, b, relation(state, a, b) + delta);
}

function commonBlocs(a: NationData, b: NationData): number {
  return a.blocs.filter((bloc) => b.blocs.includes(bloc)).length;
}

export function warOf(
  state: DiplomacyState,
  a: NationId,
  b: NationId,
): War | undefined {
  return state.wars.find(
    (w) =>
      (w.aggressors.includes(a) && w.defenders.includes(b)) ||
      (w.aggressors.includes(b) && w.defenders.includes(a)),
  );
}

export function atWar(state: DiplomacyState, a: NationId, b: NationId) {
  return warOf(state, a, b) !== undefined;
}

export function enemiesOf(state: DiplomacyState, id: NationId): NationId[] {
  const enemies = new Set<NationId>();
  for (const war of state.wars) {
    if (war.aggressors.includes(id))
      war.defenders.forEach((d) => enemies.add(d));
    if (war.defenders.includes(id))
      war.aggressors.forEach((a) => enemies.add(a));
  }
  return [...enemies];
}

export function warSide(
  war: War,
  id: NationId,
): "aggressors" | "defenders" | null {
  if (war.aggressors.includes(id)) return "aggressors";
  if (war.defenders.includes(id)) return "defenders";
  return null;
}

// --- first day ------------------------------------------------------------------

export function initDiplomacy(
  ctx: EconomyContext,
  scenario: Scenario,
): DiplomacyState {
  const cfg = ctx.config.diplomacy;
  const ids = [...ctx.nationIds].sort();
  const state: DiplomacyState = {
    relations: {},
    wars: [],
    sanctions: [],
    coalitionCalls: [],
    contestedRegions: [],
    reparations: [],
    demilitarized: [],
    nextOfferId: 1,
    nextWarId: 1,
  };
  for (let i = 0; i < ids.length; i++) {
    state.relations[ids[i]] = {};
    for (let j = i + 1; j < ids.length; j++) {
      const common = commonBlocs(ctx.sheet(ids[i]), ctx.sheet(ids[j]));
      state.relations[ids[i]][ids[j]] = Math.min(
        cfg.blocRelationCap,
        cfg.blocRelation * common,
      );
    }
  }
  for (const war of scenario.wars) {
    const [aggressors, defenders] = war.belligerents;
    const known = (id: string) => ctx.nationIds.includes(id);
    if (!aggressors.every(known) || !defenders.every(known)) continue;
    state.wars.push(
      newWar(state, war.id, aggressors, defenders, null, war.since, false),
    );
    for (const a of aggressors) {
      for (const d of defenders) setRelation(state, a, d, cfg.warRelation);
    }
  }
  return state;
}

function newWar(
  state: DiplomacyState,
  id: string,
  aggressors: NationId[],
  defenders: NationId[],
  casusBelli: string | null,
  since: string,
  declaredInCampaign: boolean,
): War {
  const all = [...aggressors, ...defenders];
  return {
    id,
    aggressors,
    defenders,
    casusBelli,
    since,
    declaredInCampaign,
    score: Object.fromEntries(all.map((n) => [n, 0])),
    retreatMonths: Object.fromEntries(all.map((n) => [n, 0])),
    tilesTaken: Object.fromEntries(all.map((n) => [n, 0])),
    offers: [],
  };
}

// --- casus belli --------------------------------------------------------------------

export function casusBelliValid(
  ctx: EconomyContext,
  state: DiplomacyState,
  politics: PoliticsState,
  scenario: Scenario,
  declarer: NationId,
  target: NationId,
  casusBelliId: string,
): boolean {
  const entry = ctx.casusBelli.find((c) => c.id === casusBelliId);
  if (entry === undefined) return false;
  switch (entry.check) {
    case "none":
      return true;
    case "contested-territory": {
      const regions = [
        ...scenario.contested.map((r) => ({
          controller: r.controller,
          claimants: r.claimants,
        })),
        ...state.contestedRegions,
      ];
      return regions.some(
        (r) => r.controller === target && r.claimants.includes(declarer),
      );
    }
    case "ally-attacked": {
      const me = ctx.sheet(declarer);
      return state.wars.some(
        (w) =>
          w.aggressors.includes(target) &&
          w.defenders.some(
            (d) => d !== declarer && commonBlocs(me, ctx.sheet(d)) > 0,
          ),
      );
    }
    case "humanitarian": {
      const p = politics.nations[target];
      return (
        p !== undefined &&
        p.unrest &&
        p.stability < ctx.config.diplomacy.humanitarianStability
      );
    }
  }
}

export function availableCasusBelli(
  ctx: EconomyContext,
  state: DiplomacyState,
  politics: PoliticsState,
  scenario: Scenario,
  declarer: NationId,
  target: NationId,
): string[] {
  return ctx.casusBelli
    .filter((c) =>
      casusBelliValid(ctx, state, politics, scenario, declarer, target, c.id),
    )
    .map((c) => c.id);
}

// --- declaration -------------------------------------------------------------------

function powerShare(
  ctx: EconomyContext,
  military: MilitaryState,
  id: NationId,
): number {
  let total = 0;
  for (const n of ctx.nationIds) total += militaryPower(ctx, military, n);
  return total > 0 ? militaryPower(ctx, military, id) / total : 0;
}

// Relations every nation loses with the aggressor for one month of war.
function monthlyCost(
  ctx: EconomyContext,
  military: MilitaryState,
  war: War,
  aggressor: NationId,
): number {
  const entry =
    war.casusBelli === null
      ? ctx.casusBelli.find((c) => c.check === "none")!
      : ctx.casusBelli.find((c) => c.id === war.casusBelli)!;
  return entry.relationsCost * (1 + powerShare(ctx, military, aggressor));
}

function chargeAggressor(
  ctx: EconomyContext,
  state: DiplomacyState,
  military: MilitaryState,
  war: War,
  aggressor: NationId,
): void {
  const cost = monthlyCost(ctx, military, war, aggressor);
  for (const other of ctx.nationIds) {
    if (other === aggressor) continue;
    if (war.defenders.includes(other)) continue; // already at warRelation
    addRelation(state, aggressor, other, -cost);
  }
}

export function declareWar(
  ctx: EconomyContext,
  state: DiplomacyState,
  politics: PoliticsState,
  military: MilitaryState,
  scenario: Scenario,
  aggressor: NationId,
  target: NationId,
  casusBelliId: string,
  date: string,
): DiplomacyEvent {
  if (aggressor === target) throw new Error("a nation cannot attack itself");
  if (!ctx.nationIds.includes(target))
    throw new Error(`unknown nation ${target}`);
  if (atWar(state, aggressor, target)) {
    throw new Error(`${aggressor} and ${target} are already at war`);
  }
  if (
    !casusBelliValid(
      ctx,
      state,
      politics,
      scenario,
      aggressor,
      target,
      casusBelliId,
    )
  ) {
    throw new Error(
      `casus belli ${casusBelliId} does not hold against ${target}`,
    );
  }
  const entry = ctx.casusBelli.find((c) => c.id === casusBelliId)!;
  const casusBelli = entry.check === "none" ? null : entry.id;
  const war = newWar(
    state,
    `war-${state.nextWarId}`,
    [aggressor],
    [target],
    casusBelli,
    date,
    true,
  );
  state.nextWarId += 1;
  state.wars.push(war);
  setRelation(state, aggressor, target, ctx.config.diplomacy.warRelation);
  chargeAggressor(ctx, state, military, war, aggressor);
  // The aggressor's youth and business turn against the war.
  const groups = politics.nations[aggressor]?.groups;
  if (groups !== null && groups !== undefined) {
    const hit = ctx.config.diplomacy.declarationGroupHit;
    groups.youth = clamp(groups.youth - hit, 0, 1);
    groups.business = clamp(groups.business - hit, 0, 1);
  }
  return {
    type: "war-declared",
    nation: aggressor,
    target,
    casusBelli,
    war: war.id,
  };
}

// --- sanctions ------------------------------------------------------------------------

export function isSanctioning(
  state: DiplomacyState,
  by: NationId,
  against: NationId,
): boolean {
  return state.sanctions.some((s) => s.by === by && s.against === against);
}

export function imposeSanctions(
  ctx: EconomyContext,
  state: DiplomacyState,
  economy: EconomyState,
  by: NationId,
  against: NationId,
  date: string,
): DiplomacyEvent | null {
  if (by === against || isSanctioning(state, by, against)) return null;
  state.sanctions.push({ by, against, since: date });
  const exempt = ctx.config.diplomacy.sanction.exemptGoods;
  const list = economy.market.embargoes;
  for (const good of ctx.goods) {
    if (exempt.includes(good.id)) continue;
    for (const [from, to] of [
      [against, by],
      [by, against],
    ]) {
      if (
        !list.some((e) => e.from === from && e.to === to && e.good === good.id)
      ) {
        list.push({ from, to, good: good.id });
      }
    }
  }
  return { type: "sanctions-imposed", nation: against, by };
}

export function liftSanctions(
  ctx: EconomyContext,
  state: DiplomacyState,
  economy: EconomyState,
  by: NationId,
  against: NationId,
): DiplomacyEvent | null {
  const at = state.sanctions.findIndex(
    (s) => s.by === by && s.against === against,
  );
  if (at < 0) return null;
  state.sanctions.splice(at, 1);
  const exempt: readonly string[] = ctx.config.diplomacy.sanction.exemptGoods;
  economy.market.embargoes = economy.market.embargoes.filter(
    (e) =>
      exempt.includes(e.good) ||
      !(
        (e.from === against && e.to === by) ||
        (e.from === by && e.to === against)
      ),
  );
  return { type: "sanctions-lifted", nation: against, by };
}

// --- the monthly reaction ---------------------------------------------------------------

export function stepDiplomacyMonth(
  ctx: EconomyContext,
  state: DiplomacyState,
  economy: EconomyState,
  military: MilitaryState,
  rng: Rng,
  date: string,
  // Nations run by the AI (everyone but the player, or everyone in autopilot).
  aiNations: readonly NationId[],
): DiplomacyEvent[] {
  const cfg = ctx.config.diplomacy;
  const events: DiplomacyEvent[] = [];
  const ids = ctx.nationIds;

  // 1. Relations drift back towards 0; belligerents stay at warRelation.
  for (const a of ids) {
    for (const b of ids) {
      if (!(a < b)) continue;
      if (atWar(state, a, b)) {
        setRelation(state, a, b, cfg.warRelation);
        continue;
      }
      const r = relation(state, a, b);
      const decayed =
        r > 0
          ? Math.max(0, r - cfg.relationDecayPerMonth)
          : Math.min(0, r + cfg.relationDecayPerMonth);
      setRelation(state, a, b, decayed);
    }
  }

  // 2. A war of aggression keeps costing relations.
  for (const war of state.wars) {
    if (!war.declaredInCampaign) continue;
    for (const aggressor of war.aggressors) {
      chargeAggressor(ctx, state, military, war, aggressor);
    }
  }

  // 3. Sanctions of the AI nations against aggressors, then bloc alignment.
  const power = new Map(ids.map((n) => [n, militaryPower(ctx, military, n)]));
  const totalPower = [...power.values()].reduce((a, b) => a + b, 0);
  const wantsToSanction = (by: NationId, aggressor: NationId, war: War) => {
    if (relation(state, by, aggressor) >= cfg.sanction.relationsBelow)
      return false;
    // A nation the aggressor is fighting always sanctions it.
    if (warSide(war, by) === "defenders") return true;
    const me = ctx.sheet(by);
    const bloc = war.defenders.some(
      (d) => d !== by && commonBlocs(me, ctx.sheet(d)) > 0,
    );
    const heavy =
      totalPower > 0 &&
      power.get(aggressor)! / totalPower > cfg.sanction.aggressorPowerShare;
    return bloc || heavy;
  };
  for (const war of state.wars) {
    for (const aggressor of war.aggressors) {
      const sanctioners = new Set<NationId>();
      for (const by of aiNations) {
        if (by === aggressor || warSide(war, by) === "aggressors") continue;
        if (
          isSanctioning(state, by, aggressor) ||
          wantsToSanction(by, aggressor, war)
        ) {
          sanctioners.add(by);
        }
      }
      // Layer 1 of the blocs: when enough full members sanction, all do.
      for (const bloc of ctx.blocs) {
        const members = bloc.members
          .filter((m) => m.status === "full")
          .map((m) => m.nation)
          .filter(
            (n) =>
              ids.includes(n) &&
              n !== aggressor &&
              warSide(war, n) !== "aggressors",
          );
        if (members.length === 0) continue;
        const count = members.filter((m) => sanctioners.has(m)).length;
        if (count / members.length >= cfg.sanction.blocAlignShare) {
          for (const m of members)
            if (aiNations.includes(m)) sanctioners.add(m);
        }
      }
      for (const by of sanctioners) {
        const event = imposeSanctions(ctx, state, economy, by, aggressor, date);
        if (event !== null) events.push(event);
      }
    }
  }

  // 4. Sanctions are lifted once the sanctioned nation is no longer an
  //    aggressor anywhere and relations have healed.
  for (const sanction of [...state.sanctions]) {
    if (!aiNations.includes(sanction.by)) continue;
    const stillAggressor = state.wars.some((w) =>
      w.aggressors.includes(sanction.against),
    );
    if (stillAggressor) continue;
    if (
      relation(state, sanction.by, sanction.against) >=
      cfg.sanction.liftAboveRelations
    ) {
      const event = liftSanctions(
        ctx,
        state,
        economy,
        sanction.by,
        sanction.against,
      );
      if (event !== null) events.push(event);
    }
  }

  // 5. Coalitions against an aggressor without casus belli that outweighs its victim.
  for (const war of state.wars) {
    if (war.casusBelli !== null || !war.declaredInCampaign) continue;
    const aggressorPower = war.aggressors.reduce(
      (s, n) => s + power.get(n)!,
      0,
    );
    const defenderPower = war.defenders.reduce((s, n) => s + power.get(n)!, 0);
    if (aggressorPower <= cfg.coalition.powerRatio * defenderPower) continue;
    for (const nation of aiNations) {
      if (warSide(war, nation) !== null) continue;
      const hostile = war.aggressors.some(
        (a) => relation(state, nation, a) < cfg.coalition.relationsBelow,
      );
      if (!hostile) continue;
      if (
        !state.coalitionCalls.some(
          (c) => c.war === war.id && c.nation === nation,
        )
      ) {
        state.coalitionCalls.push({
          war: war.id,
          nation,
          monthsLeft: cfg.coalition.windowMonths,
        });
      }
    }
  }
  for (const call of [...state.coalitionCalls]) {
    const war = state.wars.find((w) => w.id === call.war);
    const remove = () =>
      state.coalitionCalls.splice(state.coalitionCalls.indexOf(call), 1);
    if (war === undefined || warSide(war, call.nation) !== null) {
      remove();
      continue;
    }
    if (rng.next() < cfg.coalition.monthlyProbability) {
      joinWar(ctx, state, war, call.nation, "defenders");
      events.push({
        type: "war-joined",
        nation: call.nation,
        war: war.id,
        against: war.aggressors[0],
      });
      remove();
      continue;
    }
    call.monthsLeft -= 1;
    if (call.monthsLeft <= 0) remove();
  }
  return events;
}

export function joinWar(
  ctx: EconomyContext,
  state: DiplomacyState,
  war: War,
  nation: NationId,
  side: "aggressors" | "defenders",
): void {
  war[side].push(nation);
  war.score[nation] = 0;
  war.retreatMonths[nation] = 0;
  war.tilesTaken[nation] = 0;
  const enemies = side === "aggressors" ? war.defenders : war.aggressors;
  for (const enemy of enemies) {
    setRelation(state, nation, enemy, ctx.config.diplomacy.warRelation);
  }
}
