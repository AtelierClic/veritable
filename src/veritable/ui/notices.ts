import { JournalEntry } from "../data/schemas/save";
import { HudView } from "../sim/VeritableSim";

// How what happens reaches the player (J7, answer to the 25-minute test):
//   - critical: it concerns the player; the game pauses a few seconds and a
//     card stays until it is read (dismissed);
//   - info: it touches the player's nation; a card that fades after 8 s;
//   - log: the journal and a marker on the map only.
// The player's own decisions and votes waiting are cards too, built from
// the HUD (EventCards), not from the journal.

export const PAUSE_CATEGORIES = [
  "decision", // an event that asks the player's nation to choose
  "war", // a war declared on it, an ally or a neighbour
  "nuclear", // a nuclear shot, anywhere
  "regime", // a coup, a revolution, a change of regime, at home or next door
  "collapse", // a nation that collapses (exile, dissolution)
  "vote", // a bloc vote that awaits its voice
] as const;
export type PauseCategory = (typeof PAUSE_CATEGORIES)[number];

export type NoticeLevel = "critical" | "info" | "log";

export interface Notice {
  level: NoticeLevel;
  category: PauseCategory | null; // the category of a critical notice
  entry: JournalEntry;
}

type Context = Pick<
  HudView,
  "playerNation" | "neighbours" | "allies" | "enemies" | "blocs"
>;

// Kinds that only touch the player when they happen to its nation.
const OWN_NATION_INFO = new Set([
  "unrest-started",
  "unrest-ended",
  "austerity-started",
  "austerity-ended",
  "sovereign-default",
  "bloc-reprimand",
  "sanctions-imposed",
  "sanctions-lifted",
  "election-held",
  "government-formed",
  "elections-suspended",
  "law-repeal-announced",
  "leader-died",
  "leader-succeeded",
  "fraud-detected",
  "objective-completed",
  "bloc-suspended",
  "civilian-transition",
  "nuclear-detonation",
  "nuclear-intercepted",
  "tech-completed",
  "bloc-joined",
  "bloc-left",
  "bloc-accession-opened",
  "bloc-accession-frozen",
  "claims-settled",
  "claim-weakened",
]);

export function classify(entry: JournalEntry, ctx: Context): Notice {
  const player = ctx.playerNation;
  const notice = (
    level: NoticeLevel,
    category: PauseCategory | null = null,
  ): Notice => ({ level, category, entry });
  if (player === null) return notice("log");
  const me = entry.nation === player;
  const p = entry.params;
  const near = (id: string | undefined) =>
    id !== undefined &&
    (id === player || ctx.allies.includes(id) || ctx.neighbours.includes(id));
  switch (entry.kind) {
    case "war-declared":
      // The player's own declaration is its act, not news.
      if (me) return notice("log");
      if (near(p.target)) return notice("critical", "war");
      return ctx.neighbours.includes(entry.nation ?? "")
        ? notice("info")
        : notice("log");
    case "war-joined":
      if (me) return notice("log");
      return p.against === player ? notice("critical", "war") : notice("log");
    case "nuclear-launch":
    case "dead-hand":
      return me ? notice("log") : notice("critical", "nuclear");
    case "coup-attempted":
    case "coup-succeeded":
    case "revolution":
    case "regime-changed":
      return me || ctx.neighbours.includes(entry.nation ?? "")
        ? notice("critical", "regime")
        : notice("log");
    case "nation-status":
      if (p.to === "exiled" || p.to === "dissolved") {
        return notice("critical", "collapse");
      }
      return me ? notice("info") : notice("log");
    case "bloc-proposal":
      return !me && p.target !== player && ctx.blocs.includes(p.bloc)
        ? notice("critical", "vote")
        : notice("log");
    case "peace-offered":
      return !me && ctx.enemies.includes(entry.nation ?? "")
        ? notice("info")
        : notice("log");
    case "landing":
    case "ai-landing":
    case "landing-refused":
      return p.target === player ? notice("info") : notice("log");
    case "arms-aid-started":
    case "arms-aid-ended":
      return p.to === player ? notice("info") : notice("log");
    case "bloc-article5":
      return !me && ctx.blocs.includes(p.bloc) ? notice("info") : notice("log");
    case "event-occurred":
      // The player chose: no news; its government chose: it should know.
      return me && p.by === "government" ? notice("info") : notice("log");
    default:
      return me && OWN_NATION_INFO.has(entry.kind)
        ? notice("info")
        : notice("log");
  }
}

// The pause settings of the player (J7): how long an automatic pause lasts
// (0: none) and the categories that make one. A per-viewer convenience,
// kept in the browser.
export interface PauseSettings {
  seconds: 0 | 3 | 5;
  categories: Record<PauseCategory, boolean>;
}

export const DEFAULT_PAUSE_SETTINGS: PauseSettings = {
  seconds: 3,
  categories: Object.fromEntries(
    PAUSE_CATEGORIES.map((c) => [c, true]),
  ) as Record<PauseCategory, boolean>,
};

const STORAGE_KEY = "veritable.pause";

export function loadPauseSettings(): PauseSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return structuredClone(DEFAULT_PAUSE_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<PauseSettings>;
    const seconds = [0, 3, 5].includes(parsed.seconds as number)
      ? (parsed.seconds as PauseSettings["seconds"])
      : DEFAULT_PAUSE_SETTINGS.seconds;
    const categories = { ...DEFAULT_PAUSE_SETTINGS.categories };
    for (const c of PAUSE_CATEGORIES) {
      const v = parsed.categories?.[c];
      if (typeof v === "boolean") categories[c] = v;
    }
    return { seconds, categories };
  } catch {
    return structuredClone(DEFAULT_PAUSE_SETTINGS);
  }
}

export function savePauseSettings(settings: PauseSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private window or blocked storage: the settings last the session.
  }
}

// The automatic pause (J7): a critical notice pauses the game for a few
// seconds, then it resumes at the speed it had; at least 20 real seconds
// between two automatic pauses (at x5 a month lasts 12 s: without it the
// game would stop all the time). Pure: the caller keeps the clock.
export const PAUSE_COOLDOWN_MS = 20_000;

export function shouldPause(
  settings: PauseSettings,
  category: PauseCategory,
  nowMs: number,
  lastPauseMs: number | null,
  speed: number,
): boolean {
  if (settings.seconds === 0 || !settings.categories[category]) return false;
  if (speed === 0) return false;
  return lastPauseMs === null || nowMs - lastPauseMs >= PAUSE_COOLDOWN_MS;
}
