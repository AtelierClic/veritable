// The campaign follows the real calendar (28-31 day months, leap years).
// The rule is the day: 1 440 game minutes; at speed x1 a game day lasts two
// real seconds, so "one real minute = one game month" is only the approximation
// that is easy to remember (DECISIONS.md, 2026-09-21).
//
// Pure calendar arithmetic on UTC dates: the simulation never reads the wall
// clock.

export const MINUTES_PER_GAME_DAY = 24 * 60;
export const DAYS_PER_GAME_WEEK = 7;
const MS_PER_DAY = 86_400_000;

function startMs(startDate: string): number {
  const [year, month, day] = startDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

// Number of whole game days elapsed since the start date.
export function dayIndex(elapsedGameMinutes: number): number {
  return Math.floor(elapsedGameMinutes / MINUTES_PER_GAME_DAY);
}

// ISO date of the n-th day of the campaign (day 0 = start date).
export function dateOfDay(startDate: string, day: number): string {
  return new Date(startMs(startDate) + day * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

export function dateAfter(
  startDate: string,
  elapsedGameMinutes: number,
): string {
  return dateOfDay(startDate, dayIndex(elapsedGameMinutes));
}

export function isFirstOfMonth(isoDate: string): boolean {
  return isoDate.endsWith("-01");
}
