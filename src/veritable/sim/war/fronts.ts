import { NationId } from "../../data/schemas/common";
import {
  DiplomacyState,
  Division,
  MilitaryState,
  War,
} from "../../data/schemas/save";
import { enemiesOf, warOf } from "../diplomacy/diplomacy";
import { EconomyContext } from "../economy/context";
import { Rng } from "../rng";
import {
  FrontGeometry,
  FrontView,
  SegmentGeometry,
  SegmentSide,
  WorldPort,
} from "../VeritableSim";
import { divisionStrength } from "./military";

// Resolution of the fronts, once per core tick (J3a).
//
// A front exists between two belligerents that share a border; the world
// computes its geometry (segments) once a game day. On every tick, per
// segment:
//   force of a side = sum over its divisions of (attack or defence value by
//     posture) x strength x equipment x training x supply x air,
//   the defender's force is multiplied by the terrain and by its structures,
//   r = attacker / defender; above the threshold the line moves by
//     v0 x (r - 1) tiles (capped), the fraction drawn from the Rng,
//   losses of a side = enemy force x lambda men, in men and in equipment,
//   only on segments where somebody attacks.
// Divisions assigned to the front (no segment) are spread over its segments
// in proportion to the threat they face.

export interface Multipliers {
  // Per nation: supply factor of its `divisions` engaged on a segment
  // (logistics, J3b) and air factor against a given enemy (air, J3b).
  supply(nation: NationId, segment: SegmentGeometry, divisions: number): number;
  air(nation: NationId, enemy: NationId): number;
}

export const UNIT_MULTIPLIERS: Multipliers = {
  supply: () => 1,
  air: () => 1,
};

export function frontId(a: NationId, b: NationId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Every pair of enemies, across all wars.
export function enemyPairs(diplomacy: DiplomacyState): [NationId, NationId][] {
  const pairs = new Map<string, [NationId, NationId]>();
  for (const war of diplomacy.wars) {
    for (const a of war.aggressors) {
      for (const d of war.defenders) {
        const id = frontId(a, d);
        if (!pairs.has(id)) pairs.set(id, a < d ? [a, d] : [d, a]);
      }
    }
  }
  return [...pairs.values()].sort((p, q) =>
    p[0] + p[1] < q[0] + q[1] ? -1 : 1,
  );
}

interface SideState {
  nation: NationId;
  enemy: NationId;
  // Divisions engaged on the segment with their share (1 for a division
  // assigned to the segment, the pool share for a division of the front).
  engaged: { division: Division; share: number }[];
  force: number; // with supply and air, without terrain and structures
  attacking: boolean;
  breakthrough: boolean;
  supply: number;
  air: number;
}

function divisionsOnFront(
  military: MilitaryState,
  nation: NationId,
  front: string,
): { bySegment: Map<number, Division[]>; pool: Division[] } {
  const bySegment = new Map<number, Division[]>();
  const pool: Division[] = [];
  for (const division of military.nations[nation]?.divisions ?? []) {
    if (division.front !== front) continue;
    if (division.segment === null) pool.push(division);
    else {
      const list = bySegment.get(division.segment) ?? [];
      list.push(division);
      bySegment.set(division.segment, list);
    }
  }
  return { bySegment, pool };
}

function value(ctx: EconomyContext, division: Division): number {
  return divisionStrength(
    ctx,
    division,
    division.posture === "defend" ? "defense" : "attack",
  );
}

export function resolveTick(
  ctx: EconomyContext,
  world: WorldPort,
  diplomacy: DiplomacyState,
  military: MilitaryState,
  geometry: readonly FrontGeometry[],
  rng: Rng,
  multipliers: Multipliers = UNIT_MULTIPLIERS,
): FrontView[] {
  const cfg = ctx.config.war;
  const views: FrontView[] = [];
  for (const front of geometry) {
    const war = warOf(diplomacy, front.a, front.b);
    if (war === undefined) continue;
    const sides = [front.a, front.b];
    const armies = sides.map((n) => divisionsOnFront(military, n, front.id));
    const n = front.segments.length;
    // Threat each side faces on each segment: enemy divisions there, plus an
    // even share of the enemy pool. Pool shares follow the threat.
    const poolShare = sides.map((_, i) => {
      const enemy = armies[1 - i];
      const threats = front.segments.map((s) => {
        let t = 0;
        for (const d of enemy.bySegment.get(s.index) ?? []) t += value(ctx, d);
        for (const d of enemy.pool) t += value(ctx, d) / n;
        return t;
      });
      const total = threats.reduce((a, b) => a + b, 0);
      return threats.map((t) => (total > 0 ? t / total : 1 / n));
    });

    const segmentViews = front.segments.map((segment) => {
      const states = sides.map((nation, i) =>
        sideState(
          ctx,
          nation,
          sides[1 - i],
          armies[i],
          segment,
          poolShare[i][segment.index],
          front,
          multipliers,
        ),
      );
      const [a, b] = states;
      const terrain =
        segment.terrain.plains * cfg.terrain.plains +
        segment.terrain.highland * cfg.terrain.highland +
        segment.terrain.mountain * cfg.terrain.mountain;
      const defenseOf = (s: SideState, segment: SegmentGeometry) =>
        terrain * (segment.defense[s.nation] ?? 1);
      const ratio = (att: SideState, def: SideState) =>
        att.attacking && att.force > 0
          ? att.force / Math.max(1e-9, def.force * defenseOf(def, segment))
          : 0;
      const rA = ratio(a, b);
      const rB = ratio(b, a);
      let movedTo: NationId | null = null;
      let mover: SideState | null = null;
      let other: SideState | null = null;
      if (rA > cfg.advanceThreshold && rA >= rB) {
        mover = a;
        other = b;
      } else if (rB > cfg.advanceThreshold) {
        mover = b;
        other = a;
      }
      if (mover !== null && other !== null) {
        const r = mover === a ? rA : rB;
        let v = Math.min(cfg.vMax, cfg.v0 * (r - 1));
        if (mover.breakthrough) v *= cfg.breakthrough.speed;
        const whole = Math.floor(v);
        const tiles = whole + (rng.next() < v - whole ? 1 : 0);
        if (tiles > 0) {
          const taken = world.advance(
            front.id,
            segment.index,
            mover.nation,
            other.nation,
            tiles,
          );
          if (taken > 0) {
            movedTo = mover.nation;
            recordTiles(cfg, war, mover.nation, other.nation, taken);
          }
        }
      }
      // Losses wherever somebody attacks.
      if (a.attacking || b.attacking) {
        applyLosses(ctx, military, war, a, b);
        applyLosses(ctx, military, war, b, a);
      }
      const attacker =
        rA > 0 && rA >= rB ? a.nation : rB > 0 ? b.nation : null;
      return {
        index: segment.index,
        tiles: segment.tiles,
        terrain: segment.terrain,
        sides: Object.fromEntries(
          states.map((s) => [
            s.nation,
            sideView(s, terrain, segment.defense[s.nation] ?? 1),
          ]),
        ),
        ratio: b.force > 0 ? a.force / b.force : a.force > 0 ? Infinity : 1,
        attacker,
        attackRatio: attacker === null ? 0 : attacker === a.nation ? rA : rB,
        movedTo,
      };
    });
    views.push({
      id: front.id,
      a: front.a,
      b: front.b,
      segments: segmentViews,
    });
  }
  return views;
}

function sideState(
  ctx: EconomyContext,
  nation: NationId,
  enemy: NationId,
  army: { bySegment: Map<number, Division[]>; pool: Division[] },
  segment: SegmentGeometry,
  poolShare: number,
  front: FrontGeometry,
  multipliers: Multipliers,
): SideState {
  const engaged: { division: Division; share: number }[] = [];
  for (const division of army.bySegment.get(segment.index) ?? []) {
    engaged.push({ division, share: 1 });
  }
  for (const division of army.pool)
    engaged.push({ division, share: poolShare });
  const supply = multipliers.supply(
    nation,
    segment,
    engaged.reduce((sum, e) => sum + e.share, 0),
  );
  const air = multipliers.air(nation, enemy);
  let force = 0;
  let attacking = false;
  let breakthrough = false;
  for (const { division, share } of engaged) {
    force += value(ctx, division) * share;
    if (division.posture !== "defend") attacking = true;
    if (division.posture === "breakthrough") breakthrough = true;
  }
  force *= supply * air;
  return {
    nation,
    enemy,
    engaged,
    force,
    attacking,
    breakthrough,
    supply,
    air,
  };
}

// What the UI shows of a side on a segment: its force and the factors of it.
function sideView(
  s: SideState,
  terrain: number,
  structures: number,
): SegmentSide {
  let divisions = 0;
  let men = 0;
  let equipment = 0;
  let training = 0;
  for (const { division, share } of s.engaged) {
    divisions += share;
    men += division.men * share;
    equipment += division.equipment * share;
    training += division.training * share;
  }
  return {
    divisions,
    force: s.force,
    attacking: s.attacking,
    men,
    equipment: divisions > 0 ? equipment / divisions : 0,
    training: divisions > 0 ? training / divisions : 0,
    supply: s.supply,
    air: s.air,
    terrain,
    structures,
  };
}

function recordTiles(
  cfg: EconomyContext["config"]["war"],
  war: War,
  winner: NationId,
  loser: NationId,
  taken: number,
): void {
  war.tilesTaken[winner] = (war.tilesTaken[winner] ?? 0) + taken;
  war.monthlyTiles[winner] = (war.monthlyTiles[winner] ?? 0) + taken;
  war.monthlyTiles[loser] = (war.monthlyTiles[loser] ?? 0) - taken;
  // Every tile taken is contested: it counts for a share of a tile (J5).
  war.score[winner] =
    (war.score[winner] ?? 0) +
    taken * cfg.warScore.tileValue * cfg.contest.valueShare;
}

// `side` loses men and equipment in proportion to the enemy's force.
function applyLosses(
  ctx: EconomyContext,
  military: MilitaryState,
  war: War,
  side: SideState,
  enemy: SideState,
): void {
  const cfg = ctx.config.war;
  if (side.force <= 0 || enemy.force <= 0) return;
  let losses = enemy.force * cfg.lambda;
  if (side.attacking && side.breakthrough) losses *= cfg.breakthrough.losses;
  let lost = 0;
  for (const { division, share } of side.engaged) {
    const contribution = (value(ctx, division) * share) / side.force;
    const men = Math.min(division.men, losses * contribution);
    if (men <= 0) continue;
    division.men -= men;
    division.equipment = Math.max(
      0,
      division.equipment - men / ctx.template(division.template).men,
    );
    lost += men;
  }
  const nation = military.nations[side.nation];
  nation.losses += lost;
  nation.lossesLastMonth += lost;
  war.score[side.nation] =
    (war.score[side.nation] ?? 0) - lost * cfg.warScore.lossValue;
  war.score[enemy.nation] =
    (war.score[enemy.nation] ?? 0) + lost * cfg.warScore.lossValue;
}

// Once a month: who is retreating (net tiles lost this month), counters reset.
export function stepWarMonth(diplomacy: DiplomacyState): void {
  for (const war of diplomacy.wars) {
    for (const nation of [...war.aggressors, ...war.defenders]) {
      const net = war.monthlyTiles[nation] ?? 0;
      war.retreatMonths[nation] =
        net < 0 ? (war.retreatMonths[nation] ?? 0) + 1 : 0;
      war.monthlyTiles[nation] = 0;
    }
  }
}

// Divisions of nations that are no longer at war go back to the reserve;
// divisions on a front that no longer exists too.
export function releaseIdleDivisions(
  diplomacy: DiplomacyState,
  military: MilitaryState,
  geometry: readonly FrontGeometry[],
): void {
  const fronts = new Set(geometry.map((f) => f.id));
  for (const [id, nation] of Object.entries(military.nations)) {
    const enemies = new Set(enemiesOf(diplomacy, id));
    for (const division of nation.divisions) {
      if (division.front === null) continue;
      const [a, b] = division.front.split("|");
      const enemy = a === id ? b : a;
      if (!enemies.has(enemy) || !fronts.has(division.front)) {
        division.front = null;
        division.segment = null;
        division.posture = "defend";
      }
    }
  }
}
