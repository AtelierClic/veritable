import { NationId } from "../data/schemas/common";
import { NationData } from "../data/schemas/nation";
import {
  AiState,
  BlocsState,
  DiplomacyState,
  EconomyState,
  MilitaryState,
  NationAi,
  NationState,
  NavalState,
  NuclearState,
  PoliticsState,
} from "../data/schemas/save";
import { Scenario } from "../data/schemas/scenario";
import { defenseGuarantors } from "../sim/blocs/blocs";
import { claimWeight } from "../sim/diplomacy/claims";
import {
  allies,
  availableCasusBelli,
  declarationRelationsCost,
  declareWar,
  DiplomacyEvent,
  enemiesOf,
  relation,
  warMemoryOf,
} from "../sim/diplomacy/diplomacy";
import { EconomyContext } from "../sim/economy/context";
import { landingControl, setBlockade } from "../sim/naval/naval";
import { Rng } from "../sim/rng";
import { chanceOver, relaxed } from "../sim/time";
import { WorldPort } from "../sim/VeritableSim";
import { militaryPower } from "../sim/war/military";

// The AI of the nations nobody plays (J5).
//
// Asymmetric by design: a regime, a stability, the traits of the leader in
// place and an agenda of the sheet (security, growth, regional influence,
// ideology), no interest groups. J7: a nation decides at each of its updates
// in the rolling queue of the simulation (sim/schedule.ts), a week to a
// month apart; the odds and ramps of a review keep their J5 value per time,
// a review standing for reviewDaysStakes days with stakes (war, crisis, a
// dealing with the player) and reviewDaysCalm without. It sets its defence
// effort by the threat, may declare a war (only
// with a casus belli or a very aggressive leader, twice the power of the
// target, a land border, an expected gain above the expected cost, never
// against a nuclear power unless nuclear itself), blockades the enemies it
// fights by sea and lands when it controls the zone. Once a month a nation at
// peace may send arms to a friend at war with a foe. Sanctions, peace,
// conscription and the fronts keep their rules (diplomacy.ts, peace.ts,
// ai/war.ts).
//
// J6: a nation remembers its wars (the gain it asks of a new war rises with
// its war memory), weighs the claim it would fight for (weakened by past
// failures), and counts the help its target would get: arms from its friends
// and the members of its collective-defence blocs.

export type AiEvent =
  | DiplomacyEvent
  | { type: "arms-aid-started"; nation: NationId; to: NationId }
  | { type: "arms-aid-ended"; nation: NationId; to: NationId }
  | { type: "ai-landing"; nation: NationId; target: NationId };

export interface AiEnv {
  ctx: EconomyContext;
  rng: Rng;
  world: WorldPort;
  ai: AiState;
  diplomacy: DiplomacyState;
  economy: EconomyState;
  military: MilitaryState;
  politics: PoliticsState;
  naval: NavalState;
  nuclear: NuclearState;
  blocs: BlocsState;
  nations: readonly NationState[];
  sheets: ReadonlyMap<NationId, NationData>;
  scenario: Scenario;
  aiNations: readonly NationId[];
  player: NationId | null;
  date: string;
}

export function initAi(ids: readonly NationId[]): AiState {
  return {
    nations: Object.fromEntries(
      ids.map((id) => [
        id,
        {
          defenseGoal: 0,
          lastWar: null,
          lastLanding: null,
          blockading: null,
          lastOrders: null,
        } satisfies NationAi,
      ]),
    ),
    armsAid: [],
  };
}

function agenda(env: AiEnv, id: NationId, goal: string): number {
  const list = env.sheets.get(id)?.aiAgenda;
  if (list === undefined) return 0.25;
  return list.find((g) => g.goal === goal)?.weight ?? 0;
}

function aggressiveness(env: AiEnv, id: NationId): number {
  return env.politics.nations[id]?.leader.traits.aggressiveness ?? 0.5;
}

function hasWarheads(env: AiEnv, id: NationId): boolean {
  return (env.nuclear.nations[id]?.warheads ?? 0) > 0;
}

// A war, a crisis, or a dealing with the player: the nation decides weekly.
export function hasStakes(env: AiEnv, id: NationId): boolean {
  if (enemiesOf(env.diplomacy, id).length > 0) return true;
  const p = env.politics.nations[id];
  if (
    p !== undefined &&
    (p.unrest || p.stability < env.ctx.config.ai.nations.crisisStability)
  ) {
    return true;
  }
  const player = env.player;
  if (player === null || player === id) return false;
  return env.diplomacy.sanctions.some(
    (s) =>
      (s.by === player && s.against === id) ||
      (s.by === id && s.against === player),
  );
}

// --- the review ---------------------------------------------------------------------

// How many reviews of the J5 an update covering `days` stands for: the odds
// per review and the ramps keep their value per time (J7).
export function reviewsIn(env: AiEnv, id: NationId, days: number): number {
  const cfg = env.ctx.config.ai.nations;
  const period = hasStakes(env, id) ? cfg.reviewDaysStakes : cfg.reviewDaysCalm;
  return Math.max(0, days) / period;
}

// The review of a nation at its update, covering `days` of game time (one
// review of its period by default).
export function review(env: AiEnv, id: NationId, days?: number): AiEvent[] {
  const reviews = days === undefined ? 1 : reviewsIn(env, id, days);
  const events: AiEvent[] = [];
  setDefenseGoal(env, id, reviews);
  const war = considerWar(env, id, reviews);
  if (war !== null) events.push(war);
  events.push(...navy(env, id));
  return events;
}

// --- defence --------------------------------------------------------------------------

// Defence effort by the threat: at war, facing a stronger hostile neighbour,
// weighted by the security agenda; the fiscal rule follows the goal.
function setDefenseGoal(env: AiEnv, id: NationId, reviews = 1): void {
  const cfg = env.ctx.config.ai.nations.defense;
  const economy = env.economy.nations[id];
  if (economy === undefined) return;
  const base = economy.spending0.defense;
  const mine = militaryPower(env.ctx, env.military, id);
  let boost = 0;
  if (enemiesOf(env.diplomacy, id).length > 0) boost = cfg.warBoost;
  else {
    for (const other of env.ctx.nationIds) {
      if (other === id || !env.ctx.landNeighbours(id, other)) continue;
      if (relation(env.diplomacy, id, other) >= cfg.hostileRelation) continue;
      if (militaryPower(env.ctx, env.military, other) > mine) {
        boost = Math.max(boost, cfg.hostileBoost);
      }
    }
  }
  const goal = Math.min(
    cfg.maxShare,
    base * (1 + boost * (0.5 + agenda(env, id, "security"))),
  );
  const state = env.ai.nations[id];
  state.defenseGoal = goal;
  // The AI only raises defence under a threat; without one, or when the
  // nation already spends more (Ukraine), the fiscal rule decides.
  const target = economy.spendingTargets.defense;
  if (boost > 0 && goal > target) {
    economy.spendingTargets.defense +=
      (goal - target) * relaxed(cfg.rampPerReview, reviews);
  }
}

// --- war ----------------------------------------------------------------------------------

export interface WarAppraisal {
  target: NationId;
  casusBelli: string;
  // Own power over the power the target would field, the help it would get
  // included (J6).
  powerRatio: number;
  // US$ in total: the land over the gain horizon, the costs over the
  // expected war.
  gain: number;
  cost: number;
  // War memory of the nation (J6): the war is worth it when gain > cost x
  // (1 + memory).
  memory: number;
}

// Power the target of a war would field (J6): its own, raised by the arms
// its friends would send (nations above the arms-aid mark with it: their
// monthly share of arms over its own arms, capped), plus the members of its
// collective-defence blocs weighted by the chance they honour the clause.
function defendedPower(env: AiEnv, id: NationId, target: NationId): number {
  const cfg = env.ctx.config.ai.nations;
  const own = militaryPower(env.ctx, env.military, target);
  const armsOf = (n: NationId) => {
    const e = env.economy.nations[n];
    return e === undefined ? 0 : e.production.arms * e.coverage.arms;
  };
  let donated = 0;
  for (const other of env.ctx.nationIds) {
    if (other === id || other === target) continue;
    if (relation(env.diplomacy, other, target) <= cfg.armsAid.donorRelations)
      continue;
    donated += cfg.armsAid.share * armsOf(other);
  }
  const ownArms = armsOf(target);
  const boost =
    donated <= 0
      ? 0
      : ownArms > 0
        ? Math.min(cfg.war.aid.armsBoostCap, donated / ownArms)
        : cfg.war.aid.armsBoostCap;
  let guarantees = 0;
  for (const g of defenseGuarantors(
    env.ctx,
    env.blocs,
    env.politics,
    target,
    id,
  )) {
    guarantees +=
      g.probability * militaryPower(env.ctx, env.military, g.nation);
  }
  return own * (1 + boost) + guarantees;
}

// Share of the partners of `id` (trade weights) likely to sanction it for a
// war on `target`, by the rule the AI nations follow (sim/diplomacy): the
// target itself, and the partners that share a bloc with it and whose
// relations with `id` would fall under the sanction threshold — the cost of
// the declaration (every month of the war without casus belli), and the
// drift of an ally of the target towards a lower affinity (J6c). Counting
// every partner sharing any bloc with the target, forums included, made
// every war too dear at the scale of the world.
function expectedSanctions(
  env: AiEnv,
  id: NationId,
  target: NationId,
  casusBelli: string,
): number {
  const cfg = env.ctx.config;
  const months = 12 * cfg.ai.nations.war.expectedWarYears;
  const perCharge = declarationRelationsCost(
    env.ctx,
    env.military,
    id,
    casusBelli,
  );
  const fall = casusBelli === "none" ? perCharge * months : perCharge;
  const drift = Math.min(
    cfg.diplomacy.affinityAllyAtWar,
    cfg.diplomacy.relationDecayPerMonth * months,
  );
  let total = 0;
  let hostile = 0;
  for (const other of env.ctx.nationIds) {
    if (other === id) continue;
    const w = env.ctx.partnerWeight(id, other);
    total += w;
    if (other === target) {
      hostile += w;
      continue;
    }
    if (env.ctx.commonBlocs(other, target) === 0) continue;
    const after =
      relation(env.diplomacy, other, id) -
      fall -
      (allies(env.ctx, other, target) ? drift : 0);
    if (after < cfg.diplomacy.sanction.relationsBelow) hostile += w;
  }
  return total > 0 ? hostile / total : 0;
}

// What a war of `id` on `target` would bring and cost; null when the rules
// of the design forbid it.
export function appraiseWar(
  env: AiEnv,
  id: NationId,
  target: NationId,
): WarAppraisal | null {
  const cfg = env.ctx.config.ai.nations.war;
  if (!env.ctx.landNeighbours(id, target)) return null;
  if (hasWarheads(env, target) && !hasWarheads(env, id)) return null;
  if (relation(env.diplomacy, id, target) > cfg.maxRelations) return null;
  const cbs = availableCasusBelli(
    env.ctx,
    env.diplomacy,
    env.politics,
    env.scenario,
    id,
    target,
  );
  const real = cbs.filter((c) => c !== "none");
  let casusBelli: string;
  if (real.length > 0) casusBelli = real[0];
  else if (aggressiveness(env, id) > cfg.aggressivenessWithoutCasusBelli)
    casusBelli = "none";
  else return null;
  const mine = militaryPower(env.ctx, env.military, id);
  const alone = militaryPower(env.ctx, env.military, target);
  const theirs = defendedPower(env, id, target);
  const powerRatio = theirs > 0 ? mine / theirs : Infinity;
  if (powerRatio < cfg.powerRatio) return null;
  const own = env.economy.nations[id];
  const their = env.economy.nations[target];
  if (own === undefined || their === undefined) return null;
  const landShare = Math.min(
    cfg.maxLandShare,
    cfg.landSharePerPowerRatio * (Math.min(powerRatio, 10) - 1),
  );
  // A justified war also serves the government at home (J5); a claim
  // weakened by failed wars less so (J6). J6c: the weight multiplies the
  // motive, as the rule of the J6 says — the J6a kept the motive of a war
  // without casus belli as a floor, and a claim that failed again and again
  // (Syria on the north-east across a nine-tile gap of the Euphrates) was
  // pressed every six years for fifty years.
  const motive =
    casusBelli === "none"
      ? 1
      : casusBelli === "contested-territory"
        ? cfg.casusBelliMotive * claimWeight(env.ctx, env.diplomacy, id, target)
        : cfg.casusBelliMotive;
  // Help to the target lengthens the war (J6).
  const duration =
    alone > 0
      ? Math.min(cfg.aid.durationCap, theirs / alone)
      : cfg.aid.durationCap;
  const gain =
    motive *
    cfg.gainHorizonYears *
    landShare *
    their.gdp *
    env.ctx.config.war.contest.valueShare *
    (0.5 +
      agenda(env, id, "regional-influence") +
      0.5 * agenda(env, id, "security"));
  const sanctions =
    env.ctx.config.economy.sanctionFriction *
    own.tradeOpenness *
    expectedSanctions(env, id, target, casusBelli);
  // J6c: exhaustion and reputation scale with the size of the war — the
  // losses that wear a nation out fall as the gap in power grows; a war on a
  // much weaker neighbour does not cost what a war on an equal does. Full at
  // the least ratio the AI goes to war with.
  const scale = Math.min(1, cfg.powerRatio / powerRatio);
  const cost =
    cfg.expectedWarYears *
    duration *
    own.gdp *
    (sanctions +
      scale *
        (cfg.exhaustionCostPctGdp +
          cfg.reputationCostPctGdp * (casusBelli === "none" ? 3 : 1))) *
    (0.5 + agenda(env, id, "growth"));
  return {
    target,
    casusBelli,
    powerRatio,
    gain,
    cost,
    memory: warMemoryOf(env.diplomacy, id),
  };
}

function considerWar(
  env: AiEnv,
  id: NationId,
  reviews = 1,
): DiplomacyEvent | null {
  const cfg = env.ctx.config.ai.nations.war;
  if (enemiesOf(env.diplomacy, id).length > 0) return null;
  const state = env.ai.nations[id];
  if (
    state.lastWar !== null &&
    monthsBetween(state.lastWar, env.date) < cfg.minMonthsBetweenWars
  ) {
    return null;
  }
  if ((env.military.nations[id]?.exhaustion ?? 0) > 0.2) return null;
  const options = env.ctx.nationIds
    .filter((t) => t !== id)
    .map((t) => appraiseWar(env, id, t))
    .filter(
      (a): a is WarAppraisal => a !== null && a.gain > a.cost * (1 + a.memory),
    )
    .sort((a, b) => b.gain - b.cost - (a.gain - a.cost));
  if (options.length === 0) return null;
  // Even a war that pays is not declared on a whim.
  if (
    env.rng.next() >=
    chanceOver(
      cfg.declareProbability * (0.5 + aggressiveness(env, id)),
      reviews,
    )
  )
    return null;
  const best = options[0];
  state.lastWar = env.date;
  return declareWar(
    env.ctx,
    env.diplomacy,
    env.politics,
    env.military,
    env.scenario,
    id,
    best.target,
    best.casusBelli,
    env.date,
  );
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

// --- navy -----------------------------------------------------------------------------------

// The fleet blockades the coast of the enemy it fights (the first with a
// coast), home in peace; a landing when the zone is held.
function navy(env: AiEnv, id: NationId): AiEvent[] {
  const cfg = env.ctx.config.ai.nations.navy;
  const enemies = enemiesOf(env.diplomacy, id);
  // J6c: at peace with its fleet at home there is nothing to do, and the
  // naval snapshot of 208 nations is not worth reading.
  if (enemies.length === 0 && env.ai.nations[id].blockading === null) {
    return [];
  }
  const snapshot = env.world.naval();
  // A fleet only sails against a weaker one: a small navy stays home.
  const fleet = (n: NationId) => env.military.nations[n]?.navalPower ?? 0;
  const coastal = enemies.filter(
    (e) =>
      ((snapshot.coast[e] ?? []).length > 0 ||
        (snapshot.ports[e] ?? []).length > 0) &&
      fleet(id) > fleet(e),
  );
  const state = env.ai.nations[id];
  if (coastal.length === 0) {
    if (state.blockading !== null) {
      setBlockade(env.naval, snapshot, id, id, false);
      state.blockading = null;
    }
    return [];
  }
  const target = coastal[0];
  if (state.blockading !== target) {
    setBlockade(env.naval, snapshot, id, target, true);
    state.blockading = target;
  }
  if (
    state.lastLanding !== null &&
    monthsBetween(state.lastLanding, env.date) < cfg.landingCooldownMonths
  ) {
    return [];
  }
  // A landing only where no land front reaches the enemy.
  if (env.ctx.landNeighbours(id, target)) return [];
  const zone = env.world.landingZone(id, target);
  if (zone === null) return [];
  if (landingControl(env.naval, zone, id, enemies) < cfg.landingControl)
    return [];
  if (
    !env.world.launchLanding(id, target, env.ctx.config.naval.landingRadius)
  ) {
    return [];
  }
  state.lastLanding = env.date;
  return [{ type: "ai-landing", nation: id, target }];
}

// --- arms flows -----------------------------------------------------------------------------

// A nation at peace sends a share of its monthly arms, taken first from its
// exports, to the belligerent it likes most (relations above the mark)
// fighting an enemy it dislikes (below the mark). J7: each donor at its
// update, over the months since the last one; the receiver gets the points
// at its next update (armsReceived), the donor pays at once.
export function armsFlowOf(
  env: AiEnv,
  donor: NationId,
  months: number,
): { events: AiEvent[]; cost: number } {
  const cfg = env.ctx.config.ai.nations.armsAid;
  const before = env.ai.armsAid.find((f) => f.from === donor);
  let flow: AiState["armsAid"][number] | null = null;
  let cost = 0;
  if (enemiesOf(env.diplomacy, donor).length === 0) {
    let best: NationId | null = null;
    let bestRelation = cfg.donorRelations;
    for (const r of env.ctx.nationIds) {
      if (r === donor) continue;
      const enemies = enemiesOf(env.diplomacy, r);
      if (enemies.length === 0) continue;
      if (
        !enemies.some(
          (e) => relation(env.diplomacy, donor, e) < cfg.enemyRelations,
        )
      ) {
        continue;
      }
      const rel = relation(env.diplomacy, donor, r);
      if (rel > bestRelation) {
        best = r;
        bestRelation = rel;
      }
    }
    const economy = env.economy.nations[donor];
    if (best !== null && economy !== undefined) {
      const monthly = (economy.production.arms * economy.coverage.arms) / 12;
      const perMonth = cfg.share * monthly;
      if (perMonth > 0) {
        const sent = perMonth * months;
        const fromExports = Math.min(
          sent,
          (economy.exports.arms / 12) * months,
        );
        const receiver = env.military.nations[best];
        if (receiver !== undefined) receiver.armsReceived += sent;
        const own = env.military.nations[donor];
        if (own !== undefined) own.armsReceived -= sent - fromExports;
        cost = sent * env.ctx.good("arms").basePrice * 1e6;
        flow = { from: donor, to: best, points: perMonth };
      }
    }
  }
  const events: AiEvent[] = [];
  env.ai.armsAid = env.ai.armsAid.filter((f) => f.from !== donor);
  if (flow !== null) env.ai.armsAid.push(flow);
  if (before !== undefined && (flow === null || flow.to !== before.to)) {
    events.push({ type: "arms-aid-ended", nation: donor, to: before.to });
  }
  if (flow !== null && (before === undefined || before.to !== flow.to)) {
    events.push({ type: "arms-aid-started", nation: donor, to: flow.to });
  }
  return { events, cost };
}
