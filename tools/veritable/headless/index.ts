import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadScenarioPackFrom } from "../../../src/veritable/adapters/scenarioPackFrom";
import { createDataSource } from "../../../src/veritable/data/DataSource";
import { fsDataFiles } from "../../../src/veritable/data/files.fs";
import {
  parseScript,
  parseShock,
  runCampaign,
  ScriptEntry,
  seriesCsv,
} from "./campaign";
import { coreDriver } from "./coreDriver";

// Headless runner v1: AI against AI, no rendering.
//
//   npm run veritable:headless -- --scenario europe-10 --years 20 --runs 10 --seed 42
//   npm run veritable:headless -- --scenario europe-10 --years 20 --runs 1 --seed 42 \
//       --shock cut-gas-exports:RUS@2028-01
//
// Options: --player <NATION> (default: the one of the scenario), --out <dir>,
// --core (the OpenFront core on the real map: fronts, captures, landings),
// --script <commands.json> (dated player commands of --player, see
// campaign.ts; the scripted nation is then run by nobody else).
// Output, per campaign: <out>/<scenario>-seed<N>[-shock].json (metrics, CPU
// time per domain, events) and .csv (monthly series: prices, GDP, debt,
// stability, shortage, gas coverage), plus <out>/summary.json.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.join(HERE, "out");

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scenarioId = option(args, "scenario") ?? "europe-10";
  const years = Number(option(args, "years") ?? 20);
  const runs = Number(option(args, "runs") ?? 1);
  const seed = Number(option(args, "seed") ?? 42);
  const shockText = option(args, "shock");
  const core = args.includes("--core");
  const scriptFile = option(args, "script");
  const out = path.resolve(option(args, "out") ?? DEFAULT_OUT);
  if (!(years > 0) || !(runs > 0) || !Number.isInteger(seed)) {
    throw new Error("--years and --runs must be positive, --seed an integer");
  }

  const source = createDataSource(fsDataFiles());
  const pack = await loadScenarioPackFrom(source, scenarioId);
  const config = source.config();
  const shock = shockText === undefined ? undefined : parseShock(shockText);
  const script: ScriptEntry[] | undefined =
    scriptFile === undefined
      ? undefined
      : parseScript(JSON.parse(fs.readFileSync(scriptFile, "utf8")));
  const player = option(args, "player") ?? pack.scenario.playerDefault;
  fs.mkdirSync(out, { recursive: true });

  const summary = [];
  for (let run = 0; run < runs; run++) {
    const result = runCampaign({
      pack,
      config,
      seed: seed + run,
      years,
      player,
      shock,
      script,
      driver: core
        ? await coreDriver(
            pack,
            config,
            seed + run,
            player,
            script === undefined,
          )
        : undefined,
    });
    const name = `${scenarioId}-seed${seed + run}${shock ? "-shock" : ""}`;
    const { series, ...metrics } = result;
    fs.writeFileSync(
      path.join(out, `${name}.json`),
      JSON.stringify(metrics, null, 2) + "\n",
    );
    fs.writeFileSync(path.join(out, `${name}.csv`), seriesCsv(result));
    const prices = Object.values(result.final.priceRange);
    summary.push({
      seed: seed + run,
      wallMs: result.wallMs,
      minPrice: Math.min(...prices.map((p) => p[0])),
      maxPrice: Math.max(...prices.map((p) => p[1])),
      maxDebtToGdp: Math.max(...Object.values(result.final.maxDebtToGdp)),
      meanStability: result.final.meanStability,
      defaults: result.defaults.length,
      unrest: result.unrest.length,
      series: series.length,
    });
    console.log(
      `${name}: ${result.endDate}, ${result.wallMs} ms, prices ${summary[run].minPrice.toFixed(2)}-${summary[run].maxPrice.toFixed(2)} x base, max debt/GDP ${summary[run].maxDebtToGdp.toFixed(2)}, defaults ${result.defaults.length}, unrest ${result.unrest.length}, wars ${result.wars.length}`,
    );
  }
  fs.writeFileSync(
    path.join(out, "summary.json"),
    JSON.stringify(
      { scenarioId, years, runs, seed, shock: shock ?? null, summary },
      null,
      2,
    ) + "\n",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
