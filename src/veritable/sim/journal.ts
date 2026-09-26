import { JournalEntry } from "../data/schemas/save";

// The campaign journal (J4) and its compaction (J6c). Entries older than a
// number of game years are folded, year by year, into one summary per
// nation and category (ARCHITECTURE.md: "les entrées du journal de plus de
// 10 ans de jeu sont agrégées par année"), so that fifty years of a world
// of 208 nations keep a bounded journal. The turning points of a campaign
// stay one by one.

export const JOURNAL_CATEGORIES = [
  "politics",
  "economy",
  "war",
  "diplomacy",
  "objectives",
  "notes",
  "other",
] as const;
export type JournalCategory = (typeof JOURNAL_CATEGORIES)[number];

export function journalCategory(kind: string): JournalCategory {
  if (kind === "note") return "notes";
  if (kind === "objective-completed") return "objectives";
  if (/^(war|peace|annexation|landing|nuclear|dead-hand)/.test(kind)) {
    return "war";
  }
  if (/^(sanctions|claim)/.test(kind)) return "diplomacy";
  if (/^bloc-(?!reprimand|suspended)/.test(kind)) return "diplomacy";
  if (kind === "tech-completed") return "economy";
  if (kind === "event-occurred") return "other";
  if (/^(austerity|sovereign|bloc-reprimand)/.test(kind)) return "economy";
  if (kind === "campaign-started" || kind === "nation-status") return "other";
  return "politics";
}

// The category of an entry; a summary is filed under the category it folds.
export function entryCategory(entry: JournalEntry): string {
  return entry.kind === "yearly-summary"
    ? (entry.params.category ?? "other")
    : journalCategory(entry.kind);
}

// Kept one by one, however old: the player's notes and objectives, and the
// major events of the world (J7: wars, peaces, shots, coups, revolutions,
// changes of regime, decisions of blocs, collapses).
const KEPT: ReadonlySet<string> = new Set([
  "campaign-started",
  "note",
  "objective-completed",
  "nation-status",
  "war-declared",
  "war-joined",
  "peace-signed",
  "annexation",
  "nuclear-launch",
  "nuclear-detonation",
  "dead-hand",
  "revolution",
  "coup-attempted",
  "coup-succeeded",
  "regime-changed",
  "sovereign-default",
  "bloc-decision",
  "bloc-joined",
  "bloc-left",
  "yearly-summary",
]);

// The nations an entry concerns (J7): its nation and those its parameters
// name.
const NATION_PARAMS = ["target", "by", "against", "to", "other"] as const;
export function entryNations(entry: JournalEntry): string[] {
  const out: string[] = entry.nation === undefined ? [] : [entry.nation];
  for (const key of NATION_PARAMS) {
    const v = entry.params[key];
    if (v !== undefined && v !== "" && /^[A-Z]{3}$/.test(v)) out.push(v);
  }
  return out;
}

// What stays detailed for ever (J7): what concerns the player's nation and
// the major events of the world.
export function keptForEver(
  entry: JournalEntry,
  player: string | null,
): boolean {
  if (KEPT.has(entry.kind)) return true;
  return player !== null && entryNations(entry).includes(player);
}

// The journal with every entry dated before `before` (an ISO date) folded
// into yearly summaries, dated the last day of their year, in date order;
// what concerns the player's nation stays (J7).
export function compactJournal(
  journal: readonly JournalEntry[],
  before: string,
  player: string | null = null,
): JournalEntry[] {
  const kept: JournalEntry[] = [];
  const counts = new Map<
    string,
    { year: string; nation?: string; category: string; count: number }
  >();
  for (const entry of journal) {
    if (entry.date >= before || keptForEver(entry, player)) {
      kept.push(entry);
      continue;
    }
    const year = entry.date.slice(0, 4);
    const category = journalCategory(entry.kind);
    const key = `${year}|${entry.nation ?? ""}|${category}`;
    const summary = counts.get(key);
    if (summary === undefined) {
      counts.set(key, { year, nation: entry.nation, category, count: 1 });
    } else {
      summary.count++;
    }
  }
  if (counts.size === 0) return kept;
  const summaries: JournalEntry[] = [...counts.values()].map((s) => ({
    date: `${s.year}-12-31`,
    kind: "yearly-summary",
    ...(s.nation === undefined ? {} : { nation: s.nation }),
    params: { year: s.year, category: s.category, count: String(s.count) },
  }));
  // Stable: the summaries of a year come after its kept entries of the
  // same date, in the order they were first met.
  return [...kept, ...summaries]
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) =>
      a.entry.date < b.entry.date
        ? -1
        : a.entry.date > b.entry.date
          ? 1
          : a.index - b.index,
    )
    .map(({ entry }) => entry);
}
