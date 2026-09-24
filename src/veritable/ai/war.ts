import { NationId } from "../data/schemas/common";
import { NationData } from "../data/schemas/nation";
import {
  DiplomacyState,
  MilitaryState,
  NationMilitary,
  War,
} from "../data/schemas/save";
import { DIVISION_TEMPLATE_IDS } from "../data/schemas/war";
import { enemiesOf, warSide } from "../sim/diplomacy/diplomacy";
import { EconomyContext } from "../sim/economy/context";
import { FrontGeometry } from "../sim/VeritableSim";
import { frontId } from "../sim/war/fronts";
import {
  divisionStrength,
  manpowerCeiling,
  raiseDivision,
  setConscription,
} from "../sim/war/military";

// Minimal war AI of the nations nobody plays (J3a; the rest is J5), once a
// month. Defensive: its divisions go to its fronts in proportion to the
// threat, segment by segment; a segment where its ratio beats the attack
// ratio gets the attack posture. Conscription: partial at war, total when
// losing. It raises divisions while manpower allows. Peace and coalitions
// are decided in peace.ts / diplomacy.ts with the rules of the design.

export interface AiWarOrders {
  // Enemy leaders it offers a ceasefire to this month.
  ceasefireTo: NationId[];
}

function forceOn(
  ctx: EconomyContext,
  military: MilitaryState,
  nation: NationId,
  front: string,
  segment: number | null,
): number {
  let force = 0;
  for (const d of military.nations[nation]?.divisions ?? []) {
    if (d.front !== front) continue;
    if (segment !== null && d.segment !== null && d.segment !== segment)
      continue;
    force += divisionStrength(ctx, d, "defense");
  }
  return force;
}

export function stepWarAi(
  ctx: EconomyContext,
  diplomacy: DiplomacyState,
  military: MilitaryState,
  data: NationData,
  geometry: readonly FrontGeometry[],
  id: NationId,
): AiWarOrders {
  const cfg = ctx.config.war;
  const me = military.nations[id];
  const orders: AiWarOrders = { ceasefireTo: [] };
  if (me === undefined) return orders;
  const enemies = enemiesOf(diplomacy, id);
  const population = data.population.value;

  if (enemies.length === 0) {
    if (me.conscription !== "peace") {
      // Back to a professional army once the ceiling holds the divisions.
      const manned = me.divisions.reduce((s, d) => s + d.men, 0);
      if (manpowerCeiling(ctx, population, "peace") >= manned) {
        setConscription(ctx, me, population, "peace");
      }
    }
    return orders;
  }

  // Conscription: partial at war, total when losing.
  const losing = diplomacy.wars.some((war) => {
    const side = warSide(war, id);
    if (side === null) return false;
    const lostShare = lostTilesShare(war, id, data);
    return (
      (war.retreatMonths[id] ?? 0) >= cfg.ai.retreatMonthsForTotal ||
      lostShare > cfg.ai.totalConscriptionWhenLosingShare
    );
  });
  const wanted = losing ? "total" : "partial";
  if (me.conscription === "peace" || (losing && me.conscription !== "total")) {
    setConscription(ctx, me, population, wanted);
  }

  // Raise divisions while the pool allows, in the starting mix.
  const cap = diplomacy.demilitarized.find(
    (d) => d.nation === id,
  )?.maxDivisions;
  for (let guard = 0; guard < 50; guard++) {
    if (cap !== undefined && me.divisions.length >= cap) break;
    const counts = Object.fromEntries(DIVISION_TEMPLATE_IDS.map((t) => [t, 0]));
    for (const d of me.divisions) counts[d.template] += 1;
    const total = me.divisions.length + 1;
    // The template furthest below its share of the mix.
    let best: (typeof DIVISION_TEMPLATE_IDS)[number] | null = null;
    let bestGap = -Infinity;
    for (const t of DIVISION_TEMPLATE_IDS) {
      const gap = cfg.startingMix[t] - counts[t] / total;
      if (gap > bestGap) {
        bestGap = gap;
        best = t;
      }
    }
    if (best === null || me.manpower < ctx.template(best).men) break;
    raiseDivision(ctx, me, best, null);
  }

  // Fronts against its enemies, and the threat on each.
  const fronts = geometry.filter(
    (f) =>
      (f.a === id && enemies.includes(f.b)) ||
      (f.b === id && enemies.includes(f.a)),
  );
  // Without a front (no common border, or a world without fronts: the
  // headless runner without the core), the divisions stay in reserve; the
  // peace rule below still applies (J5: before, a war without a front never
  // ended).
  if (fronts.length === 0) {
    for (const d of me.divisions) {
      d.front = null;
      d.segment = null;
      d.posture = "defend";
    }
  } else {
    deploy(ctx, military, me, id, fronts);
  }

  // Peace: a ceasefire to every enemy leader when weary or retreating.
  const peace = cfg.peace;
  for (const war of diplomacy.wars) {
    const side = warSide(war, id);
    if (side === null) continue;
    const weary =
      me.exhaustion > peace.exhaustionToAccept ||
      (war.retreatMonths[id] ?? 0) >= peace.retreatMonthsToAccept;
    if (!weary) continue;
    const leader = (side === "aggressors" ? war.defenders : war.aggressors)[0];
    if (leader !== undefined) orders.ceasefireTo.push(leader);
  }
  return orders;
}

// Share of the nation's tiles it lost in this war (net), relative to what it
// holds now plus what it lost.
function lostTilesShare(war: War, id: NationId, data: NationData): number {
  void data;
  let lost = 0;
  const enemies = war.aggressors.includes(id) ? war.defenders : war.aggressors;
  for (const e of enemies) lost += war.tilesTaken[e] ?? 0;
  const won = war.tilesTaken[id] ?? 0;
  const net = lost - won;
  return net <= 0 ? 0 : net / (net + 1e6);
}

export { frontId };

// Every division over the segments of the fronts in proportion to the
// threat; attack where the ratio beats the attack ratio.
function deploy(
  ctx: EconomyContext,
  military: MilitaryState,
  me: NationMilitary,
  id: NationId,
  fronts: readonly FrontGeometry[],
): void {
  const cfg = ctx.config.war;
  const threats = fronts.map((f) => {
    const enemy = f.a === id ? f.b : f.a;
    return f.segments.map(
      (s) => forceOn(ctx, military, enemy, f.id, s.index) + 1e-6,
    );
  });
  const totalThreat = threats.flat().reduce((a, b) => a + b, 0);
  // Distribute every division over the segments in proportion to the threat.
  const slots: { front: FrontGeometry; segment: number; want: number }[] = [];
  fronts.forEach((f, i) => {
    f.segments.forEach((s, j) => {
      slots.push({
        front: f,
        segment: s.index,
        want: threats[i][j] / totalThreat,
      });
    });
  });
  const divisions = [...me.divisions].sort((p, q) => p.id - q.id);
  const assigned = new Map<number, number>(); // slot index -> divisions
  divisions.forEach((division, k) => {
    // Largest remaining want first (Hamilton apportionment, one at a time).
    let bestSlot = 0;
    let bestScore = -Infinity;
    slots.forEach((slot, s) => {
      const have = assigned.get(s) ?? 0;
      const score = slot.want * (k + 1) - have;
      if (score > bestScore) {
        bestScore = score;
        bestSlot = s;
      }
    });
    assigned.set(bestSlot, (assigned.get(bestSlot) ?? 0) + 1);
    division.front = slots[bestSlot].front.id;
    division.segment = slots[bestSlot].segment;
    division.posture = "defend";
  });
  // Attack where the ratio beats the attack ratio.
  for (const slot of slots) {
    const enemy = slot.front.a === id ? slot.front.b : slot.front.a;
    const mine = me.divisions
      .filter((d) => d.front === slot.front.id && d.segment === slot.segment)
      .reduce((s, d) => s + divisionStrength(ctx, d, "attack"), 0);
    const theirs = forceOn(ctx, military, enemy, slot.front.id, slot.segment);
    if (mine > cfg.ai.attackRatio * Math.max(theirs, 1e-6)) {
      for (const d of me.divisions) {
        if (d.front === slot.front.id && d.segment === slot.segment) {
          d.posture = "attack";
        }
      }
    }
  }
}
