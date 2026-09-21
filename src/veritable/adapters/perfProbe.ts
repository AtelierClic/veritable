import { ClockKind, Domain, PerfProbe } from "../sim/scheduler";

export interface DomainTiming {
  calls: number;
  totalMs: number;
  maxMs: number;
}

// Per-domain instrumentation of the scheduler, backed by the User Timing API:
// every domain clock shows up as a `veritable:<domain>:<clock>` measure in the
// browser's performance timeline, and totals are kept for the metrics.
// Marks and measures are cleared at once: a campaign runs for hours.
export class PerformanceProbe implements PerfProbe {
  private readonly timings = new Map<string, DomainTiming>();

  measure(domain: Domain, clock: ClockKind, run: () => void): void {
    const name = `veritable:${domain}:${clock}`;
    performance.mark(name);
    const started = performance.now();
    try {
      run();
    } finally {
      const elapsed = performance.now() - started;
      performance.measure(name, name);
      performance.clearMarks(name);
      performance.clearMeasures(name);
      const timing = this.timings.get(name) ?? {
        calls: 0,
        totalMs: 0,
        maxMs: 0,
      };
      timing.calls++;
      timing.totalMs += elapsed;
      timing.maxMs = Math.max(timing.maxMs, elapsed);
      this.timings.set(name, timing);
    }
  }

  report(): Record<string, DomainTiming> {
    return Object.fromEntries(this.timings);
  }
}
