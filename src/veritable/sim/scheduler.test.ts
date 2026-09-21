import { dateAfter, dateOfDay, dayIndex } from "./calendar";
import {
  ClockKind,
  Domain,
  DOMAINS,
  DomainSystem,
  PerfProbe,
  Scheduler,
} from "./scheduler";

const DAY = 1440;
const START = "2026-01-01";

function recorder() {
  const calls: string[] = [];
  const systems: DomainSystem[] = DOMAINS.map((domain) => ({
    domain,
    onDay: (c) => calls.push(`${c.date} day ${domain}`),
    onWeek: (c) => calls.push(`${c.date} week ${domain}`),
    onMonth: (c) => calls.push(`${c.date} month ${domain}`),
  }));
  return { calls, systems };
}

describe("calendar", () => {
  it("follows the real calendar, leap years included", () => {
    expect(dateOfDay(START, 0)).toBe("2026-01-01");
    expect(dateOfDay(START, 31)).toBe("2026-02-01");
    expect(dateOfDay(START, 59)).toBe("2026-03-01"); // 2026: February has 28 days
    expect(dateOfDay(START, 365)).toBe("2027-01-01");
    expect(dateOfDay(START, 365 + 365 + 59)).toBe("2028-02-29");
    expect(dateOfDay(START, 1826)).toBe("2031-01-01"); // five years, one leap day
  });

  it("a day is 1 440 game minutes", () => {
    expect(dayIndex(1439.9)).toBe(0);
    expect(dayIndex(1440)).toBe(1);
    expect(dateAfter(START, 1440 * 31 + 5)).toBe("2026-02-01");
  });
});

describe("Scheduler", () => {
  it("fires nothing until a day boundary is crossed", () => {
    const { calls, systems } = recorder();
    const scheduler = new Scheduler(systems);
    expect(scheduler.run(START, 0, DAY - 1)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("daily domains tick once per day, in a fixed order", () => {
    const { calls, systems } = recorder();
    new Scheduler(systems).run(START, 0, DAY);
    expect(calls).toEqual([
      "2026-01-02 day economy",
      "2026-01-02 day events",
      "2026-01-02 day diplomacy",
    ]);
  });

  it("politics ticks weekly; economy, politics, blocs and save tick monthly", () => {
    const { calls, systems } = recorder();
    const ticks = new Scheduler(systems).run(START, 0, DAY * 31);
    expect(ticks).toHaveLength(31);
    expect(calls.filter((c) => c.includes(" week "))).toEqual([
      "2026-01-08 week politics",
      "2026-01-15 week politics",
      "2026-01-22 week politics",
      "2026-01-29 week politics",
    ]);
    expect(calls.filter((c) => c.includes(" month "))).toEqual([
      "2026-02-01 month economy",
      "2026-02-01 month politics",
      "2026-02-01 month blocs",
      "2026-02-01 month save",
    ]);
    expect(
      ticks.filter((t) => t.monthStarted).map((t) => t.context.date),
    ).toEqual(["2026-02-01"]);
  });

  it("is independent of how time is sliced", () => {
    const whole = recorder();
    new Scheduler(whole.systems).run(START, 0, DAY * 400);
    const sliced = recorder();
    const scheduler = new Scheduler(sliced.systems);
    let t = 0;
    while (t < DAY * 400) {
      const next = Math.min(DAY * 400, t + 72); // one core tick at a time
      scheduler.run(START, t, next);
      t = next;
    }
    expect(sliced.calls).toEqual(whole.calls);
  });

  it("five years of play: 1 826 days, 60 months, 260 weeks", () => {
    const { calls, systems } = recorder();
    new Scheduler(systems).run(START, 0, DAY * 1826);
    expect(calls.filter((c) => c.endsWith("day economy"))).toHaveLength(1826);
    expect(calls.filter((c) => c.endsWith("month save"))).toHaveLength(60);
    expect(calls.filter((c) => c.endsWith("week politics"))).toHaveLength(260);
  });

  it("times every domain through the probe", () => {
    const seen = new Map<string, number>();
    const probe: PerfProbe = {
      measure(domain: Domain, clock: ClockKind, run) {
        seen.set(
          `${domain}/${clock}`,
          (seen.get(`${domain}/${clock}`) ?? 0) + 1,
        );
        run();
      },
    };
    new Scheduler(undefined, probe).run(START, 0, DAY * 31);
    expect(Object.fromEntries(seen)).toEqual({
      "economy/day": 31,
      "events/day": 31,
      "diplomacy/day": 31,
      "politics/week": 4,
      "economy/month": 1,
      "politics/month": 1,
      "blocs/month": 1,
      "save/month": 1,
    });
  });

  it("refuses two systems for one domain", () => {
    expect(
      () => new Scheduler([{ domain: "economy" }, { domain: "economy" }]),
    ).toThrow();
  });
});
