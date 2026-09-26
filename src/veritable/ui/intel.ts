import { vt } from "../data/i18n";
import { NationId } from "../data/schemas/common";
import { relation } from "../sim/diplomacy/diplomacy";
import {
  IntelLevels,
  IntelMetric,
  IntelRules,
  IntelSource,
  perceive,
  Perceived,
  perceivedMiddle,
} from "../sim/intel/intel";
import { intelRead } from "../sim/intel/state";
import { ReadonlyWorldView, SegmentSide } from "../sim/VeritableSim";
import { longDate } from "./format";

// The only door of the screens to the figures of another nation (J7): every
// one goes through perceive() with the levels of the player, the snapshots
// of the simulation and the setting "Renseignement : réaliste /
// omniscient". The screens read the player's own nation through own(); a
// test (intel.test.ts next to this file) refuses any other read of the
// tables of the view by nation in src/veritable/ui/.

export type IntelSetting = "realistic" | "omniscient";
const STORAGE_KEY = "veritable.intel";
let setting: IntelSetting | null = null;
const listeners = new Set<() => void>();

export function intelSetting(): IntelSetting {
  if (setting === null) {
    try {
      setting =
        localStorage.getItem(STORAGE_KEY) === "omniscient"
          ? "omniscient"
          : "realistic";
    } catch {
      setting = "realistic";
    }
  }
  return setting;
}

export function setIntelSetting(next: IntelSetting): void {
  setting = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private window or blocked storage: the setting lasts the session.
  }
  for (const listener of listeners) listener();
}

export function onIntelSetting(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const BLIND: IntelLevels = {
  general: 3,
  economy: 0,
  politics: 0,
  army: 0,
  nuclear: 0,
  intentions: 0,
};

export function intelSource(view: ReadonlyWorldView): IntelSource {
  return {
    seed: view.seed,
    date: view.date,
    omniscient: intelSetting() === "omniscient",
    rules: view.intel.rules,
    levels: (_viewer, target) => view.intel.levels[target] ?? BLIND,
    value: (target, metric, at) =>
      intelRead(view.intel.state, view, view.date, target, metric, at),
  };
}

// A figure of another nation as the player knows it.
export function seen(
  view: ReadonlyWorldView,
  target: NationId,
  metric: IntelMetric,
): Perceived {
  return perceive(intelSource(view), view.playerNation, target, metric);
}

// The middle of what the player knows (sorting), 0 when unknown.
export function seenMiddle(
  view: ReadonlyWorldView,
  target: NationId,
  metric: IntelMetric,
): number {
  return perceivedMiddle(seen(view, target, metric)) ?? 0;
}

// The levels of the player on a nation (the card, the intelligence mode).
export function levelsOn(
  view: ReadonlyWorldView,
  target: NationId,
): IntelLevels {
  if (intelSetting() === "omniscient" || target === view.playerNation) {
    return {
      ...BLIND,
      economy: 3,
      politics: 3,
      army: 3,
      nuclear: 3,
      intentions: 3,
    };
  }
  return view.intel.levels[target] ?? BLIND;
}

// The player's own nation, raw: the screens of its government.
export function own(view: ReadonlyWorldView) {
  const id = view.playerNation;
  if (id === null) return null;
  return {
    id,
    economy: view.economies[id],
    politics: view.politics[id],
    military: view.military.nations[id],
    nuclear: view.nuclear.nations[id],
    tech: view.tech.nations[id],
    deadHand: view.deadHand[id],
    nuclearRisk: view.nuclearRisk[id],
    constructionCost: view.constructionCost[id],
  };
}

// The text of a perceived figure: the value, a range, or "?".
export function shown(p: Perceived, format: (v: number) => string): string {
  if (p.kind === "exact") return format(p.value);
  if (p.kind === "range") {
    const low = format(p.low);
    const high = format(p.high);
    return low === high ? `≈ ${low}` : `${low} – ${high}`;
  }
  return vt("intel.unknown");
}

// How old a figure is: nothing when it is today's, "au 1er avril 2031"
// else.
export function dataAge(p: Perceived, today: string): string {
  if (p.asOf === null || p.asOf === today || p.kind === "unknown") return "";
  return vt("intel.as-of", { date: longDate(p.asOf) });
}

// --- public information, and what the levels open --------------------------

// The nuclear powers and their declared doctrines: public.
export function nuclearPowers(
  view: ReadonlyWorldView,
): { id: NationId; doctrine: string }[] {
  return Object.entries(view.nuclear.nations).map(([id, n]) => ({
    id,
    doctrine: n.doctrine,
  }));
}

// The regime, the leader, the calendar of the elections of a nation:
// public.
export function publicPolitics(view: ReadonlyWorldView, target: NationId) {
  const p = view.politics[target];
  if (p === undefined) return null;
  return {
    regime: p.regime,
    leader: p.leader,
    government: p.government.parties,
    nextElection: p.nextElection,
    electionsSuspended: p.electionsSuspended,
  };
}

// Unrest in a nation: seen from the first level of its domestic politics;
// null when the player cannot tell.
export function unrestSeen(
  view: ReadonlyWorldView,
  target: NationId,
): boolean | null {
  if (levelsOn(view, target).politics < 1) return null;
  return view.politics[target]?.unrest ?? false;
}

// What a nation weighs (its AI): the war it finds worth it, and how far its
// defence spending runs ahead of its goal; only at the top level of the
// intentions (null below).
export function intentionsOf(view: ReadonlyWorldView, target: NationId) {
  if (target === view.playerNation) return null;
  if (levelsOn(view, target).intentions < 3) return null;
  const ai = view.ai.nations[target];
  const economy = view.economies[target];
  return {
    intent: ai?.intent ?? null,
    defenseGoal: ai?.defenseGoal ?? 0,
    defense: economy?.spending.defense ?? 0,
  };
}

// The sides of a segment of a front: the player's as it is, another's as
// the player sees it in contact (the precision of its level of the army).
export interface SideSeen {
  divisions: Perceived;
  force: Perceived;
  men: Perceived;
  equipment: Perceived;
  training: Perceived;
  supply: Perceived;
  air: Perceived;
  terrain: Perceived;
  structures: Perceived;
  attacking: boolean;
}

export function sideSeen(
  view: ReadonlyWorldView,
  segment: { sides: Record<NationId, SegmentSide> },
  nation: NationId,
): SideSeen | null {
  return sideSeenWith(intelSource(view), view.playerNation, segment, nation);
}

// A figure of another nation seen in contact (the losses of a war).
export function seenContact(
  view: ReadonlyWorldView,
  target: NationId,
  metric: IntelMetric,
  value: number,
): Perceived {
  return perceive(intelSource(view), view.playerNation, target, metric, value);
}

// A source for what is seen in contact only (the fronts on the map): the
// levels of the player on the nations at war, no snapshot.
export function contactSource(intel: {
  seed: number;
  date: string;
  levels: Record<NationId, IntelLevels>;
  rules: IntelRules;
}): IntelSource {
  return {
    seed: intel.seed,
    date: intel.date,
    omniscient: intelSetting() === "omniscient",
    rules: intel.rules,
    levels: (_viewer, target) => intel.levels[target] ?? BLIND,
    value: () => null,
  };
}

// The sides of a segment as a source lets the player see them.
export function sideSeenWith(
  source: IntelSource,
  player: NationId | null,
  segment: { sides: Record<NationId, SegmentSide> },
  nation: NationId,
): SideSeen | null {
  const side = segment.sides[nation];
  if (side === undefined) return null;
  const at = (metric: IntelMetric, value: number): Perceived =>
    perceive(source, player, nation, metric, value);
  return {
    divisions: at("contactDivisions", side.divisions),
    force: at("contactForce", side.force),
    men: at("contactMen", side.men),
    equipment: at("contactShare", side.equipment),
    training: at("contactFactor", side.training),
    supply: at("contactFactor", side.supply),
    air: at("contactFactor", side.air),
    terrain: at("contactFactor", side.terrain),
    structures: at("contactFactor", side.structures),
    attacking: side.attacking,
  };
}

// The force ratio of the attack on a segment as the player sees it: the
// true ratio scaled by how the forces of both sides are perceived.
export function attackRatioSeen(
  source: IntelSource,
  player: NationId | null,
  segment: {
    sides: Record<NationId, SegmentSide>;
    attacker: NationId | null;
    attackRatio: number;
  },
): Perceived | null {
  const attacker = segment.attacker;
  if (attacker === null) return null;
  const defender = Object.keys(segment.sides).find((id) => id !== attacker);
  const a = segment.sides[attacker];
  const d = defender === undefined ? undefined : segment.sides[defender];
  const ratio = segment.attackRatio;
  if (a === undefined || d === undefined) {
    return { kind: "exact", value: ratio, asOf: source.date, level: 3 };
  }
  const pa = perceive(source, player, attacker, "contactForce", a.force);
  const pd = perceive(source, player, defender!, "contactForce", d.force);
  if (pa.kind === "unknown" || pd.kind === "unknown") {
    return { kind: "unknown", asOf: null, level: 0 };
  }
  const bounds = (p: Perceived, v: number): [number, number] =>
    p.kind === "range" && v > 0 ? [p.low / v, p.high / v] : [1, 1];
  const [aLow, aHigh] = bounds(pa, a.force);
  const [dLow, dHigh] = bounds(pd, d.force);
  if (aLow === 1 && aHigh === 1 && dLow === 1 && dHigh === 1) {
    return { kind: "exact", value: ratio, asOf: source.date, level: 3 };
  }
  return {
    kind: "range",
    low: (ratio * aLow) / dHigh,
    high: (ratio * aHigh) / (dLow > 0 ? dLow : 1),
    asOf: source.date,
    level: Math.min(pa.level, pd.level) as Perceived["level"],
  };
}

// How the player's relation with a nation moved over the months kept
// (config intel.trendMonths): today's against the oldest month start.
export function relationTrend(
  view: ReadonlyWorldView,
  target: NationId,
): { delta: number; since: string } | null {
  const history = view.intel.state.relations;
  const me = view.playerNation;
  if (me === null || history.viewer !== me) return null;
  const series = history.values[target];
  if (series === undefined || series.length === 0) return null;
  const today = relation(view.diplomacy, me, target);
  return { delta: today - series[0], since: history.dates[0] };
}
