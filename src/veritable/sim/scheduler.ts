import {
  dateOfDay,
  dayIndex,
  DAYS_PER_GAME_WEEK,
  isFirstOfMonth,
} from "./calendar";

// The central scheduler: the only thing that turns elapsed game time into
// the day and month clocks (ARCHITECTURE.md, "Horloges"). No system reads a
// clock itself. J7: nothing waits for the 1st of the month but what is
// calendar by nature; the heavy work of each nation runs on the rolling
// queue of the nations (schedule.ts), tick by tick, and the goods of the
// market take turns — the simulation drives both from the core tick.
//
//   military, tiles, fronts            OpenFront tick   (VeritableSimImpl)
//   nations (economy, budget, opinion,
//   politics, military, research,
//   diplomacy, AI)                     rolling queue    (schedule.ts)
//   trade (flows of each good)         a good at a time (VeritableSimImpl)
//   events (draws)                     spread over the ticks of the day
//   economy (prices, rest of world)    1 / game day
//   diplomacy (navy, nuclear, wars'
//   ledgers, contest)                  1 / game day
//   blocs (votes due, exits, defence)  1 / game day; sessions on their day
//   events (deadlines, cooldowns)      1 / game day
//   blocs (presidencies, budget, EU
//   fiscal rule)                       1 / game month (the 1st)
//   save (autosave, journal)           1 / game month (the 1st)
//
// It keeps no state: everything derives from elapsedGameMinutes, which is
// saved. A month starts on the 1st of a calendar month.

export const DOMAINS = [
  "economy",
  "events",
  "diplomacy",
  "politics",
  "blocs",
  "save",
  // Driven by the simulation at every core tick, outside the scheduler
  // (they only appear here to be timed by the probe): the fronts, the
  // rolling queue of the nations (J7), the turns of the goods (J7).
  "war",
  "nations",
  "trade",
] as const;
export type Domain = (typeof DOMAINS)[number];

export type ClockKind = "day" | "week" | "month" | "tick";

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

// Which domains tick on which clock, in execution order. J7: no weekly
// clock any more (opinion and stability are in the rolling queue).
const CLOCKS: Record<ClockKind, readonly Domain[]> = {
  day: ["economy", "diplomacy", "blocs", "events"],
  week: [],
  month: ["blocs", "save"],
  tick: [], // run by the simulation itself
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
