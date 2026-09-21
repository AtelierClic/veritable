import {
  dateOfDay,
  dayIndex,
  DAYS_PER_GAME_WEEK,
  isFirstOfMonth,
} from "./calendar";

// The central scheduler: the only thing that turns elapsed game time into
// domain clocks (ARCHITECTURE.md, "Horloges"). No system reads a clock itself.
//
//   military, tiles, fronts            OpenFront tick   (not scheduled here)
//   economy                            1 / game day
//   events, diplomacy                  1 / game day
//   politics (opinion, stability)      1 / game week
//   politics (elections, laws, budget) 1 / game month
//   blocs                              1 / game month
//   save (autosave)                    1 / game month
//
// It keeps no state: everything derives from elapsedGameMinutes, which is
// saved. A week is seven days counted from the start date; a month starts on
// the 1st of a calendar month.

export const DOMAINS = [
  "economy",
  "events",
  "diplomacy",
  "politics",
  "blocs",
  "save",
] as const;
export type Domain = (typeof DOMAINS)[number];

export type ClockKind = "day" | "week" | "month";

export interface ClockContext {
  date: string; // ISO date of the day that starts
  day: number; // index since the start date
}

// What a domain plugs into the scheduler. Every hook is optional: at J1 all
// domains are registered and empty.
export interface DomainSystem {
  domain: Domain;
  onDay?(context: ClockContext): void;
  onWeek?(context: ClockContext): void;
  onMonth?(context: ClockContext): void;
}

// Instrumentation boundary: the simulation does not touch `performance`.
// The worker injects a probe backed by performance.mark / measure.
export interface PerfProbe {
  measure(domain: Domain, clock: ClockKind, run: () => void): void;
}

export const NULL_PROBE: PerfProbe = {
  measure: (_domain, _clock, run) => run(),
};

// Which domains tick on which clock, in execution order.
const CLOCKS: Record<ClockKind, readonly Domain[]> = {
  day: ["economy", "events", "diplomacy"],
  week: ["politics"],
  month: ["politics", "blocs", "save"],
};

export interface SchedulerTick {
  context: ClockContext;
  monthStarted: boolean;
  weekStarted: boolean;
}

export class Scheduler {
  private readonly byDomain = new Map<Domain, DomainSystem>();

  constructor(
    systems: readonly DomainSystem[] = emptySystems(),
    private readonly probe: PerfProbe = NULL_PROBE,
  ) {
    for (const system of systems) {
      if (this.byDomain.has(system.domain)) {
        throw new Error(`two systems registered for ${system.domain}`);
      }
      this.byDomain.set(system.domain, system);
    }
  }

  // Runs every clock crossed when time goes from `fromMinutes` to `toMinutes`.
  // Returns one entry per game day started, in order.
  run(
    startDate: string,
    fromMinutes: number,
    toMinutes: number,
  ): SchedulerTick[] {
    const ticks: SchedulerTick[] = [];
    for (
      let day = dayIndex(fromMinutes) + 1;
      day <= dayIndex(toMinutes);
      day++
    ) {
      const context = { date: dateOfDay(startDate, day), day };
      const weekStarted = day % DAYS_PER_GAME_WEEK === 0;
      const monthStarted = isFirstOfMonth(context.date);
      this.fire("day", context);
      if (weekStarted) this.fire("week", context);
      if (monthStarted) this.fire("month", context);
      ticks.push({ context, weekStarted, monthStarted });
    }
    return ticks;
  }

  private fire(clock: ClockKind, context: ClockContext): void {
    const hook =
      clock === "day" ? "onDay" : clock === "week" ? "onWeek" : "onMonth";
    for (const domain of CLOCKS[clock]) {
      const system = this.byDomain.get(domain);
      if (system === undefined) continue;
      this.probe.measure(domain, clock, () => system[hook]?.(context));
    }
  }
}

export function emptySystems(): DomainSystem[] {
  return DOMAINS.map((domain) => ({ domain }));
}
