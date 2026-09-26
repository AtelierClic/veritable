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
import { addMonths } from "../politics/state";
import { Rng } from "../rng";
import { addDays as addDaysIso, chanceOver, DAYS_PER_MONTH } from "../time";
import { militaryPower } from "../war/military";
import {
  claimsAgainst,
  claimsOf,
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
// Reaction of an AI nation, at each of its updates (J7; once a month until
// the J6): it sanctions an aggressor (every
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
      scenario.startDate,
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
  // The first day the campaign sees the war (its start for a war declared
  // in the campaign, the start date for a war of the scenario).
  seen: string = since,
): War {
  const all = [...aggressors, ...defenders];
  // J7: a war keeps its own months, counted from its start.
  let ledgerOn = addMonths(since, 1);
  while (ledgerOn <= seen) ledgerOn = addMonths(ledgerOn, 1);
  return {
    id,
    aggressors,
    defenders,
    casusBelli,
    since,
    declaredInCampaign,
    ledgerOn,
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
  months = 1,
): void {
  const cost = monthlyCost(ctx, military, war, aggressor) * months;
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
  // J7: the weight of the strongest active claim of either on land the
  // other holds (0 without any).
  claims(a: NationId, b: NationId): number;
}

// Does either guarantee the other (J7)?
function guaranteed(ctx: EconomyContext, a: NationId, b: NationId): boolean {
  return ctx.guarantees.some(
    (g) =>
      (g.guarantor === a && g.protected === b) ||
      (g.guarantor === b && g.protected === a),
  );
}

function claimWeightOf(
  ctx: EconomyContext,
  state: DiplomacyState,
  claimant: NationId,
  holder: NationId,
): number {
  let weight = 0;
  for (const c of claimsAgainst(ctx, state, claimant, holder)) {
    weight = Math.max(weight, c.weight);
  }
  return weight;
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
    claims: (a, b) =>
      Math.max(
        claimWeightOf(ctx, state, a, b),
        claimWeightOf(ctx, state, b, a),
      ),
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
  // J7: the claims of every nation on the land others hold, read once.
  const { minTiles } = ctx.config.diplomacy.claims;
  const claims = new Map<string, number>();
  for (const claimant of ctx.nationIds) {
    for (const claim of claimsOf(state, claimant)) {
      if (claim.dormant) continue;
      for (const [holder, tiles] of ctx.claimHolders(claim.region)) {
        if (holder === claimant || tiles < minTiles) continue;
        const key =
          claimant < holder ? `${claimant}|${holder}` : `${holder}|${claimant}`;
        claims.set(key, Math.max(claims.get(key) ?? 0, claim.weight));
      }
    }
  }
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
    claims: (a, b) => claims.get(a < b ? `${a}|${b}` : `${b}|${a}`) ?? 0,
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

// The terms of the affinity of two nations (J7: what the card of a nation
// shows the player), each signed as it counts, and their clamped sum.
export interface AffinityTerms {
  blocs: number;
  ideology: number;
  sanctions: number;
  allyAtWar: number;
  mistrust: number;
  claims: number;
  guarantee: number;
  total: number;
}

// Where the relations of two nations settle: common blocs and the
// ideological proximity of their governments (J4). J6b: a common bloc weighs
// by its type; sanctions between the two, or a war of either against an ally
// of the other, pull the affinity down. J6c: so does the mistrust inherited
// from the first day, which fades. J7: a guarantee between the two lifts it,
// a claim of either on land the other holds pulls it down.
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
  return affinityTerms(ctx, state, politics, a, b, withoutSanctions, inputs)
    .total;
}

export function affinityTerms(
  ctx: EconomyContext,
  state: DiplomacyState,
  politics: PoliticsState,
  a: NationId,
  b: NationId,
  withoutSanctions = false,
  inputs: AffinityInputs = directAffinityInputs(ctx, state),
): AffinityTerms {
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
  const terms = {
    blocs: Math.min(cfg.blocRelationCap, blocs),
    ideology: cfg.affinityIdeology * proximity,
    sanctions: -sanctions,
    allyAtWar: -allyAtWar,
    mistrust: inputs.mistrust(a, b),
    claims: -cfg.affinityClaim * inputs.claims(a, b),
    guarantee: guaranteed(ctx, a, b) ? cfg.affinityGuarantee : 0,
  };
  return {
    ...terms,
    total: clamp(
      terms.blocs +
        terms.ideology +
        terms.sanctions +
        terms.allyAtWar +
        terms.mistrust +
        terms.claims +
        terms.guarantee,
      -100,
      100,
    ),
  };
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

// --- the reaction, nation by nation (J7) ------------------------------------------------
//
// Until the J6 every nation reacted on the 1st of the month, in one step for
// the whole world. J7: each nation reacts at its own update of the rolling
// queue, over the months since its last one: the relations it owns drift,
// an aggressor without casus belli pays its months of war, an AI nation
// imposes and lifts its sanctions and answers the coalition calls, and its
// war memory fades. stepDiplomacyMonth runs the whole world for one month
// (the tests, the warm-up).

export interface DiplomacyStepEnv {
  ctx: EconomyContext;
  state: DiplomacyState;
  economy: EconomyState;
  military: MilitaryState;
  politics: PoliticsState;
  rng: Rng;
  date: string;
  // Nations run by the AI (everyone but the player, or everyone in autopilot).
  aiNations: readonly NationId[];
  // The player's nation: it owns all its pairs (null in autopilot).
  player: NationId | null;
  // Sanctions a bloc holds: the member does not lift them alone (J5).
  blocHeld: (by: NationId, against: NationId) => boolean;
  // What the affinity reads of the world, frozen for the step (blocs,
  // sanctions and wars do not move while the relations drift).
  inputs?: AffinityInputs;
  // Military power of every nation for the step, and their sum.
  power?: Map<NationId, number>;
}

export type LiftReason =
  | "relations"
  | "regime"
  | "friendly"
  | "vote"
  | "player"
  | "peace";

// The partners whose pair with `id` drifts at the updates of `id`, cached
// (the player of a campaign never changes).
const ownedCache = new WeakMap<
  readonly NationId[],
  { player: NationId | null; owned: Map<NationId, NationId[]> }
>();
function ownedPartners(
  ctx: EconomyContext,
  id: NationId,
  player: NationId | null,
): readonly NationId[] {
  let cache = ownedCache.get(ctx.nationIds);
  if (cache === undefined || cache.player !== player) {
    cache = { player, owned: new Map() };
    ownedCache.set(ctx.nationIds, cache);
  }
  let owned = cache.owned.get(id);
  if (owned === undefined) {
    owned = ctx.nationIds.filter(
      (other) => other !== id && pairOwner(id, other, player) === id,
    );
    cache.owned.set(id, owned);
  }
  return owned;
}

// The nation whose update makes a pair drift (J7): the player for its own
// pairs, otherwise the first of the two in the order of the ids.
export function pairOwner(
  a: NationId,
  b: NationId,
  player: NationId | null,
): NationId {
  if (player !== null && (a === player || b === player)) return player;
  return a < b ? a : b;
}

function powerOf(env: DiplomacyStepEnv): Map<NationId, number> {
  env.power ??= new Map(
    env.ctx.nationIds.map((n) => [n, militaryPower(env.ctx, env.military, n)]),
  );
  return env.power;
}

function inputsOf(env: DiplomacyStepEnv): AffinityInputs {
  env.inputs ??= cachedAffinityInputs(env.ctx, env.state, env.date);
  return env.inputs;
}

// Aggressors of a war declared without casus belli in the campaign: they
// mend no relation while it lasts.
function unjustAggressors(state: DiplomacyState): Set<NationId> {
  const out = new Set<NationId>();
  for (const war of state.wars) {
    if (!war.declaredInCampaign || war.casusBelli !== null) continue;
    for (const a of war.aggressors) out.add(a);
  }
  return out;
}

// 0. War memory fades (J6): halves every halfLifeYears.
export function decayWarMemoryOf(
  ctx: EconomyContext,
  state: DiplomacyState,
  id: NationId,
  months: number,
): void {
  const memory = state.warMemory[id];
  if (memory === undefined) return;
  const halfLife = ctx.config.ai.nations.war.memory.halfLifeYears;
  const next = memory * Math.pow(0.5, months / (12 * halfLife));
  if (next < MEMORY_FLOOR) delete state.warMemory[id];
  else state.warMemory[id] = next;
}

// 1. The relations the nation owns drift towards their affinity over
//    `months`; belligerents stay at warRelation. An aggressor without casus
//    belli mends nothing while its war lasts: its relations only erode.
export function driftRelationsOf(
  env: DiplomacyStepEnv,
  id: NationId,
  months: number,
): void {
  const { ctx, state } = env;
  const cfg = ctx.config.diplomacy;
  const inputs = inputsOf(env);
  const unjust = unjustAggressors(state);
  const foes = new Set(enemiesOf(state, id));
  const warRelation = clamp(cfg.warRelation, -100, 100);
  const decay = cfg.relationDecayPerMonth * months;
  const recovery = cfg.relationRecoveryPerMonth * months;
  const idUnjust = unjust.has(id);
  const ownRow = (state.relations[id] ??= {});
  for (const other of ownedPartners(ctx, id, env.player)) {
    const first = id < other;
    const a = first ? id : other;
    const b = first ? other : id;
    const row = first ? ownRow : (state.relations[a] ??= {});
    const r = row[b] ?? 0;
    if (foes.has(other)) {
      if (r !== warRelation) row[b] = warRelation;
      continue;
    }
    const target = affinityOf(ctx, state, env.politics, a, b, false, inputs);
    const mending = !idUnjust && !unjust.has(other);
    const next =
      r > target
        ? Math.max(target, r - decay)
        : mending
          ? Math.min(target, r + recovery)
          : r;
    if (next !== r || row[b] === undefined) row[b] = clamp(next, -100, 100);
  }
}

// 2. A war of aggression without casus belli keeps costing relations: the
//    aggressor pays its months of war at its own updates.
export function chargeUnjustAggressorOf(
  env: DiplomacyStepEnv,
  id: NationId,
  months: number,
): void {
  for (const war of env.state.wars) {
    if (!war.declaredInCampaign || war.casusBelli !== null) continue;
    if (!war.aggressors.includes(id)) continue;
    chargeAggressor(env.ctx, env.state, env.military, war, id, months);
  }
}

// 3. Sanctions an AI nation imposes on the aggressors it resents: always on
//    one it fights, otherwise when it shares a bloc with a victim or the
//    aggressor weighs more than a share of the total power. The sanction
//    remembers the war it answers (J7).
export function imposeSanctionsOf(
  env: DiplomacyStepEnv,
  id: NationId,
): DiplomacyEvent[] {
  const { ctx, state } = env;
  const cfg = ctx.config.diplomacy;
  const events: DiplomacyEvent[] = [];
  const power = powerOf(env);
  let totalPower = 0;
  for (const p of power.values()) totalPower += p;
  for (const war of state.wars) {
    if (warSide(war, id) === "aggressors") continue;
    for (const aggressor of war.aggressors) {
      if (aggressor === id || isSanctioning(state, id, aggressor)) continue;
      if (relation(state, id, aggressor) >= cfg.sanction.relationsBelow)
        continue;
      const fought = warSide(war, id) === "defenders";
      const bloc = war.defenders.some(
        (d) => d !== id && ctx.commonBlocs(id, d) > 0,
      );
      const heavy =
        totalPower > 0 &&
        (power.get(aggressor) ?? 0) / totalPower >
          cfg.sanction.aggressorPowerShare;
      if (!fought && !bloc && !heavy) continue;
      const event = imposeSanctions(
        ctx,
        state,
        env.economy,
        id,
        aggressor,
        env.date,
      );
      if (event === null) continue;
      const record = state.sanctions.find(
        (s) => s.by === id && s.against === aggressor,
      );
      if (record !== undefined) record.war = war.id;
      events.push(event);
    }
  }
  return events;
}

// 4. The sanctions an AI nation lifts (J7, answer 2 of Lukas to the J6):
//    never while the target wages a war of aggression, nor one the bloc
//    holds (its vote lifts it); otherwise
//    (a) after a change of regime of the target, at the review the issuer
//        holds within the six months that follow: lifted with a
//        probability (reviewLiftProbability);
//    (b) once its relation with the target has stayed >= 0 for
//        friendlyMonths and the war the sanction answered is over;
//    and a sanction imposed in the campaign as soon as the relations have
//    healed above liftAboveRelations (J3).
export function liftSanctionsOf(
  env: DiplomacyStepEnv,
  id: NationId,
): { event: DiplomacyEvent; reason: LiftReason }[] {
  const { ctx, state } = env;
  const cfg = ctx.config.diplomacy.sanction;
  const out: { event: DiplomacyEvent; reason: LiftReason }[] = [];
  const waging = new Set(state.wars.flatMap((w) => w.aggressors));
  for (const sanction of state.sanctions.filter((s) => s.by === id)) {
    const r = relation(state, id, sanction.against);
    // (b) runs its clock whatever happens to the rest.
    if (r >= 0) sanction.friendlySince ??= env.date;
    else delete sanction.friendlySince;
    if (env.blocHeld(id, sanction.against)) continue;
    if (waging.has(sanction.against)) continue;
    let reason: LiftReason | null = null;
    if (sanction.reviewBy !== undefined && env.date >= sanction.reviewBy) {
      delete sanction.reviewBy;
      if (env.rng.next() < cfg.reviewLiftProbability) reason = "regime";
    }
    const warOver =
      sanction.war === undefined ||
      !state.wars.some((w) => w.id === sanction.war);
    if (
      reason === null &&
      sanction.friendlySince !== undefined &&
      warOver &&
      monthsSinceDate(sanction.friendlySince, env.date) >= cfg.friendlyMonths
    ) {
      reason = "friendly";
    }
    if (
      reason === null &&
      sanction.policy !== true &&
      r >= cfg.liftAboveRelations
    ) {
      reason = "relations";
    }
    if (reason === null) continue;
    const event = liftSanctions(ctx, state, env.economy, id, sanction.against);
    if (event !== null) out.push({ event, reason });
  }
  return out;
}

// After a change of regime of `nation`, every issuer of a sanction against
// it holds a review within reviewMonths (J7, way (a)): its date is drawn.
export function scheduleSanctionReviews(
  ctx: EconomyContext,
  state: DiplomacyState,
  rng: Rng,
  nation: NationId,
  date: string,
): void {
  const days = Math.round(
    ctx.config.diplomacy.sanction.reviewMonths * DAYS_PER_MONTH,
  );
  for (const s of state.sanctions) {
    if (s.against !== nation) continue;
    s.reviewBy = addDaysIso(date, rng.nextInt(1, days + 1));
  }
}

// The player lifts one of its sanctions (J7): its allies that keep theirs
// against the same target resent it.
export function playerLiftCost(
  ctx: EconomyContext,
  state: DiplomacyState,
  player: NationId,
  against: NationId,
): void {
  const cost = ctx.config.diplomacy.sanction.playerLiftAllyRelations;
  for (const s of state.sanctions) {
    if (s.against !== against || s.by === player) continue;
    if (!allies(ctx, player, s.by)) continue;
    addRelation(state, player, s.by, -cost);
  }
}

// 5. Coalitions against an aggressor without casus belli that outweighs its
//    victim (the nation attacked, not the coalition that joined it), and
//    J5: against a nuclear shooter, whatever its side, power or casus
//    belli. An AI nation able to fight (a land neighbour of the side it
//    would fight, or an ally of the principal of the side it would join:
//    J6c) and hostile enough is called; it answers within windowMonths with
//    a monthly probability, over the months since its last update.
export function answerCoalitionsOf(
  env: DiplomacyStepEnv,
  id: NationId,
  months: number,
): DiplomacyEvent[] {
  const { ctx, state } = env;
  const cfg = ctx.config.diplomacy;
  const events: DiplomacyEvent[] = [];
  const power = powerOf(env);
  for (const war of state.wars) {
    if (warSide(war, id) !== null) continue;
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
        (s, n) => s + (power.get(n) ?? 0),
        0,
      );
      const victimPower = power.get(war.defenders[0]) ?? 0;
      if (aggressorPower <= cfg.coalition.powerRatio * victimPower) continue;
      against = "aggressors";
    }
    const side = against === "aggressors" ? "defenders" : "aggressors";
    const principal = war[side][0];
    const hostile = war[against].some(
      (a) => relation(state, id, a) < cfg.coalition.relationsBelow,
    );
    if (!hostile) continue;
    const able =
      war[against].some((a) => ctx.landNeighbours(id, a)) ||
      (principal !== undefined && allies(ctx, id, principal));
    if (!able) continue;
    if (
      !state.coalitionCalls.some((c) => c.war === war.id && c.nation === id)
    ) {
      state.coalitionCalls.push({
        war: war.id,
        nation: id,
        until: addMonths(env.date, cfg.coalition.windowMonths),
        side,
      });
    }
  }
  for (const call of state.coalitionCalls.filter((c) => c.nation === id)) {
    const war = state.wars.find((w) => w.id === call.war);
    const remove = () =>
      state.coalitionCalls.splice(state.coalitionCalls.indexOf(call), 1);
    if (war === undefined || warSide(war, id) !== null) {
      remove();
      continue;
    }
    if (env.date >= call.until) {
      remove();
      continue;
    }
    if (env.rng.next() < chanceOver(cfg.coalition.monthlyProbability, months)) {
      joinWar(ctx, state, war, id, call.side);
      events.push({
        type: "war-joined",
        nation: id,
        war: war.id,
        against:
          call.side === "defenders" ? war.aggressors[0] : war.defenders[0],
      });
      remove();
    }
  }
  return events;
}

// What an update of one nation does in diplomacy, in that order. The
// relations it owns drift over `driftMonths` (the caller drifts them at
// most once a month, 0: not this time).
export function stepDiplomacyNation(
  env: DiplomacyStepEnv,
  id: NationId,
  months: number,
  driftMonths: number = months,
): { events: DiplomacyEvent[]; lifts: LiftReason[] } {
  decayWarMemoryOf(env.ctx, env.state, id, months);
  if (driftMonths > 0) driftRelationsOf(env, id, driftMonths);
  chargeUnjustAggressorOf(env, id, months);
  const events: DiplomacyEvent[] = [];
  const lifts: LiftReason[] = [];
  if (env.aiNations.includes(id)) {
    events.push(...imposeSanctionsOf(env, id));
    for (const lift of liftSanctionsOf(env, id)) {
      events.push(lift.event);
      lifts.push(lift.reason);
    }
    events.push(...answerCoalitionsOf(env, id, months));
  }
  return { events, lifts };
}

// The whole world for `months` (one month: the step of the J3 to the J6,
// phase by phase — the tests and the warm-up).
export function stepDiplomacyMonth(
  ctx: EconomyContext,
  state: DiplomacyState,
  economy: EconomyState,
  military: MilitaryState,
  politics: PoliticsState,
  rng: Rng,
  date: string,
  aiNations: readonly NationId[],
  blocHeld: (by: NationId, against: NationId) => boolean = () => false,
  player: NationId | null = null,
  months = 1,
): DiplomacyEvent[] {
  const env: DiplomacyStepEnv = {
    ctx,
    state,
    economy,
    military,
    politics,
    rng,
    date,
    aiNations,
    player,
    blocHeld,
  };
  const ids = [...ctx.nationIds].sort();
  for (const id of ids) decayWarMemoryOf(ctx, state, id, months);
  for (const id of ids) driftRelationsOf(env, id, months);
  for (const id of ids) chargeUnjustAggressorOf(env, id, months);
  const events: DiplomacyEvent[] = [];
  for (const id of aiNations) events.push(...imposeSanctionsOf(env, id));
  for (const id of aiNations) {
    for (const lift of liftSanctionsOf(env, id)) events.push(lift.event);
  }
  for (const id of aiNations) {
    events.push(...answerCoalitionsOf(env, id, months));
  }
  return events;
}

// Whole calendar months between two ISO dates (day of the month counted).
function monthsSinceDate(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
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
