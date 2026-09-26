import { MINUTES_PER_GAME_DAY } from "./calendar";

// Elapsed time in the rates of the simulation (J7). The calibrations of the
// J2 to the J6 are rates per game month (and per week for opinion): an
// update covering `months` of game time composes them exactly, so that one
// monthly step and thirty daily steps agree (the test of the rolling
// queue). The month of the rates is the mean calendar month.

export const DAYS_PER_MONTH = 365.25 / 12;
export const MINUTES_PER_MONTH = DAYS_PER_MONTH * MINUTES_PER_GAME_DAY;
export const WEEKS_PER_MONTH = DAYS_PER_MONTH / 7;
export const MINUTES_PER_YEAR = 12 * MINUTES_PER_MONTH;

// Game months between two elapsed times, in minutes.
export function monthsBetween(fromMinutes: number, toMinutes: number): number {
  return Math.max(0, toMinutes - fromMinutes) / MINUTES_PER_MONTH;
}

// Share of a gap a relaxation closes over `periods` when it closes `rate` of
// it per period: x += (target - x) x relaxed(rate, periods).
export function relaxed(rate: number, periods: number): number {
  if (rate >= 1) return periods > 0 ? 1 : 0;
  return 1 - Math.pow(1 - rate, periods);
}

// Probability of at least one occurrence over `periods` of an event of
// probability `p` per period.
export function chanceOver(p: number, periods: number): number {
  if (p >= 1) return periods > 0 ? 1 : 0;
  if (p <= 0) return 0;
  return 1 - Math.pow(1 - p, periods);
}

// Growth factor over `periods` of a rate `g` per period.
export function grown(g: number, periods: number): number {
  return Math.pow(1 + g, periods);
}

// Standard deviation over `periods` of a random walk of `sd` per period.
export function walkSd(sd: number, periods: number): number {
  return sd * Math.sqrt(Math.max(0, periods));
}

// An AR(1) shock x' = rho x + sd e per period, carried over `periods`: the
// persistence and the innovation that give the same law as `periods` steps.
export function ar1Over(
  rho: number,
  sd: number,
  periods: number,
): { persistence: number; sd: number } {
  const persistence = Math.pow(rho, periods);
  if (rho >= 1 || rho <= -1) {
    return { persistence, sd: walkSd(sd, periods) };
  }
  const variance =
    (sd * sd * (1 - persistence * persistence)) / (1 - rho * rho);
  return { persistence, sd: Math.sqrt(Math.max(0, variance)) };
}

// Months of the calendar (months since the start date) of an ISO date.
export function calendarMonth(startDate: string, date: string): number {
  const [sy, sm] = startDate.split("-").map(Number);
  const [y, m] = date.split("-").map(Number);
  return (y - sy) * 12 + (m - sm);
}

// Calendar days between two ISO dates.
export function daysBetweenDates(from: string, to: string): number {
  const a = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000);
}

// ISO date `days` after another.
export function addDays(date: string, days: number): string {
  const t = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

// Days in the calendar month of an ISO date.
export function daysInMonth(date: string): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
