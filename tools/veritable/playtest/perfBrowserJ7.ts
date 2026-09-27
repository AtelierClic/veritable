import fs from "fs";
import path from "path";
import { sleep } from "./browser";
import { Playtest } from "./harness";

// The speed of the game in the browser (J7c.5), on the saves of the headless
// performance run (tools/veritable/headless/perfWorld.ts: the world on the
// first of January 2026, 2040, 2060 and 2075): each save loaded in a fresh
// page, the cities shown and the population mode of the map on (H), the
// automatic pauses at 0 s (the event cards show without stopping the game:
// a window with cards is a window loaded with events), x5 for `seconds`
// real seconds. The date is read every 50 ms: ticks a second over windows
// of 12 real seconds side by side (20 ticks a game day). Criterion: at
// least 49; the windows across the first of a month and those with an
// event card are marked. The first month after a load runs on cold code
// (J6c): its windows are reported apart.
//   npx tsx tools/veritable/playtest/perfBrowserJ7.ts <out> <seconds> <save>...

const OUT = process.argv[2] ?? "docs/veritable/reports/J7/perf/browser";
const SECONDS = Number(process.argv[3] ?? "60");
const SAVES = process.argv.slice(4);
const TICKS_PER_DAY = 20;

interface Sample {
  t: number;
  date: string;
  paused: boolean;
  cards: number;
}

interface Window {
  from: string;
  to: string;
  ticksPerSecond: number;
  monthStart: boolean;
  cards: boolean;
  firstMonth: boolean;
}

const dayIndex = (d: string) => Math.floor(Date.parse(d) / 86400000);

async function measure(file: string): Promise<{
  save: string;
  loadedAt: string;
  windows: Window[];
}> {
  const name = path.basename(file, ".vsave");
  const t = await Playtest.open(OUT, `perf-${name}`);
  await t.eval(
    `localStorage.setItem("veritable.pause", JSON.stringify({ seconds: 0 }))`,
  );
  await t.eval(`(async () => { vt.panel().show(); await vt.sleep(500); })()`);
  await t.browser.setFile(
    "veritable-panel input[type=file]",
    path.resolve(file),
  );
  let loadedAt = "";
  for (let i = 0; i < 240 && loadedAt === ""; i++) {
    await sleep(1000);
    loadedAt = await t.eval<string>(
      `(async () => { try { const s = vt.screens(); if (!s || !s.sim) return ""; const v = await s.sim.hud(); return v.date; } catch (e) { return ""; } })()`,
    );
  }
  await sleep(4000);
  await t.eval(`vt.speed("⏸")`);
  await t.browser.key("KeyH", "h");
  await sleep(1500);
  await t.step(`Sauvegarde ${name} chargée : mode population`, [
    `date ${loadedAt}`,
  ]);
  const samples: Sample[] = [];
  await t.eval(`vt.speed("×5")`);
  const started = Date.now();
  while (Date.now() - started < SECONDS * 1000) {
    samples.push(
      await t.eval<Sample>(`(async () => {
        const h = await vt.sim().hud();
        const bar = vt.text(vt.bar());
        return { t: performance.now(), date: h.date, paused: bar.includes("Reprise dans") || bar.includes("En pause"), cards: document.querySelectorAll("veritable-event-cards [data-card]").length };
      })()`),
    );
    await sleep(50);
  }
  await t.step(`Sauvegarde ${name} : ×5 pendant ${SECONDS} s`, [
    `de ${samples[0]?.date} à ${samples[samples.length - 1]?.date}`,
  ]);
  await t.eval(`vt.speed("⏸")`);
  await t.close();

  // The date changes and their times; windows of 12 s side by side.
  const changes: {
    t: number;
    day: number;
    date: string;
    paused: boolean;
    cards: number;
  }[] = [];
  // A change follows a pause when any sample since the change before was
  // paused.
  let pausedSince = false;
  for (let i = 1; i < samples.length; i++) {
    pausedSince = pausedSince || samples[i - 1].paused || samples[i].paused;
    if (samples[i].date !== samples[i - 1].date) {
      changes.push({
        t: samples[i].t,
        day: dayIndex(samples[i].date),
        date: samples[i].date,
        paused: pausedSince,
        cards: Math.max(samples[i].cards, samples[i - 1].cards),
      });
      pausedSince = false;
    }
  }
  const firstMonthEnd = new Date(Date.parse(loadedAt));
  firstMonthEnd.setUTCMonth(firstMonthEnd.getUTCMonth() + 1, 2);
  const windows: Window[] = [];
  for (let i = 0; i < changes.length; i++) {
    let j = i;
    while (j + 1 < changes.length && changes[j + 1].t - changes[i].t <= 12000) {
      j++;
    }
    if (changes[j].t - changes[i].t < 11000) continue;
    const span = changes.slice(i, j + 1);
    if (span.some((c) => c.paused)) continue;
    const days = changes[j].day - changes[i].day;
    const seconds = (changes[j].t - changes[i].t) / 1000;
    windows.push({
      from: changes[i].date,
      to: changes[j].date,
      ticksPerSecond: (days * TICKS_PER_DAY) / seconds,
      monthStart: span.slice(1).some((c) => c.date.endsWith("-01")),
      cards: span.some((c) => c.cards > 0),
      firstMonth: changes[i].date < firstMonthEnd.toISOString().slice(0, 10),
    });
    i = j;
  }
  return { save: name, loadedAt, windows };
}

async function main(): Promise<void> {
  const results = [];
  for (const file of SAVES) {
    const r = await measure(file);
    const warm = r.windows.filter((w) => !w.firstMonth);
    const rates = warm.map((w) => w.ticksPerSecond).sort((a, b) => a - b);
    const summary = {
      ...r,
      warmMin: rates[0] ?? null,
      warmMedian: rates[Math.floor(rates.length / 2)] ?? null,
      warmUnder49: warm.filter((w) => w.ticksPerSecond < 49).length,
      monthStartWindow: warm.find((w) => w.monthStart) ?? null,
      cardWindow: r.windows.find((w) => w.cards) ?? null,
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    results.push(summary);
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, "browser.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
