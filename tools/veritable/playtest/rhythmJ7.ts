import fs from "fs";
import path from "path";
import { sleep } from "./browser";
import { Playtest } from "./harness";

// The rhythm of a campaign and the performance in the browser (J7c.5): France
// on the world map, five years at x5, the cities shown and the population
// mode of the map on, nothing answered (the government decides). Measured:
//   - the automatic pauses (the countdown of the speed control) over the
//     real time: at most 10 %;
//   - the figures of the player's nation (GDP, debt, population, stability)
//     sampled every two real seconds: they move at least once in every game
//     week;
//   - the ticks a second at x5 over windows of 12 real seconds without a
//     pause (the date changes timed every 50 ms, 20 ticks a game day): at
//     least 49; a window across the 1st of a month and one with an event
//     card are reported apart.
//   npx tsx tools/veritable/playtest/rhythmJ7.ts [out] [years]

const OUT = process.argv[2] ?? "docs/veritable/reports/J7/rhythm";
const YEARS = Number(process.argv[3] ?? "5");
const TICKS_PER_DAY = 20;
const FIGURES_UNTIL = "2028-01-01";

function dayToDate(day: number): string {
  return new Date(Date.parse("2026-01-01") + day * 86400000)
    .toISOString()
    .slice(0, 10);
}

interface Sample {
  t: number;
  date: string;
  paused: boolean;
  cards: number;
}

async function main(): Promise<void> {
  const t = await Playtest.open(OUT, "rhythm");
  await t.eval(`vt.start("world-2026", "FRA")`);
  await sleep(6000);
  await t.browser.key("KeyH", "h");
  await sleep(1500);
  const end = `${2026 + YEARS}-01-01`;
  const samples: Sample[] = [];
  const figures: { date: string; values: number[] }[] = [];
  const started = Date.now();
  let lastFigures = 0;
  await t.eval(`vt.speed("×5")`);
  for (;;) {
    const s = await t.eval<Sample>(`(async () => {
      const h = await vt.sim().hud();
      const bar = vt.text(vt.bar());
      return { t: performance.now(), date: h.date, paused: bar.includes("Reprise dans") || bar.includes("En pause"), cards: h.pending.length };
    })()`);
    samples.push(s);
    if (s.date >= end) break;
    // The figures the first two years; the ticks a second measured after
    // (a full read of the view costs the worker tens of milliseconds).
    if (s.date < FIGURES_UNTIL && Date.now() - lastFigures > 2000) {
      lastFigures = Date.now();
      figures.push(
        await t.eval<{ date: string; values: number[] }>(
          `vt.view().then((v) => { const e = v.economies[v.playerNation]; const p = v.politics[v.playerNation]; return { date: v.date, values: [e.gdp, e.debt, e.population, p.stability] }; })`,
        ),
      );
    }
    // A pause the player keeps (Space) never comes: the countdown resumes
    // by itself; a pause left over (a notice kept) is lifted.
    if (
      s.paused &&
      !(await t.eval<string>(`vt.text(vt.bar())`)).includes("Reprise")
    ) {
      await t.eval(`vt.speed("×5")`);
    }
    await sleep(50);
  }
  await t.eval(`vt.speed("⏸")`);
  const realMs = Date.now() - started;
  // The events of the campaign by day of the month: the journal's (five
  // years are kept in full): the player's, the world's and the scripted
  // ones of the AI.
  const eventDays = await t.eval<number[]>(`vt.view().then((v) => {
    const days = new Array(31).fill(0);
    for (const j of v.journal) if (j.kind === "event-occurred") days[Number(j.date.slice(8, 10)) - 1] += 1;
    return days;
  })`);

  // Pauses: the time of the samples in a pause.
  let pausedMs = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1].paused) pausedMs += samples[i].t - samples[i - 1].t;
  }

  // Figures: weeks without a change.
  const byWeek = new Map<number, Set<string>>();
  const dayIndex = (d: string) =>
    Math.floor((Date.parse(d) - Date.parse("2026-01-01")) / 86400000);
  for (let i = 1; i < figures.length; i++) {
    const changed = figures[i].values.some(
      (v, k) => v !== figures[i - 1].values[k],
    );
    const week = Math.floor(dayIndex(figures[i].date) / 7);
    const set = byWeek.get(week) ?? new Set();
    set.add(changed ? "changed" : "same");
    byWeek.set(week, set);
  }
  const weeks = [...byWeek.entries()].filter(([w]) => w > 0);
  const stillWeeks = weeks.filter(([, s]) => !s.has("changed")).length;

  // Ticks a second over windows of 12 s: the date changes and their times.
  // A change follows a pause when any sample since the change before was
  // paused (J7c: the game resumes some samples before the date moves; the
  // window then held the three seconds of a card and read 37 ticks/s).
  const changes: { t: number; day: number; paused: boolean; cards: number }[] =
    [];
  let pausedSince = false;
  for (let i = 1; i < samples.length; i++) {
    pausedSince = pausedSince || samples[i - 1].paused || samples[i].paused;
    if (samples[i].date !== samples[i - 1].date) {
      changes.push({
        t: samples[i].t,
        day: dayIndex(samples[i].date),
        paused: pausedSince,
        cards: samples[i].cards,
      });
      pausedSince = false;
    }
  }
  const windows: {
    from: string;
    ticksPerSecond: number;
    monthStart: boolean;
    cards: boolean;
  }[] = [];
  for (let i = 0; i < changes.length; i++) {
    let j = i;
    while (j + 1 < changes.length && changes[j + 1].t - changes[i].t <= 12000)
      j++;
    if (changes[j].t - changes[i].t < 11000) continue;
    const span = changes.slice(i, j + 1);
    if (span.some((c) => c.paused)) continue;
    if (dayToDate(changes[i].day) < FIGURES_UNTIL) continue;
    const days = changes[j].day - changes[i].day;
    const seconds = (changes[j].t - changes[i].t) / 1000;
    const dates = span.map((c) => dayToDate(c.day));
    windows.push({
      from: dates[0],
      ticksPerSecond: (days * TICKS_PER_DAY) / seconds,
      monthStart: dates.some((d) => d.endsWith("-01")),
      cards: span.some((c) => c.cards > 0),
    });
    i = j; // windows side by side
  }
  const rates = windows.map((w) => w.ticksPerSecond).sort((a, b) => a - b);
  const eventsTotal = eventDays.reduce((a, b) => a + b, 0);
  const busiest = eventDays.indexOf(Math.max(...eventDays));
  const summary = {
    years: YEARS,
    events: eventsTotal,
    busiestDay: busiest + 1,
    busiestDayShare: eventsTotal > 0 ? eventDays[busiest] / eventsTotal : 0,
    noDayAbove8pct:
      eventsTotal > 0 && eventDays.every((d) => d / eventsTotal <= 0.08),
    realMinutes: realMs / 60000,
    pausedShare: pausedMs / realMs,
    pausesUnder10pct: pausedMs / realMs <= 0.1,
    weeks: weeks.length,
    weeksWithoutChange: stillWeeks,
    windows: windows.length,
    ticksPerSecondMin: rates[0],
    ticksPerSecondMedian: rates[Math.floor(rates.length / 2)],
    windowsUnder49: windows.filter((w) => w.ticksPerSecond < 49).length,
    monthStartWindow: windows.find((w) => w.monthStart) ?? null,
    cardWindow: windows.find((w) => w.cards) ?? null,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  await t.close();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, "rhythm.json"),
    `${JSON.stringify({ ...summary, eventDays, windowsList: windows }, null, 2)}\n`,
  );
  // The samples themselves, to look into a slow window (outside the
  // repository: a large file).
  if (process.env.RHYTHM_SAMPLES !== undefined) {
    fs.writeFileSync(process.env.RHYTHM_SAMPLES, JSON.stringify(samples));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
