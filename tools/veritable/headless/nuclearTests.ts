import { fork } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadScenarioPackFrom } from "../../../src/veritable/adapters/scenarioPackFrom";
import { createDataSource } from "../../../src/veritable/data/DataSource";
import { fsDataFiles } from "../../../src/veritable/data/files.fs";
import { NationData } from "../../../src/veritable/data/schemas/nation";
import {
  DiplomacyState,
  MilitaryState,
  PeaceOffer,
  War,
} from "../../../src/veritable/data/schemas/save";
import { joinWar } from "../../../src/veritable/sim/diplomacy/diplomacy";
import { EconomyContext } from "../../../src/veritable/sim/economy/context";
import { WorldPort } from "../../../src/veritable/sim/VeritableSim";
import {
  raiseDivision,
  setConscription,
} from "../../../src/veritable/sim/war/military";
import { proposePeace } from "../../../src/veritable/sim/war/peace";
import { coreDriver } from "./coreDriver";

// Forced nuclear tests of the J6, on the OpenFront core and the Europe map.
//
//   npx tsx tools/veritable/headless/nuclearTests.ts --test invasion \
//     --seeds 20 --years 8 --out docs/veritable/reports/J6/nuclear
//   npx tsx tools/veritable/headless/nuclearTests.ts --test dead-hand \
//     --seeds 20 --out docs/veritable/reports/J6/nuclear
//
// invasion: France, Germany, the United Kingdom and Poland, each given a
// large armoured army, declare war on Russia on the second day (France
// first, the others join its side); the AI runs every nation, France
// included. The coalition fights to the end (its exhaustion and retreat
// counters are reset every day, so it never asks for or accepts a
// ceasefire) and a member without a front against Russia lands on its
// coast every 20 days (the harness sends the transport, whatever the
// control of the sea: the test is the nuclear answer, not the navy). Every
// day the
// harness reads Russia's threat level and its daily probability of a shot
// (what the nuclear panel shows); the expected chance of a Russian shot in
// a campaign is 1 - prod(1 - p) up to the first shot. Criterion: the share
// of campaigns with a Russian shot is within 50 % of the mean expected
// chance.
//
// dead-hand: France declares war on Russia, then Russia is annexed by a
// treaty signed the next day; the dead hand fires or not. Criterion: the
// share of annexations where it fires is within 15 points of the
// probability shown.
//
// The harness scripts AI nations by reaching into the simulation (its
// private state): a test tool, not a way to play.

interface Internals {
  ctx: EconomyContext;
  diplomacy: DiplomacyState;
  military: MilitaryState;
  sheets: ReadonlyMap<string, NationData>;
  deps: { world: WorldPort };
  invalidateFronts(): void;
  sign(war: War, offer: PeaceOffer, date: string): void;
}

function option(args: string[], name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}

const COALITION = ["FRA", "DEU", "GBR", "POL"];

interface InvasionResult {
  seed: number;
  daysByLevel: Record<string, number>;
  landings: number;
  warOver: boolean;
  firstLevel3: string | null;
  expected: number; // 1 - prod(1 - p) up to the first shot
  shot: { date: string; threat: number; target: string } | null;
  tilesLostShare: number;
  stability: number;
  endDate: string;
  wallS: number;
}

async function invasion(
  seed: number,
  years: number,
  divisions: number,
  radius: number,
): Promise<InvasionResult> {
  const started = Date.now();
  const source = createDataSource(fsDataFiles());
  const pack = await loadScenarioPackFrom(source, "europe-10");
  const config = source.config();
  const driver = await coreDriver(pack, config, seed, "FRA", true);
  driver.advanceDay();
  const sim = driver.sim as Internals;
  for (const id of COALITION) {
    const m = sim.military.nations[id];
    setConscription(sim.ctx, m, sim.sheets.get(id)!.population.value, "total");
    m.manpower += divisions * sim.ctx.template("armored").men;
    for (let k = 0; k < divisions; k++) {
      const d = raiseDivision(sim.ctx, m, "armored", null);
      d.equipment = 1;
      d.training = 1.2;
    }
  }
  driver.apply({ type: "declare-war", target: "RUS", casusBelli: "none" });
  const war = sim.diplomacy.wars.find(
    (w) => w.aggressors.includes("FRA") && w.defenders.includes("RUS"),
  )!;
  for (const id of COALITION.slice(1)) {
    joinWar(sim.ctx, sim.diplomacy, war, id, "aggressors");
  }
  sim.invalidateFronts();

  const daysByLevel: Record<string, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  let landings = 0;
  let day = 0;
  let survive = 1;
  let firstLevel3: string | null = null;
  let shot: InvasionResult["shot"] = null;
  const end = `${2026 + years}-01-02`;
  for (;;) {
    const view = driver.read();
    if (view.date >= end) break;
    for (const id of COALITION) {
      sim.military.nations[id].exhaustion = 0;
      const current = sim.diplomacy.wars.find((w) => w.id === war.id);
      if (current !== undefined) current.retreatMonths[id] = 0;
    }
    if (day % 20 === 0) {
      for (const id of COALITION) {
        const front = view.fronts.some(
          (f) => (f.a === id && f.b === "RUS") || (f.a === "RUS" && f.b === id),
        );
        if (!front && sim.deps.world.launchLanding(id, "RUS", radius)) {
          landings++;
        }
      }
    }
    day++;
    const threat = view.nuclear.nations.RUS?.threat ?? 0;
    daysByLevel[threat] += 1;
    if (threat === 3 && firstLevel3 === null) firstLevel3 = view.date;
    // The decision of the day uses the level just computed; the risk the
    // view shows is that of the last computed level: the same day's value.
    const p = view.nuclearRisk.RUS ?? 0;
    survive *= 1 - p;
    const events = driver.advanceDay();
    const launch = events.find(
      (e) => e.type === "nuclear-launch" && e.nation === "RUS",
    );
    if (launch !== undefined && "params" in launch) {
      shot = {
        date: launch.date,
        threat: Number(launch.params.threat),
        target: launch.params.target,
      };
      break;
    }
  }
  const view = driver.read();
  const initial = view.initialTiles.RUS ?? 1;
  const tiles = view.nations.find((n) => n.id === "RUS")!.tileCount;
  return {
    seed,
    daysByLevel,
    landings,
    warOver: !sim.diplomacy.wars.some((w) => w.id === war.id),
    firstLevel3,
    expected: 1 - survive,
    shot,
    tilesLostShare: 1 - tiles / initial,
    stability: view.politics.RUS?.stability ?? 0,
    endDate: view.date,
    wallS: Math.round((Date.now() - started) / 1000),
  };
}

interface DeadHandResult {
  seed: number;
  shown: number;
  fired: boolean;
  wallS: number;
}

async function deadHand(seed: number): Promise<DeadHandResult> {
  const started = Date.now();
  const source = createDataSource(fsDataFiles());
  const pack = await loadScenarioPackFrom(source, "europe-10");
  const config = source.config();
  const driver = await coreDriver(pack, config, seed, "FRA", true);
  driver.advanceDay();
  const sim = driver.sim as Internals;
  driver.apply({ type: "declare-war", target: "RUS", casusBelli: "none" });
  driver.advanceDay();
  const shown = driver.read().deadHand.RUS ?? 0;
  const war = sim.diplomacy.wars.find(
    (w) => w.aggressors.includes("FRA") && w.defenders.includes("RUS"),
  )!;
  const date = driver.read().date;
  const offer = proposePeace(
    sim.diplomacy,
    war,
    "FRA",
    "RUS",
    {
      kind: "annexation",
      reparationsPctGdp: 0,
      reparationYears: 0,
      maxDivisions: null,
    },
    date,
  );
  sim.sign(war, offer, date);
  const fired = driver
    .read()
    .journal.some((j) => j.kind === "dead-hand" && j.nation === "RUS");
  return {
    seed,
    shown,
    fired,
    wallS: Math.round((Date.now() - started) / 1000),
  };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Runs the seeds in `parallel` child processes (this same script with
// --child), each printing one JSON line per seed.
async function inChildren<T>(
  args: string[],
  seeds: number[],
  parallel: number,
): Promise<T[]> {
  const groups: number[][] = Array.from({ length: parallel }, () => []);
  seeds.forEach((seed, i) => groups[i % parallel].push(seed));
  const results: T[] = [];
  await Promise.all(
    groups
      .filter((g) => g.length > 0)
      .map(
        (group) =>
          new Promise<void>((resolve, reject) => {
            const child = fork(
              path.join(HERE, "nuclearTests.ts"),
              [...args, "--child", "--list", group.join(",")],
              {
                execArgv: ["--import", "tsx"],
                stdio: ["ignore", "pipe", "inherit", "ipc"],
              },
            );
            let buffer = "";
            child.stdout?.on("data", (chunk: Buffer) => {
              buffer += chunk.toString();
              let at: number;
              while ((at = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, at);
                buffer = buffer.slice(at + 1);
                if (line.startsWith('{"seed"')) {
                  results.push(JSON.parse(line) as T);
                  process.stdout.write(`${line}\n`);
                }
              }
            });
            child.on("exit", (code) =>
              code === 0 ? resolve() : reject(new Error(`child: ${code}`)),
            );
          }),
      ),
  );
  return results.sort(
    (a, b) =>
      (a as unknown as { seed: number }).seed -
      (b as unknown as { seed: number }).seed,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const test = option(args, "test", "invasion");
  const seeds = Number(option(args, "seeds", "20"));
  const seed0 = Number(option(args, "seed", "1"));
  const years = Number(option(args, "years", "12"));
  const divisions = Number(option(args, "divisions", "80"));
  const radius = Number(option(args, "radius", "20"));
  const parallel = Number(option(args, "parallel", "1"));
  const out = option(args, "out", "");
  const list =
    option(args, "list", "") !== ""
      ? option(args, "list", "").split(",").map(Number)
      : Array.from({ length: seeds }, (_, i) => seed0 + i);
  const child = args.includes("--child");
  if (test === "invasion") {
    let results: InvasionResult[] = [];
    if (parallel > 1 && !child) {
      results = await inChildren<InvasionResult>(
        [
          "--test",
          test,
          "--years",
          String(years),
          "--divisions",
          String(divisions),
          "--radius",
          String(radius),
        ],
        list,
        parallel,
      );
    } else {
      for (const seed of list) {
        const r = await invasion(seed, years, divisions, radius);
        results.push(r);
        process.stdout.write(`${JSON.stringify(r)}\n`);
      }
    }
    if (child) return;
    const expected =
      results.reduce((s, r) => s + r.expected, 0) / results.length;
    const observed =
      results.filter((r) => r.shot !== null).length / results.length;
    const summary = {
      test,
      seeds: list,
      years,
      divisions,
      landingRadius: radius,
      expectedShare: expected,
      observedShare: observed,
      withinTolerance: Math.abs(observed - expected) <= 0.5 * expected,
      campaignsAtLevel3: results.filter((r) => r.firstLevel3 !== null).length,
      shotLevels: results
        .filter((r) => r.shot !== null)
        .map((r) => r.shot!.threat),
      results,
    };
    process.stdout.write(
      `${JSON.stringify({ ...summary, results: undefined })}\n`,
    );
    if (out !== "") {
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(
        path.join(out, "invasion.json"),
        `${JSON.stringify(summary, null, 2)}\n`,
      );
    }
  } else {
    let results: DeadHandResult[] = [];
    if (parallel > 1 && !child) {
      results = await inChildren<DeadHandResult>(
        ["--test", test],
        list,
        parallel,
      );
    } else {
      for (const seed of list) {
        const r = await deadHand(seed);
        results.push(r);
        process.stdout.write(`${JSON.stringify(r)}\n`);
      }
    }
    if (child) return;
    const shown = results.reduce((s, r) => s + r.shown, 0) / results.length;
    const fired = results.filter((r) => r.fired).length / results.length;
    const summary = {
      test,
      seeds: list,
      shownProbability: shown,
      firedShare: fired,
      withinTolerance: Math.abs(fired - shown) <= 0.15,
      results,
    };
    process.stdout.write(
      `${JSON.stringify({ ...summary, results: undefined })}\n`,
    );
    if (out !== "") {
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(
        path.join(
          out,
          `dead-hand${list.length === 20 ? "" : `-${list.length}`}.json`,
        ),
        `${JSON.stringify(summary, null, 2)}\n`,
      );
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
