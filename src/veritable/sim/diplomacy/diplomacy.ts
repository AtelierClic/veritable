import { NationId } from "../../data/schemas/common";
import {
  DiplomacyState,
  EconomyState,
  MilitaryState,
  PoliticsState,
  War,
} from "../../data/schemas/save";
import { Scenario } from "../../data/schemas/scenario";
import { EconomyContext } from "../economy/context";
import { ideologyDistance, MAX_IDEOLOGY_DISTANCE } from "../politics/ideology";
import { Rng } from "../rng";
import { militaryPower } from "../war/military";
import {
  claimsAgainst,
  initClaims,
  scenarioWarClaims,
  warClaims,
} from "./claims";

// Diplomacy and the international reaction (J3a).
//
// relations[a][b] in [-100, 100]: +blocRelation per common bloc (capped) on
// the first day, warRelation between belligerents, 0 otherwise; every month
// they drift towards an affinity (J4: affinityPerBloc x common blocs +
// affinityIdeology x (1 - ideological distance of the governments / max)),
// by relationDecayPerMonth when above it and relationRecoveryPerMonth when
// below it (after a peace, relations heal faster than they fade).
//
// Declaring war costs relations with every nation: (cost of the casus belli)
// x (1 + share of the aggressor in the total military power), once at the
// declaration. An aggressor WITHOUT casus belli pays it again every month of
// the war. Defenders and coalition members pay nothing. Wars the scenario
// starts with are already priced in: no monthly cost.
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
    grievances: [],
    pariahs: [],
    pendingAnnexations: [],
    claims: initClaims(scenario),
    warMemory: {},
    reparations: [],
    demilitarized: [],
    nextOfferId: 1,
    nextWarId: 1,
  };
  for (let i = 0; i < ids.length; i++) {
    state.relations[ids[i]] = {};
    for (let j = i + 1; j < ids.length; j++) {
      // J6b: the scenario's relations file when it has one (the world of
      // 2026), else the rule of the J3.
      const given = ctx.startRelation(ids[i], ids[j]);
      const common = ctx.commonBlocs(ids[i], ids[j]);
      state.relations[ids[i]][ids[j]] =
        given ?? Math.min(cfg.blocRelationCap, cfg.blocRelation * common);
    }
  }
  for (const war of scenario.wars) {
    const [aggressors, defenders] = war.belligerents;
    const known = (id: string) => ctx.nationIds.includes(id);
    if (!aggressors.every(known) || !defenders.every(known)) continue;
    const started = newWar(
      state,
      war.id,
      aggressors,
      defenders,
      null,
      war.since,
      false,
    );
    started.claims = scenarioWarClaims(scenario, aggressors, defenders);
    state.wars.push(started);
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
    monthlyTiles: Object.fromEntries(all.map((n) => [n, 0])),
    offers: [],
    losses: Object.fromEntries(all.map((n) => [n, 0])),
    claims: [],
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
    // J6: a claim of the declarer on land the target holds now (read on
    // the map), treaty-settled tiles excluded.
    case "contested-territory":
      return claimsAgainst(ctx, state, declarer, target).length > 0;
    // Expired grievances are pruned by the events every month.
    case "grievance":
      return state.grievances.some(
        (g) => g.by === declarer && g.against === target,
      );
    case "ally-attacked": {
      return state.wars.some(
        (w) =>
          w.aggressors.includes(target) &&
          w.defenders.some(
            (d) => d !== declarer && ctx.commonBlocs(declarer, d) > 0,
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

// Relations every other nation loses with an aggressor at the declaration
// (and every month of a war without casus belli), for the AI's appraisal.
export function declarationRelationsCost(
  ctx: EconomyContext,
  military: MilitaryState,
  aggressor: NationId,
  casusBelliId: string,
): number {
  const entry =
    ctx.casusBelli.find((c) => c.id === casusBelliId) ??
    ctx.casusBelli.find((c) => c.check === "none")!;
  return entry.relationsCost * (1 + powerShare(ctx, military, aggressor));
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
  // J6: the claims of the aggressor on land of the target, whatever the
  // casus belli put forward: a white or lost war weakens them.
  war.claims = warClaims(ctx, state, [aggressor], [target]);
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

// What the affinity reads of the world (J6c): computed once for the
// monthly step, which asks the affinity of every pair of 208 nations; read
// directly for a single pair.
export interface AffinityInputs {
  blocsOf(nation: NationId): readonly string[];
  sanctioning(by: NationId, against: NationId): boolean;
  enemies(nation: NationId): readonly NationId[];
  // Inherited mistrust of the pair (J6c, <= 0).
  mistrust(a: NationId, b: NationId): number;
}

function mistrustOf(
  ctx: EconomyContext,
  date: string | undefined,
): (a: NationId, b: NationId) => number {
  const factor = ctx.mistrustFactor(date);
  return (a, b) => factor * Math.min(0, ctx.startRelation(a, b) ?? 0);
}

export function directAffinityInputs(
  ctx: EconomyContext,
  state: DiplomacyState,
  date?: string,
): AffinityInputs {
  return {
    blocsOf: (nation) => ctx.blocsOf(nation),
    sanctioning: (by, against) => isSanctioning(state, by, against),
    enemies: (nation) => enemiesOf(state, nation),
    mistrust: mistrustOf(ctx, date),
  };
}

// The same, frozen: valid while blocs, sanctions and wars stay as they are.
export function cachedAffinityInputs(
  ctx: EconomyContext,
  state: DiplomacyState,
  date?: string,
): AffinityInputs {
  const blocs = new Map<NationId, readonly string[]>();
  const enemies = new Map<NationId, readonly NationId[]>();
  const sanctions = new Map<NationId, Set<NationId>>();
  for (const s of state.sanctions) {
    let targets = sanctions.get(s.by);
    if (targets === undefined) {
      targets = new Set();
      sanctions.set(s.by, targets);
    }
    targets.add(s.against);
  }
  return {
    blocsOf: (nation) => {
      let list = blocs.get(nation);
      if (list === undefined) {
        list = ctx.blocsOf(nation);
        blocs.set(nation, list);
      }
      return list;
    },
    sanctioning: (by, against) => sanctions.get(by)?.has(against) ?? false,
    enemies: (nation) => {
      let list = enemies.get(nation);
      if (list === undefined) {
        list = enemiesOf(state, nation);
        enemies.set(nation, list);
      }
      return list;
    },
    mistrust: mistrustOf(ctx, date),
  };
}

// Allies (J6b): members of a common bloc of an ally type (a military
// alliance, an economic union), or a guarantor and the nation it protects.
export function allies(
  ctx: EconomyContext,
  a: NationId,
  b: NationId,
  blocsOf: (nation: NationId) => readonly string[] = (n) => ctx.blocsOf(n),
): boolean {
  const types: readonly string[] = ctx.config.diplomacy.allyBlocTypes;
  const mine = blocsOf(a);
  for (const bloc of blocsOf(b)) {
    const type = ctx.blocType(bloc);
    if (mine.includes(bloc) && type !== undefined && types.includes(type)) {
      return true;
    }
  }
  return ctx.guarantees.some(
    (g) =>
      (g.guarantor === a && g.protected === b) ||
      (g.guarantor === b && g.protected === a),
  );
}

// Is x at war with an ally of y (another nation than y)?
function fightsAnAlly(
  ctx: EconomyContext,
  inputs: AffinityInputs,
  x: NationId,
  y: NationId,
): boolean {
  for (const z of inputs.enemies(x)) {
    if (z !== y && allies(ctx, y, z, inputs.blocsOf)) return true;
  }
  return false;
}

// Where the relations of two nations settle: common blocs and the
// ideological proximity of their governments (J4). J6b: a common bloc weighs
// by its type; sanctions between the two, or a war of either against an ally
// of the other, pull the affinity down. J6c: so does the mistrust inherited
// from the first day, which fades.
export function affinityOf(
  ctx: EconomyContext,
  state: DiplomacyState,
  politics: PoliticsState,
  a: NationId,
  b: NationId,
  // J6b: the affinity the two would have without their sanctions (the lift
  // of a sanction of policy).
  withoutSanctions = false,
  inputs: AffinityInputs = directAffinityInputs(ctx, state),
): number {
  const cfg = ctx.config.diplomacy;
  const pa = politics.nations[a];
  const pb = politics.nations[b];
  const proximity =
    pa === undefined || pb === undefined
      ? 0.5
      : 1 -
        ideologyDistance(pa.government.ideology, pb.government.ideology) /
          MAX_IDEOLOGY_DISTANCE;
  let blocs = 0;
  const mine = inputs.blocsOf(a);
  for (const bloc of inputs.blocsOf(b)) {
    if (!mine.includes(bloc)) continue;
    const type = ctx.blocType(bloc);
    blocs +=
      type === undefined ? cfg.affinityPerBloc : cfg.affinityByBlocType[type];
  }
  const sanctions =
    !withoutSanctions && (inputs.sanctioning(a, b) || inputs.sanctioning(b, a))
      ? cfg.affinitySanctions
      : 0;
  const allyAtWar =
    fightsAnAlly(ctx, inputs, a, b) || fightsAnAlly(ctx, inputs, b, a)
      ? cfg.affinityAllyAtWar
      : 0;
  // The bloc term is capped like the first-day relations (blocRelationCap):
  // four common blocs are not worth more than two.
  return clamp(
    Math.min(cfg.blocRelationCap, blocs) +
      cfg.affinityIdeology * proximity -
      sanctions -
      allyAtWar +
      inputs.mistrust(a, b),
    -100,
    100,
  );
}

// J6b: a sanction of policy (the first day's) may be lifted once the regime
// of the target is no longer the one it had that day (revolution, coup,
// transition) and the two would be close without the sanction: the
// ideological proxy alone sees the governments of the United States and of
// Iran as close (both high on authority and sovereignty).
export function policyLiftable(
  ctx: EconomyContext,
  state: DiplomacyState,
  politics: PoliticsState,
  by: NationId,
  against: NationId,
  inputs: AffinityInputs = directAffinityInputs(ctx, state),
): boolean {
  const regime = politics.nations[against]?.regime;
  if (regime === undefined || regime === ctx.sheet(against).regime) {
    return false;
  }
  return (
    affinityOf(ctx, state, politics, by, against, true, inputs) >=
    ctx.config.diplomacy.sanction.liftPolicyMinAffinity
  );
}

// Relations of a nation with every democracy move by `delta` (media
// control, detected fraud, coup).
export function hitDemocracyRelations(
  ctx: EconomyContext,
  state: DiplomacyState,
  politics: PoliticsState,
  nation: NationId,
  delta: number,
): void {
  if (delta === 0) return;
  for (const other of ctx.nationIds) {
    if (other === nation) continue;
    const p = politics.nations[other];
    if (p === undefined || !ctx.regime(p.regime).democratic) continue;
    addRelation(state, nation, other, delta);
  }
}

export function stepDiplomacyMonth(
  ctx: EconomyContext,
  state: DiplomacyState,
  economy: EconomyState,
  military: MilitaryState,
  politics: PoliticsState,
  rng: Rng,
  date: string,
  // Nations run by the AI (everyone but the player, or everyone in autopilot).
  aiNations: readonly NationId[],
  // Sanctions a bloc holds: the member does not lift them alone (J5).
  blocHeld: (by: NationId, against: NationId) => boolean = () => false,
): DiplomacyEvent[] {
  const cfg = ctx.config.diplomacy;
  const events: DiplomacyEvent[] = [];
  const ids = ctx.nationIds;

  // 0. War memory fades (J6): halves every halfLifeYears.
  decayWarMemory(ctx, state);

  // 1. Relations drift towards their affinity; belligerents stay at
  //    warRelation. An aggressor without casus belli mends nothing while its
  //    war lasts: its relations only erode.
  const unjustAggressors = new Set<NationId>();
  for (const war of state.wars) {
    if (!war.declaredInCampaign || war.casusBelli !== null) continue;
    for (const a of war.aggressors) unjustAggressors.add(a);
  }
  // Blocs, sanctions and wars do not move during steps 1 and 4.
  const inputs = cachedAffinityInputs(ctx, state, date);
  const fighting = new Set<string>();
  for (const war of state.wars) {
    for (const x of war.aggressors) {
      for (const y of war.defenders) {
        fighting.add(x < y ? `${x}|${y}` : `${y}|${x}`);
      }
    }
  }
  for (const a of ids) {
    for (const b of ids) {
      if (!(a < b)) continue;
      if (fighting.has(`${a}|${b}`)) {
        setRelation(state, a, b, cfg.warRelation);
        continue;
      }
      const r = relation(state, a, b);
      const target = affinityOf(ctx, state, politics, a, b, false, inputs);
      const mending = !unjustAggressors.has(a) && !unjustAggressors.has(b);
      const next =
        r > target
          ? Math.max(target, r - cfg.relationDecayPerMonth)
          : mending
            ? Math.min(target, r + cfg.relationRecoveryPerMonth)
            : r;
      setRelation(state, a, b, next);
    }
  }

  // 2. A war of aggression without casus belli keeps costing relations.
  for (const war of state.wars) {
    if (!war.declaredInCampaign || war.casusBelli !== null) continue;
    for (const aggressor of war.aggressors) {
      chargeAggressor(ctx, state, military, war, aggressor);
    }
  }

  // 3. Sanctions of the AI nations against aggressors. The alignment of the
  //    blocs (layer 1, J3) is now a vote of their members (sim/blocs, J5).
  const power = new Map(ids.map((n) => [n, militaryPower(ctx, military, n)]));
  const totalPower = [...power.values()].reduce((a, b) => a + b, 0);
  const wantsToSanction = (by: NationId, aggressor: NationId, war: War) => {
    if (relation(state, by, aggressor) >= cfg.sanction.relationsBelow)
      return false;
    // A nation the aggressor is fighting always sanctions it.
    if (warSide(war, by) === "defenders") return true;
    const bloc = war.defenders.some(
      (d) => d !== by && ctx.commonBlocs(by, d) > 0,
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
      for (const by of sanctioners) {
        const event = imposeSanctions(ctx, state, economy, by, aggressor, date);
        if (event !== null) events.push(event);
      }
    }
  }

  // 4. Sanctions are lifted once the sanctioned nation is no longer an
  //    aggressor anywhere and relations have healed; a sanction of policy
  //    (J6b) once the two governments have also grown close.
  for (const sanction of [...state.sanctions]) {
    if (!aiNations.includes(sanction.by)) continue;
    if (blocHeld(sanction.by, sanction.against)) continue;
    const stillAggressor = state.wars.some((w) =>
      w.aggressors.includes(sanction.against),
    );
    if (stillAggressor) continue;
    if (
      sanction.policy === true &&
      !policyLiftable(
        ctx,
        state,
        politics,
        sanction.by,
        sanction.against,
        inputs,
      )
    ) {
      continue;
    }
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

  // 5. Coalitions against an aggressor without casus belli that outweighs its
  //    victim. The victim is the nation attacked (the first defender of a war
  //    declared in the campaign), not the coalition that joined it: a
  //    coalition member does not keep the others out.
  //    J5: against a nation that fired a nuclear weapon, whatever its side,
  //    its power or its casus belli.
  for (const war of state.wars) {
    const pariahSide = war.aggressors.some((n) => state.pariahs.includes(n))
      ? "aggressors"
      : war.defenders.some((n) => state.pariahs.includes(n))
        ? "defenders"
        : null;
    let against: "aggressors" | "defenders";
    if (pariahSide !== null) {
      against = pariahSide;
    } else {
      if (war.casusBelli !== null || !war.declaredInCampaign) continue;
      const aggressorPower = war.aggressors.reduce(
        (s, n) => s + power.get(n)!,
        0,
      );
      const victimPower = power.get(war.defenders[0]) ?? 0;
      if (aggressorPower <= cfg.coalition.powerRatio * victimPower) continue;
      against = "aggressors";
    }
    const side = against === "aggressors" ? "defenders" : "aggressors";
    // J6c: only a nation able to fight joins — a land neighbour of the side
    // it would fight, or an ally of the principal of the side it would join
    // (a common bloc of an ally type, a guarantee). At 208 nations every
    // nation at odds with a pariah joined its war, Vanuatu included.
    const principal = war[side][0];
    for (const nation of aiNations) {
      if (warSide(war, nation) !== null) continue;
      const hostile = war[against].some(
        (a) => relation(state, nation, a) < cfg.coalition.relationsBelow,
      );
      if (!hostile) continue;
      const able =
        war[against].some((a) => ctx.landNeighbours(nation, a)) ||
        (principal !== undefined && allies(ctx, nation, principal));
      if (!able) continue;
      if (
        !state.coalitionCalls.some(
          (c) => c.war === war.id && c.nation === nation,
        )
      ) {
        state.coalitionCalls.push({
          war: war.id,
          nation,
          monthsLeft: cfg.coalition.windowMonths,
          side,
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
      joinWar(ctx, state, war, call.nation, call.side);
      events.push({
        type: "war-joined",
        nation: call.nation,
        war: war.id,
        against:
          call.side === "defenders" ? war.aggressors[0] : war.defenders[0],
      });
      remove();
      continue;
    }
    call.monthsLeft -= 1;
    if (call.monthsLeft <= 0) remove();
  }
  return events;
}

// --- war memory (J6) -------------------------------------------------------------

const MEMORY_FLOOR = 0.001;

export function decayWarMemory(
  ctx: EconomyContext,
  state: DiplomacyState,
): void {
  const halfLife = ctx.config.ai.nations.war.memory.halfLifeYears;
  const factor = Math.pow(0.5, 1 / (12 * halfLife));
  for (const id of Object.keys(state.warMemory)) {
    const next = state.warMemory[id] * factor;
    if (next < MEMORY_FLOOR) delete state.warMemory[id];
    else state.warMemory[id] = next;
  }
}

// The end of a war: each belligerent remembers its losses (share of its
// population) and the years it lasted.
export function rememberWar(
  ctx: EconomyContext,
  state: DiplomacyState,
  war: War,
  date: string,
): void {
  const cfg = ctx.config.ai.nations.war.memory;
  const years = Math.max(0, yearsBetween(war.since, date));
  for (const id of [...war.aggressors, ...war.defenders]) {
    const population = ctx.sheet(id).population.value;
    const losses = war.losses[id] ?? 0;
    const add =
      cfg.lossesWeight * (population > 0 ? losses / population : 0) +
      cfg.yearsWeight * years;
    if (add <= 0) continue;
    state.warMemory[id] = (state.warMemory[id] ?? 0) + add;
  }
}

export function warMemoryOf(state: DiplomacyState, id: NationId): number {
  return state.warMemory[id] ?? 0;
}

function yearsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return ty - fy + (tm - fm) / 12 + (td - fd) / 365;
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
  war.monthlyTiles[nation] = 0;
  war.losses[nation] = 0;
  const enemies = side === "aggressors" ? war.defenders : war.aggressors;
  for (const enemy of enemies) {
    setRelation(state, nation, enemy, ctx.config.diplomacy.warRelation);
  }
}
