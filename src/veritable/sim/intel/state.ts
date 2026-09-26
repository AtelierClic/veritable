import { NationId } from "../../data/schemas/common";
import { IntelState } from "../../data/schemas/save";
import {
  INTEL_METRIC_IDS,
  IntelFreshness,
  IntelMetric,
  intelValue,
  intelValues,
  IntelWorld,
} from "./intel";

// The memory of intelligence (J7): the indicators of every nation at the
// start of the month, quarter and year (what levels 2, 1 and 0 see), and the
// relations of the player at the last month starts (the trend of the card
// of a nation). Taken on the monthly calendar clock: intelligence is
// reported by month, quarter and year by nature.

type Period = "month" | "quarter" | "year";

export function emptyIntel(): IntelState {
  const empty = () => ({ date: null, values: {} });
  return {
    metrics: [],
    month: empty(),
    quarter: empty(),
    year: empty(),
    relations: { viewer: null, dates: [], values: {} },
  };
}

// First day of the month, quarter or year of a date.
export function periodStart(date: string, period: Period): string {
  const year = date.slice(0, 4);
  const month = Number(date.slice(5, 7));
  if (period === "year") return `${year}-01-01`;
  if (period === "quarter") {
    const first = Math.floor((month - 1) / 3) * 3 + 1;
    return `${year}-${String(first).padStart(2, "0")}-01`;
  }
  return `${date.slice(0, 7)}-01`;
}

function take(
  world: IntelWorld,
  nations: readonly NationId[],
): Record<NationId, number[]> {
  return Object.fromEntries(nations.map((id) => [id, intelValues(world, id)]));
}

// The snapshots due at the start of a month: the month's always, the
// quarter's in January, April, July and October, the year's in January.
export function takeIntelSnapshots(
  intel: IntelState,
  world: IntelWorld,
  nations: readonly NationId[],
  date: string,
): void {
  const values = take(world, nations);
  const month = Number(date.slice(5, 7));
  intel.metrics = [...INTEL_METRIC_IDS];
  intel.month = { date, values };
  if ((month - 1) % 3 === 0) intel.quarter = { date, values };
  if (month === 1) intel.year = { date, values };
}

// A save that has no snapshot yet (migrated), or one taken with other
// indicators: every snapshot from the values of today, dated at the start
// of its period.
export function ensureIntel(
  intel: IntelState,
  world: IntelWorld,
  nations: readonly NationId[],
  date: string,
): void {
  const same =
    intel.metrics.length === INTEL_METRIC_IDS.length &&
    intel.metrics.every((m, i) => m === INTEL_METRIC_IDS[i]);
  if (
    same &&
    intel.month.date !== null &&
    intel.quarter.date !== null &&
    intel.year.date !== null
  ) {
    return;
  }
  const values = take(world, nations);
  intel.metrics = [...INTEL_METRIC_IDS];
  intel.month = { date: periodStart(date, "month"), values };
  intel.quarter = { date: periodStart(date, "quarter"), values };
  intel.year = { date: periodStart(date, "year"), values };
}

// The relations of the viewer at the start of a month; the last `keep`
// month starts kept (a new viewer starts again).
export function recordRelations(
  intel: IntelState,
  viewer: NationId | null,
  nations: readonly NationId[],
  relationOf: (other: NationId) => number,
  date: string,
  keep: number,
): void {
  const r = intel.relations;
  if (r.viewer !== viewer) {
    r.viewer = viewer;
    r.dates = [];
    r.values = {};
  }
  if (viewer === null) return;
  if (r.dates[r.dates.length - 1] === date) return;
  r.dates.push(date);
  for (const id of nations) {
    if (id === viewer) continue;
    const list = r.values[id] ?? [];
    // A nation new to the list takes the value of today for the months
    // before it.
    while (list.length < r.dates.length - 1) list.push(relationOf(id));
    list.push(relationOf(id));
    r.values[id] = list;
  }
  while (r.dates.length > keep) {
    r.dates.shift();
    for (const list of Object.values(r.values)) list.shift();
  }
}

// The value of an indicator of a nation at a freshness: today's from the
// world, the snapshot's otherwise; null when not known.
export function intelRead(
  intel: IntelState,
  world: IntelWorld,
  today: string,
  nation: NationId,
  metric: IntelMetric,
  at: IntelFreshness,
): { value: number; asOf: string } | null {
  if (at === "live") {
    return { value: intelValue(world, nation, metric), asOf: today };
  }
  const snapshot = intel[at];
  const index = intel.metrics.indexOf(metric);
  const value = snapshot.values[nation]?.[index];
  if (snapshot.date === null || index < 0 || value === undefined) return null;
  return { value, asOf: snapshot.date };
}
