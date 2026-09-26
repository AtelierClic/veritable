import fs from "fs";
import path from "path";
import { loadScenarioPackFrom } from "../../../src/veritable/adapters/scenarioPackFrom";
import { createDataSource } from "../../../src/veritable/data/DataSource";
import { fsDataFiles } from "../../../src/veritable/data/files.fs";
import { coreDriver } from "./coreDriver";

// Performance of a campaign on the OpenFront core (J6): the time of every
// tick (core + simulation) in windows of a year starting at given dates,
// the save written at the start of each window (the browser measures its
// speed by loading them), its size, and the heap.
//
//   node --expose-gc --import tsx tools/veritable/headless/perfWorld.ts \
//     --scenario world-2026 --years 50 --windows 2026,2040,2060,2075 \
//     --out docs/veritable/reports/J6/perf
//
// The measure of a map (J6a): --years 1 --windows 2026.
// J7 (the point 37): --load <file.vsave> starts from a save instead of a new
// campaign; the first window then opens at the save's date and counts the
// first tick after the load, and the first day and first month are reported.

function option(args: string[], name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scenarioId = option(args, "scenario", "world-2026");
  const years = Number(option(args, "years", "1"));
  const seed = Number(option(args, "seed", "42"));
  const player = option(args, "player", "FRA");
  const load = option(args, "load", "");
  const out = option(args, "out", "");
  const gc = (globalThis as { gc?: () => void }).gc;

  const started = Date.now();
  const source = createDataSource(fsDataFiles());
  const pack = await loadScenarioPackFrom(source, scenarioId);
  const config = source.config();
  // From the first tick of the campaign: kept when the first window opens
  // on the first day.
  let ticks: number[] | null = [];
  const loadStarted = performance.now();
  const driver = await coreDriver(
    pack,
    config,
    seed,
    player,
    true,
    (ms) => ticks?.push(ms),
    load === "" ? undefined : new Uint8Array(fs.readFileSync(load)),
  );
  const loadMs = performance.now() - loadStarted;
  const startYear = Number(driver.read().date.slice(0, 4));
  const windows = option(args, "windows", String(startYear))
    .split(",")
    .map((y) => Number(y));
  const heap = () => {
    gc?.();
    return Math.round(process.memoryUsage().heapUsed / 1e6);
  };
  const results: Record<string, unknown>[] = [];
  const end = `${startYear + years}-01-01`;
  let current: { year: number; until: string } | null = null;
  if (out !== "") fs.mkdirSync(out, { recursive: true });
  const heapAtStart = heap();
  for (;;) {
    const date = driver.read().date;
    if (date >= end) break;
    const year = Number(date.slice(0, 4));
    // A window opens on the first day of its year.
    if (current === null && windows.includes(year)) {
      if (!results.some((r) => r.year === year)) {
        const bytes = driver.snapshot();
        if (out !== "") {
          fs.writeFileSync(
            path.join(out, `${scenarioId}-${year}.vsave`),
            bytes,
          );
        }
        current = { year, until: `${year + 1}${date.slice(4)}` };
        ticks = results.length === 0 && year === startYear ? (ticks ?? []) : [];
        results.push({
          year,
          from: date,
          saveBytes: bytes.length,
          heapMbAtStart: heap(),
        });
      }
    }
    driver.advanceDay();
    if (current !== null && driver.read().date >= current.until) {
      const inOrder = ticks ?? [];
      const sorted = [...inOrder].sort((a, b) => a - b);
      const r = results.find((x) => x.year === current!.year)!;
      const ticksPerDay = Math.round(
        (24 * 60) / config.time.gameMinutesPerTick,
      );
      Object.assign(r, {
        to: driver.read().date,
        firstDayMaxMs: Math.max(0, ...inOrder.slice(0, ticksPerDay)),
        firstMonthMaxMs: Math.max(0, ...inOrder.slice(0, ticksPerDay * 31)),
        ticks: sorted.length,
        meanMs: sorted.reduce((s, v) => s + v, 0) / Math.max(1, sorted.length),
        p50Ms: percentile(sorted, 0.5),
        p90Ms: percentile(sorted, 0.9),
        p99Ms: percentile(sorted, 0.99),
        maxMs: sorted[sorted.length - 1] ?? 0,
        over10ms: sorted.filter((v) => v > 10).length,
        over100ms: sorted.filter((v) => v > 100).length,
      });
      process.stdout.write(`${JSON.stringify(r)}\n`);
      current = null;
      ticks = null;
    }
  }
  const finalBytes = driver.snapshot();
  const view = driver.read();
  const summary = {
    scenario: scenarioId,
    map: pack.scenario.map,
    nations: pack.scenario.nations.length,
    microstates: Object.keys(pack.meta.microstates ?? {}).length,
    tiles: pack.borders.width * pack.borders.height,
    loadMs: Math.round(loadMs),
    loaded: load === "" ? null : path.basename(load),
    years,
    endDate: view.date,
    finalSaveBytes: finalBytes.length,
    heapMbAtStart: heapAtStart,
    heapMbAtEnd: heap(),
    wars: view.diplomacy.wars.length,
    windows: results,
    perfByDomain: driver.perf(),
    wallS: Math.round((Date.now() - started) / 1000),
  };
  process.stdout.write(
    `${JSON.stringify({ ...summary, perfByDomain: undefined })}\n`,
  );
  // The slowest call of each domain: what a long tick is made of.
  process.stdout.write(
    `${JSON.stringify(
      Object.fromEntries(
        Object.entries(summary.perfByDomain).map(([k, v]) => [
          k,
          `${Math.round(v.totalMs)} ms / ${v.calls}, max ${(v.maxMs ?? 0).toFixed(1)}`,
        ]),
      ),
    )}\n`,
  );
  if (out !== "") {
    fs.writeFileSync(
      path.join(out, `${scenarioId}-${pack.scenario.map}-${years}y.json`),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    fs.writeFileSync(path.join(out, `${scenarioId}-end.vsave`), finalBytes);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
