import { NationId } from "../data/schemas/common";
import { NationData } from "../data/schemas/nation";
import {
  AiState,
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
import { dateOfDay } from "../sim/calendar";
import {
  availableCasusBelli,
  declareWar,
  DiplomacyEvent,
  enemiesOf,
  relation,
} from "../sim/diplomacy/diplomacy";
import { EconomyContext } from "../sim/economy/context";
import { landingControl, setBlockade } from "../sim/naval/naval";
import { Rng } from "../sim/rng";
import { WorldPort } from "../sim/VeritableSim";
import { militaryPower } from "../sim/war/military";

// The AI of the nations nobody plays (J5).
//
// Asymmetric by design: a regime, a stability, the traits of the leader in
// place and an agenda of the sheet (security, growth, regional influence,
// ideology), no interest groups. Decisions are staggered: every core tick a
// tenth of the nations come up, and a nation decides when its period has
// passed, a month without stakes, a week at war, in crisis or facing the
// player. It sets its defence effort by the threat, may declare a war (only
// with a casus belli or a very aggressive leader, twice the power of the
// target, a land border, an expected gain above the expected cost, never
// against a nuclear power unless nuclear itself), blockades the enemies it
// fights by sea and lands when it controls the zone. Once a month a nation at
// peace may send arms to a friend at war with a foe. Sanctions, peace,
// conscription and the fronts keep their rules (diplomacy.ts, peace.ts,
// ai/war.ts).

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
  nations: readonly NationState[];
  sheets: ReadonlyMap<NationId, NationData>;
  scenario: Scenario;
  aiNations: readonly NationId[];
  player: NationId | null;
  date: string;
}

const addDays = (date: string, days: number) => dateOfDay(date, days);

export function initAi(ids: readonly NationId[], date: string): AiState {
  return {
    cursor: 0,
    nations: Object.fromEntries(
      ids.map((id, i) => [
        id,
        {
          // Spread the first reviews over the first month.
          nextReview: addDays(date, i % 30),
          defenseGoal: 0,
          lastWar: null,
          lastLanding: null,
          blockading: null,
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

// --- the staggered cycle ---------------------------------------------------------------

// The nations that come up this tick: about a tenth of them, round-robin.
export function dueThisTick(env: AiEnv): NationId[] {
  const ids = env.ctx.nationIds;
  if (ids.length === 0) return [];
  const cfg = env.ctx.config.ai.nations;
  const count = Math.max(1, Math.round(cfg.reviewShare * ids.length));
  const due: NationId[] = [];
  for (let i = 0; i < count; i++) {
    const id = ids[(env.ai.cursor + i) % ids.length];
    if (!env.aiNations.includes(id)) continue;
    const state = env.ai.nations[id];
    if (state !== undefined && state.nextReview <= env.date) due.push(id);
  }
  env.ai.cursor = (env.ai.cursor + count) % ids.length;
  return due;
}

export function review(env: AiEnv, id: NationId): AiEvent[] {
  const cfg = env.ctx.config.ai.nations;
  const state = env.ai.nations[id];
  state.nextReview = addDays(
    env.date,
    hasStakes(env, id) ? cfg.reviewDaysStakes : cfg.reviewDaysCalm,
  );
  const events: AiEvent[] = [];
  setDefenseGoal(env, id);
  const war = considerWar(env, id);
  if (war !== null) events.push(war);
  events.push(...navy(env, id));
  return events;
}

// --- defence --------------------------------------------------------------------------

// Defence effort by the threat: at war, facing a stronger hostile neighbour,
// weighted by the security agenda; the fiscal rule follows the goal.
function setDefenseGoal(env: AiEnv, id: NationId): void {
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
    economy.spendingTargets.defense += (goal - target) * cfg.rampPerReview;
  }
}

// --- war ----------------------------------------------------------------------------------

export interface WarAppraisal {
  target: NationId;
  casusBelli: string;
  powerRatio: number;
  // US$ in total: the land over the gain horizon, the costs over the
  // expected war.
  gain: number;
  cost: number;
}

// Share of the partners of `id` (trade weights) likely to sanction it for a
// war on `target`: those that share a bloc with the target.
function expectedSanctions(env: AiEnv, id: NationId, target: NationId): number {
  const blocs = env.ctx.blocsOf(target);
  let total = 0;
  let hostile = 0;
  for (const other of env.ctx.nationIds) {
    if (other === id) continue;
    const w = env.ctx.partnerWeight(id, other);
    total += w;
    const shares =
      other === target || env.ctx.blocsOf(other).some((b) => blocs.includes(b));
    if (shares) hostile += w;
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
  const theirs = militaryPower(env.ctx, env.military, target);
  const powerRatio = theirs > 0 ? mine / theirs : Infinity;
  if (powerRatio < cfg.powerRatio) return null;
  const own = env.economy.nations[id];
  const their = env.economy.nations[target];
  if (own === undefined || their === undefined) return null;
  const landShare = Math.min(
    cfg.maxLandShare,
    cfg.landSharePerPowerRatio * (Math.min(powerRatio, 10) - 1),
  );
  const gain =
    (casusBelli === "none" ? 1 : cfg.casusBelliMotive) *
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
    expectedSanctions(env, id, target);
  const cost =
    cfg.expectedWarYears *
    own.gdp *
    (sanctions +
      cfg.exhaustionCostPctGdp +
      cfg.reputationCostPctGdp * (casusBelli === "none" ? 3 : 1)) *
    (0.5 + agenda(env, id, "growth"));
  return { target, casusBelli, powerRatio, gain, cost };
}

function considerWar(env: AiEnv, id: NationId): DiplomacyEvent | null {
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
    .filter((a): a is WarAppraisal => a !== null && a.gain > a.cost)
    .sort((a, b) => b.gain - b.cost - (a.gain - a.cost));
  if (options.length === 0) return null;
  // Even a war that pays is not declared on a whim.
  if (
    env.rng.next() >=
    cfg.declareProbability * (0.5 + aggressiveness(env, id))
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
  const snapshot = env.world.naval();
  const enemies = enemiesOf(env.diplomacy, id);
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

// Once a month: a nation at peace sends a share of its arms, taken first from
// its exports, to the belligerent it likes most (relations above the mark)
// fighting an enemy it dislikes (below the mark). Returns the index points
// each nation gets (negative: what a donor takes from its own stock beyond
// its exports) and the budget cost of each donor.
export function stepArmsFlows(env: AiEnv): {
  events: AiEvent[];
  points: Record<NationId, number>;
  cost: Record<NationId, number>;
} {
  const cfg = env.ctx.config.ai.nations.armsAid;
  const points: Record<NationId, number> = {};
  const cost: Record<NationId, number> = {};
  const flows: AiState["armsAid"] = [];
  for (const donor of env.aiNations) {
    if (enemiesOf(env.diplomacy, donor).length > 0) continue;
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
    if (best === null) continue;
    const economy = env.economy.nations[donor];
    if (economy === undefined) continue;
    const monthly = (economy.production.arms * economy.coverage.arms) / 12;
    const sent = cfg.share * monthly;
    if (sent <= 0) continue;
    const fromExports = Math.min(sent, economy.exports.arms / 12);
    points[best] = (points[best] ?? 0) + sent;
    points[donor] = (points[donor] ?? 0) - (sent - fromExports);
    cost[donor] =
      (cost[donor] ?? 0) + sent * env.ctx.good("arms").basePrice * 1e6;
    flows.push({ from: donor, to: best, points: sent });
  }
  const events: AiEvent[] = [];
  const key = (f: { from: string; to: string }) => `${f.from}>${f.to}`;
  const before = new Set(env.ai.armsAid.map(key));
  const after = new Set(flows.map(key));
  for (const f of flows) {
    if (!before.has(key(f))) {
      events.push({ type: "arms-aid-started", nation: f.from, to: f.to });
    }
  }
  for (const f of env.ai.armsAid) {
    if (!after.has(key(f))) {
      events.push({ type: "arms-aid-ended", nation: f.from, to: f.to });
    }
  }
  env.ai.armsAid = flows;
  return { events, points, cost };
}
