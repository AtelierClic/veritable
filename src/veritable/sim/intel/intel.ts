import { NationId } from "../../data/schemas/common";
import {
  MilitaryState,
  NationEconomy,
  NationPolitics,
  NuclearState,
} from "../../data/schemas/save";

// Intelligence (J7): what the player knows of another nation. A level from 0
// to 3 for each category, from its relation with the nation, the alliances
// and unions they share, the border, a war, the regime of the nation; the
// precision and the freshness of every figure follow from the level. Every
// figure about another nation shown to the player goes through perceive():
// the interface never reads the raw values of another nation (a test checks
// src/veritable/ui/). The AI nations keep the full information in the J7.

export const INTEL_CATEGORIES = [
  "general",
  "economy",
  "politics",
  "army",
  "nuclear",
  "intentions",
] as const;
export type IntelCategory = (typeof INTEL_CATEGORIES)[number];
export type IntelLevel = 0 | 1 | 2 | 3;
export type IntelLevels = Readonly<Record<IntelCategory, IntelLevel>>;

// The rules of the levels and of the precision (config.json, intel).
export interface IntelRules {
  // Relation at or above which the level is 1, 2, 3.
  relationLevels: readonly [number, number, number];
  // Half-width of a range at levels 0, 1, 2 (share of the value); 3 is
  // exact.
  precision: readonly [number, number, number];
  // Regimes whose statistics are public (economy at least 2), regimes
  // closed to the world (economy at most 1 but for an ally).
  openRegimes: readonly string[];
  closedRegimes: readonly string[];
}

// An indicator: its category, the least half-width of its ranges (near
// zero), whether it is a share within [0, 1] or a count.
interface MetricSpec {
  category: IntelCategory;
  floor: number;
  bounded?: boolean;
  integer?: boolean;
}

export const INTEL_METRICS = {
  population: { category: "general", floor: 1000 },
  gdp: { category: "economy", floor: 1e8 },
  gdpPerCapita: { category: "economy", floor: 100 },
  growth: { category: "economy", floor: 0.005 },
  debtToGdp: { category: "economy", floor: 0.02 },
  deficitToGdp: { category: "economy", floor: 0.005 },
  shortage: { category: "economy", floor: 0.01, bounded: true },
  stability: { category: "politics", floor: 0.02, bounded: true },
  legitimacy: { category: "politics", floor: 0.02, bounded: true },
  divisions: { category: "army", floor: 1, integer: true },
  men: { category: "army", floor: 1000, integer: true },
  equipment: { category: "army", floor: 0.02, bounded: true },
  airPower: { category: "army", floor: 0.05 },
  navalPower: { category: "army", floor: 0.05 },
  power: { category: "army", floor: 1 },
  defenseShare: { category: "army", floor: 0.001 },
  exhaustion: { category: "army", floor: 0.02, bounded: true },
  warheads: { category: "nuclear", floor: 1, integer: true },
  threat: { category: "nuclear", floor: 0.5, integer: true },
  // The daily probability of a shot, the probability of the dead hand.
  nuclearRisk: { category: "nuclear", floor: 0.00001, bounded: true },
  deadHand: { category: "nuclear", floor: 0.02, bounded: true },
  coupRisk: { category: "intentions", floor: 0.0005, bounded: true },
  // Seen in contact (a front, a war): given to perceive() as they are today.
  contactDivisions: { category: "army", floor: 1 },
  contactForce: { category: "army", floor: 1 },
  contactMen: { category: "army", floor: 1000, integer: true },
  contactShare: { category: "army", floor: 0.02, bounded: true },
  contactFactor: { category: "army", floor: 0.05 },
  contactLosses: { category: "army", floor: 100, integer: true },
} as const satisfies Record<string, MetricSpec>;
export type IntelMetric = keyof typeof INTEL_METRICS;
// The indicators of a nation the simulation reads and keeps in its
// snapshots (not those seen in contact).
export const INTEL_METRIC_IDS = (
  Object.keys(INTEL_METRICS) as IntelMetric[]
).filter((m) => !m.startsWith("contact"));

export function categoryOf(metric: IntelMetric): IntelCategory {
  return INTEL_METRICS[metric].category;
}

// What the levels of a viewer on a target are made of.
export interface IntelFacts {
  relation: number;
  // A common military alliance, or a guarantee between the two.
  alliance: boolean;
  // A common economic union.
  union: boolean;
  // A land border, or a war between the two (forces in contact).
  neighbour: boolean;
  atWar: boolean;
  regime: string | null;
}

export function intelLevels(rules: IntelRules, f: IntelFacts): IntelLevels {
  const [l1, l2, l3] = rules.relationLevels;
  let base: IntelLevel =
    f.relation >= l3 ? 3 : f.relation >= l2 ? 2 : f.relation >= l1 ? 1 : 0;
  if (f.alliance) base = 3;
  if (f.union && base < 2) base = 2;
  let economy: IntelLevel = base;
  if (!f.alliance && f.regime !== null) {
    if (rules.openRegimes.includes(f.regime) && economy < 2) economy = 2;
    if (rules.closedRegimes.includes(f.regime) && economy > 1) economy = 1;
  }
  const army: IntelLevel = (f.neighbour || f.atWar) && base < 1 ? 1 : base;
  return {
    general: 3,
    economy,
    politics: base,
    army,
    nuclear: base,
    intentions: base,
  };
}

// --- the values ------------------------------------------------------------------------

// What the indicators are read from: the state of the simulation, or the
// view the interface receives (same shapes); military power and the risk
// of a coup are computed by the simulation.
export interface IntelWorld {
  readonly economies: Readonly<Record<NationId, Readonly<NationEconomy>>>;
  readonly politics: Readonly<Record<NationId, Readonly<NationPolitics>>>;
  readonly military: Readonly<MilitaryState>;
  readonly nuclear: Readonly<NuclearState>;
  readonly power: Readonly<Record<NationId, number>>;
  readonly coupRisk: Readonly<Record<NationId, number>>;
  readonly nuclearRisk: Readonly<Record<NationId, number>>;
  readonly deadHand: Readonly<Record<NationId, number>>;
}

export function intelValue(
  state: IntelWorld,
  nation: NationId,
  metric: IntelMetric,
): number {
  const e = state.economies[nation];
  const p = state.politics[nation];
  const m = state.military.nations[nation];
  switch (metric) {
    case "population":
      return e?.population ?? 0;
    case "gdp":
      return e?.gdp ?? 0;
    case "gdpPerCapita":
      return e !== undefined && e.population > 0 ? e.gdp / e.population : 0;
    case "growth":
      return e?.growthAnnual ?? 0;
    case "debtToGdp":
      return e !== undefined && e.gdp > 0 ? e.debt / e.gdp : 0;
    case "deficitToGdp":
      return e !== undefined && e.gdp > 0
        ? (12 * (e.expenditure - e.revenue)) / e.gdp
        : 0;
    case "shortage":
      return e?.shortage ?? 0;
    case "stability":
      return p?.stability ?? 0;
    case "legitimacy":
      return p?.legitimacy ?? 0;
    case "divisions":
      return m?.divisions.length ?? 0;
    case "men":
      return m?.divisions.reduce((s, d) => s + d.men, 0) ?? 0;
    case "equipment": {
      if (m === undefined || m.divisions.length === 0) return 0;
      let men = 0;
      let weighted = 0;
      for (const d of m.divisions) {
        men += d.men;
        weighted += d.men * d.equipment;
      }
      return men > 0 ? weighted / men : 0;
    }
    case "airPower":
      return m?.airPower ?? 0;
    case "navalPower":
      return m?.navalPower ?? 0;
    case "power":
      return state.power[nation] ?? 0;
    case "defenseShare":
      return e?.spending.defense ?? 0;
    case "exhaustion":
      return m?.exhaustion ?? 0;
    case "warheads":
      return state.nuclear.nations[nation]?.warheads ?? 0;
    case "threat":
      return state.nuclear.nations[nation]?.threat ?? 0;
    case "coupRisk":
      return state.coupRisk[nation] ?? 0;
    case "nuclearRisk":
      return state.nuclearRisk[nation] ?? 0;
    case "deadHand":
      return state.deadHand[nation] ?? 0;
    default:
      // Seen in contact only: perceive() is given the value.
      return 0;
  }
}

// Every indicator of a nation, in the order of INTEL_METRIC_IDS.
export function intelValues(state: IntelWorld, nation: NationId): number[] {
  return INTEL_METRIC_IDS.map((metric) => intelValue(state, nation, metric));
}

// --- perception ------------------------------------------------------------------------

export type IntelFreshness = "live" | "month" | "quarter" | "year";
const FRESHNESS: readonly IntelFreshness[] = [
  "year",
  "quarter",
  "month",
  "live",
];

export type Perceived =
  | { kind: "exact"; value: number; asOf: string; level: IntelLevel }
  | {
      kind: "range";
      low: number;
      high: number;
      asOf: string;
      level: IntelLevel;
    }
  | { kind: "unknown"; asOf: string | null; level: IntelLevel };

// What perceive() reads: the levels of the viewer on each nation, the
// value of an indicator today or at the start of the month, quarter or year
// (the snapshots of the simulation), the seed of the campaign and the
// setting "omniscient".
export interface IntelSource {
  readonly seed: number;
  readonly date: string;
  readonly omniscient: boolean;
  readonly rules: IntelRules;
  levels(viewer: NationId, target: NationId): IntelLevels;
  value(
    target: NationId,
    metric: IntelMetric,
    at: IntelFreshness,
  ): { value: number; asOf: string } | null;
}

// Categories hidden at level 0 (no estimate at all).
const SECRET: readonly IntelCategory[] = ["army", "nuclear", "intentions"];

export function perceive(
  source: IntelSource,
  viewer: NationId | null,
  target: NationId,
  metric: IntelMetric,
  // A figure seen in contact (the forces on a front, the losses of a
  // battle): today's value, at the precision of the level of the category.
  contact?: number,
): Perceived {
  const today = (): { value: number; asOf: string } | null =>
    contact === undefined
      ? source.value(target, metric, "live")
      : { value: contact, asOf: source.date };
  if (source.omniscient || viewer === null || viewer === target) {
    const live = today();
    return live === null
      ? { kind: "unknown", asOf: null, level: 3 }
      : { kind: "exact", value: live.value, asOf: live.asOf, level: 3 };
  }
  const levels = source.levels(viewer, target);
  const category = categoryOf(metric);
  let level: IntelLevel = levels[category];
  // The population is public: at least the precision of level 2.
  if (metric === "population") level = levels.economy === 3 ? 3 : 2;
  if (
    (category === "intentions" && level < 3) ||
    (level === 0 && SECRET.includes(category))
  ) {
    return { kind: "unknown", asOf: null, level };
  }
  const read =
    contact === undefined
      ? source.value(target, metric, FRESHNESS[level])
      : today();
  if (read === null) return { kind: "unknown", asOf: null, level };
  if (level === 3) {
    return { kind: "exact", value: read.value, asOf: read.asOf, level };
  }
  const spec: MetricSpec = INTEL_METRICS[metric];
  const half =
    source.rules.precision[level] * Math.max(Math.abs(read.value), spec.floor);
  // Where the true value sits within the range: drawn per pair, indicator
  // and year, so that the middle of the range says nothing.
  const u = unitHash(
    `${source.seed}|${viewer}|${target}|${metric}|${source.date.slice(0, 4)}`,
  );
  let low = read.value - 2 * half * u;
  let high = low + 2 * half;
  if (spec.bounded === true) {
    low = Math.max(0, low);
    high = Math.min(1, high);
  }
  if (spec.integer === true) {
    low = Math.max(0, Math.floor(low));
    high = Math.ceil(high);
  }
  return { kind: "range", low, high, asOf: read.asOf, level };
}

// A number in [0, 1) from a string (FNV-1a, 32 bits).
export function unitHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 4294967296;
}

// The middle of what is perceived (sorting a table), null when unknown.
export function perceivedMiddle(p: Perceived): number | null {
  if (p.kind === "exact") return p.value;
  if (p.kind === "range") return (p.low + p.high) / 2;
  return null;
}
