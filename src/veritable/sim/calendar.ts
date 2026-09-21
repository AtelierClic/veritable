export const MINUTES_PER_GAME_DAY = 24 * 60;
const MS_PER_DAY = 86_400_000;

// ISO date reached after `elapsedGameMinutes` from `startDate`. Pure calendar
// arithmetic on UTC dates: the simulation never reads the wall clock.
export function dateAfter(
  startDate: string,
  elapsedGameMinutes: number,
): string {
  const [year, month, day] = startDate.split("-").map(Number);
  const days = Math.floor(elapsedGameMinutes / MINUTES_PER_GAME_DAY);
  const ms = Date.UTC(year, month - 1, day) + days * MS_PER_DAY;
  return new Date(ms).toISOString().slice(0, 10);
}
