import { NationId } from "../../data/schemas/common";
import { NationData } from "../../data/schemas/nation";
import {
  DiplomacyState,
  EconomyState,
  MilitaryState,
  NationNuclear,
  NationState,
  NuclearState,
  NuclearStrike,
  PoliticsState,
  TerritoryState,
} from "../../data/schemas/save";
import {
  DiplomacyEvent,
  enemiesOf,
  imposeSanctions,
  relation,
  setRelation,
} from "../diplomacy/diplomacy";
import { EconomyContext } from "../economy/context";
import { Rng } from "../rng";
import { FrontView, NukeAim, NukeOutcome, WorldPort } from "../VeritableSim";
import { frontId } from "../war/fronts";
import { militaryPower } from "../war/military";

// Nuclear weapons (J5).
//
// Every day, each nuclear nation gets a threat level (0 at peace, 1 at war,
// 2 when an enemy took land from it in a war going on or its capital is close
// to a front, 3 when it lost most of its land, its capital, or its regime is
// collapsing). A nation nobody plays may then fire at the enemy that
// threatens it most, with a daily probability
//   base[doctrine][level] x (0.5 + aggressiveness of its leader) x deterrence,
// deterrence being low when the target can answer (warheads of its own, or a
// collective-defence bloc with a nuclear member). The first shot aims at the
// military concentration of the front, the next ones at cities, capital
// first. Any shot: relations of everyone with the shooter at most -80,
// sanctions by every nation nobody plays, a coalition may form against the
// shooter whatever its power. A warhead that lands destroys a share of the
// production, GDP and population of the nation hit (fallout), with no
// reconstruction before the J7. At the annexation of a nuclear nation, its
// dead hand may strike the capital of the annexer.

export type NuclearEvent =
  | DiplomacyEvent
  | {
      type: "nuclear-launch";
      nation: NationId;
      target: NationId;
      aim: NuclearStrike["aim"];
      threat: number;
    }
  | {
      type: "nuclear-detonation";
      nation: NationId;
      by: NationId;
      tiles: number;
    }
  | { type: "nuclear-intercepted"; nation: NationId; by: NationId }
  | { type: "dead-hand"; nation: NationId; target: NationId };

export interface NuclearEnv {
  ctx: EconomyContext;
  world: WorldPort;
  rng: Rng;
  nuclear: NuclearState;
  diplomacy: DiplomacyState;
  economy: EconomyState;
  military: MilitaryState;
  politics: PoliticsState;
  territory: TerritoryState;
  nations: readonly NationState[];
  sheets: ReadonlyMap<NationId, NationData>;
  fronts: readonly FrontView[];
  // Nations whose decisions are the AI's (the player's only in autopilot).
  aiNations: readonly NationId[];
  date: string;
}

export function initNuclear(sheets: readonly NationData[]): NuclearState {
  const nations: Record<NationId, NationNuclear> = {};
  for (const sheet of sheets) {
    if (sheet.nuclear === null || sheet.nuclear.warheads <= 0) continue;
    nations[sheet.id] = {
      doctrine: sheet.nuclear.doctrine,
      warheads: sheet.nuclear.warheads,
      threat: 0,
      shots: 0,
    };
  }
  return { nations, strikes: [], nextStrikeId: 1, fallout: {} };
}

function leaderAggressiveness(politics: PoliticsState, id: NationId): number {
  return politics.nations[id]?.leader.traits.aggressiveness ?? 0.5;
}

// Enemies of `id` in the wars going on that took land in them.
function landTakenBy(env: NuclearEnv, id: NationId): Map<NationId, number> {
  const taken = new Map<NationId, number>();
  for (const war of env.diplomacy.wars) {
    const mine = war.aggressors.includes(id)
      ? war.defenders
      : war.defenders.includes(id)
        ? war.aggressors
        : null;
    if (mine === null) continue;
    for (const enemy of mine) {
      const tiles = war.tilesTaken[enemy] ?? 0;
      if (tiles > 0) taken.set(enemy, (taken.get(enemy) ?? 0) + tiles);
    }
  }
  return taken;
}

export function threatLevel(env: NuclearEnv, id: NationId): number {
  const cfg = env.ctx.config.nuclear;
  if (enemiesOf(env.diplomacy, id).length === 0) return 0;
  const nation = env.nations.find((n) => n.id === id);
  const initial = env.territory.initialTiles[id] ?? 0;
  const stability = env.politics.nations[id]?.stability ?? 1;
  if (
    nation === undefined ||
    nation.status !== "active" ||
    (initial > 0 &&
      nation.tileCount < (1 - cfg.lostTerritoryShare) * initial) ||
    !env.world.capitalHeld(id) ||
    stability < cfg.collapseStability
  ) {
    return 3;
  }
  const distance = env.world.capitalFrontDistance(id);
  if (
    landTakenBy(env, id).size > 0 ||
    (distance !== null && distance <= cfg.capitalFrontTiles)
  ) {
    return 2;
  }
  return 1;
}

// 1, or the deterrence factor when the target can answer: warheads of its
// own, or a collective-defence bloc with a nuclear member.
export function deterrence(env: NuclearEnv, target: NationId): number {
  const cfg = env.ctx.config.nuclear;
  if ((env.nuclear.nations[target]?.warheads ?? 0) > 0) return cfg.deterrence;
  const blocs = env.ctx
    .blocsOf(target)
    .filter((b) => cfg.collectiveDefenseBlocs.includes(b));
  for (const bloc of blocs) {
    for (const [id, arsenal] of Object.entries(env.nuclear.nations)) {
      if (id === target || arsenal.warheads <= 0) continue;
      if (env.ctx.blocsOf(id).includes(bloc)) return cfg.deterrence;
    }
  }
  return 1;
}

// The enemy that threatens `id` most: the one that took the most land from
// it, else the strongest.
export function mainThreat(env: NuclearEnv, id: NationId): NationId | null {
  const enemies = enemiesOf(env.diplomacy, id);
  if (enemies.length === 0) return null;
  const taken = landTakenBy(env, id);
  return [...enemies].sort(
    (a, b) =>
      (taken.get(b) ?? 0) - (taken.get(a) ?? 0) ||
      militaryPower(env.ctx, env.military, b) -
        militaryPower(env.ctx, env.military, a) ||
      a.localeCompare(b),
  )[0];
}

export function fireProbability(
  env: NuclearEnv,
  id: NationId,
  target: NationId,
): number {
  const arsenal = env.nuclear.nations[id];
  if (arsenal === undefined || arsenal.warheads <= 0) return 0;
  // J6: a nation without land has no vector (a silo stands on its land).
  const nation = env.nations.find((n) => n.id === id);
  if (
    nation === undefined ||
    nation.status !== "active" ||
    nation.tileCount <= 0
  ) {
    return 0;
  }
  const base = env.ctx.config.nuclear.base[arsenal.doctrine][arsenal.threat];
  return Math.min(
    1,
    base *
      (0.5 + leaderAggressiveness(env.politics, id)) *
      deterrence(env, target),
  );
}

export function deadHandProbability(env: NuclearEnv, id: NationId): number {
  const arsenal = env.nuclear.nations[id];
  if (arsenal === undefined || arsenal.warheads <= 0) return 0;
  return Math.min(
    1,
    env.ctx.config.nuclear.deadHand[arsenal.doctrine] *
      (0.5 + leaderAggressiveness(env.politics, id)),
  );
}

// Where a shot of `by` at `target` aims: the first one at the concentration
// of the target's divisions on their front, the next ones at cities, the
// capital first.
export function aimOf(
  env: NuclearEnv,
  by: NationId,
  target: NationId,
): { aim: NukeAim; kind: NuclearStrike["aim"] } {
  const before = env.nuclear.strikes.filter(
    (s) => s.by === by && s.target === target && s.status !== "failed",
  );
  if (before.length === 0) {
    const front = env.fronts.find((f) => f.id === frontId(by, target));
    if (front !== undefined && front.segments.length > 0) {
      const segment = [...front.segments].sort(
        (a, b) =>
          (b.sides[target]?.divisions ?? 0) -
            (a.sides[target]?.divisions ?? 0) || a.index - b.index,
      )[0];
      return {
        aim: { kind: "front", front: front.id, segment: segment.index },
        kind: "front",
      };
    }
  }
  const cities = before.filter((s) => s.aim === "city" || s.aim === "capital");
  if (cities.length === 0 && env.world.capitalHeld(target)) {
    return { aim: { kind: "capital" }, kind: "capital" };
  }
  return { aim: { kind: "city", index: cities.length }, kind: "city" };
}

// A warhead leaves: the world launches it, the arsenal counts it, and the
// world reacts at once (relations, sanctions, pariah). Nothing when the world
// cannot launch it.
export function launch(
  env: NuclearEnv,
  by: NationId,
  target: NationId,
  aim: NukeAim,
  kind: NuclearStrike["aim"],
): NuclearEvent[] {
  const arsenal = env.nuclear.nations[by];
  if (arsenal === undefined || arsenal.warheads <= 0) return [];
  const weapon = kind === "front" ? "atom" : "hydrogen";
  const id = env.nuclear.nextStrikeId;
  if (!env.world.launchNuke(id, by, target, aim, weapon)) return [];
  env.nuclear.nextStrikeId += 1;
  arsenal.warheads -= 1;
  arsenal.shots += 1;
  env.nuclear.strikes.push({
    id,
    date: env.date,
    by,
    target,
    aim: kind,
    weapon,
    status: "in-flight",
    hits: {},
  });
  const cfg = env.ctx.config.nuclear;
  for (const other of env.ctx.nationIds) {
    if (other === by) continue;
    const r = relation(env.diplomacy, by, other);
    if (r > cfg.relationsCap) {
      setRelation(env.diplomacy, by, other, cfg.relationsCap);
    }
  }
  const events: NuclearEvent[] = [
    {
      type: "nuclear-launch",
      nation: by,
      target,
      aim: kind,
      threat: arsenal.threat,
    },
  ];
  for (const other of env.aiNations) {
    if (other === by) continue;
    const sanction = imposeSanctions(
      env.ctx,
      env.diplomacy,
      env.economy,
      other,
      by,
      env.date,
    );
    if (sanction !== null) events.push(sanction);
  }
  if (!env.diplomacy.pariahs.includes(by)) env.diplomacy.pariahs.push(by);
  return events;
}

// What a warhead that landed leaves: production, GDP and population of each
// nation hit x (1 - loss x share of its tiles hit).
function applyOutcome(env: NuclearEnv, outcome: NukeOutcome): NuclearEvent[] {
  const strike = env.nuclear.strikes.find((s) => s.id === outcome.id);
  if (strike === undefined || strike.status !== "in-flight") return [];
  strike.status = outcome.status;
  strike.hits = { ...outcome.hits };
  if (outcome.status === "failed") {
    // It never left its silo: the warhead is still in the arsenal.
    const arsenal = env.nuclear.nations[strike.by];
    if (arsenal !== undefined) {
      arsenal.warheads += 1;
      arsenal.shots -= 1;
    }
    return [];
  }
  if (outcome.status === "intercepted") {
    return [
      { type: "nuclear-intercepted", nation: strike.target, by: strike.by },
    ];
  }
  const loss = env.ctx.config.nuclear.falloutLoss;
  // Tiles now (the hit ones are gone) + the hit ones = the land before.
  const counts = env.world.tileCounts();
  let total = 0;
  for (const [id, hits] of Object.entries(outcome.hits)) {
    if (hits <= 0) continue;
    total += hits;
    const before = (counts.get(id) ?? 0) + hits;
    const factor = 1 - loss * Math.min(1, hits / Math.max(1, before));
    env.nuclear.fallout[id] = (env.nuclear.fallout[id] ?? 1) * factor;
    const economy = env.economy.nations[id];
    if (economy === undefined) continue;
    economy.gdp *= factor;
    for (const good of Object.keys(economy.production)) {
      economy.production[good] *= factor;
      economy.consumption[good] *= factor;
    }
  }
  return [
    {
      type: "nuclear-detonation",
      nation: strike.target,
      by: strike.by,
      tiles: total,
    },
  ];
}

// Once a day: outcomes of the warheads in flight, threat levels, and the
// decisions of the nations nobody plays.
export function stepNuclearDay(env: NuclearEnv): NuclearEvent[] {
  const events: NuclearEvent[] = [];
  for (const outcome of env.world.nukeOutcomes()) {
    events.push(...applyOutcome(env, outcome));
  }
  for (const [id, arsenal] of Object.entries(env.nuclear.nations)) {
    arsenal.threat = threatLevel(env, id);
  }
  for (const id of Object.keys(env.nuclear.nations).sort()) {
    const arsenal = env.nuclear.nations[id];
    if (arsenal.threat === 0 || arsenal.warheads <= 0) continue;
    if (!env.aiNations.includes(id)) continue;
    const target = mainThreat(env, id);
    if (target === null) continue;
    const p = fireProbability(env, id, target);
    if (p <= 0 || env.rng.next() >= p) continue;
    const { aim, kind } = aimOf(env, id, target);
    events.push(...launch(env, id, target, aim, kind));
  }
  return events;
}

// The dead hand of an annexed nuclear nation: the capital of the annexer,
// drawn at the signature. True when it fired.
export function stepDeadHand(
  env: NuclearEnv,
  annexed: NationId,
  by: NationId,
): { fired: boolean; events: NuclearEvent[] } {
  const p = deadHandProbability(env, annexed);
  if (p <= 0 || env.rng.next() >= p) return { fired: false, events: [] };
  const events = launch(env, annexed, by, { kind: "capital" }, "dead-hand");
  if (events.length === 0) return { fired: false, events };
  return {
    fired: true,
    events: [{ type: "dead-hand", nation: annexed, target: by }, ...events],
  };
}

// A campaign reloaded while warheads flew: they are lost (the world does not
// save them, J0).
export function loseStrikesInFlight(nuclear: NuclearState): void {
  for (const strike of nuclear.strikes) {
    if (strike.status === "in-flight") strike.status = "lost";
  }
}
