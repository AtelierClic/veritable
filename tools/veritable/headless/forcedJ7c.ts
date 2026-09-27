import { fork } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadScenarioPackFrom } from "../../../src/veritable/adapters/scenarioPackFrom";
import { createDataSource } from "../../../src/veritable/data/DataSource";
import { fsDataFiles } from "../../../src/veritable/data/files.fs";
import { VeritableConfig } from "../../../src/veritable/data/schemas/config";
import {
  DiplomacyState,
  EconomyState,
  ExileSection,
  NationState,
  NuclearState,
  PeaceOffer,
  War,
} from "../../../src/veritable/data/schemas/save";
import {
  relation,
  setRelation,
} from "../../../src/veritable/sim/diplomacy/diplomacy";
import { launch, NuclearEnv } from "../../../src/veritable/sim/nuclear/nuclear";
import { WorldPort } from "../../../src/veritable/sim/VeritableSim";
import { proposePeace } from "../../../src/veritable/sim/war/peace";
import { coreDriver } from "./coreDriver";

// Forced tests of the J7c, on the OpenFront core and the world map.
//
//   npx tsx tools/veritable/headless/forcedJ7c.ts --test <name> \
//     --seeds 20 --parallel 5 --out docs/veritable/reports/J7/forced
//
// bomb: on the sixth day Russia fires a hydrogen bomb at Paris (about ten
// million people within 40 km on the population grid). The deaths, the
// owner of every tile around ground zero before and after, the
// contamination; then two branches from the save of the day after the
// burst, three years each: France as it is, and France with its
// infrastructure spending 2 points of GDP above its first day and grants of
// 2 % of GDP (set again every day: its AI would undo them). Criterion: the
// contamination at ground zero heals twice as fast (ratio of the logs).
//
// exile / exile-cut: Russia (autopilot) declares war on Austria on the
// second day and annexes it by treaty on the third. Austria — a medium
// nation (9 million people, a GDP of about 500 billion dollars), member of
// the European Union but outside any military alliance, whose partners of
// the Union stand at 40 or more with it and are hostile to Russia — goes
// into exile; three years. (Ukraine, the first choice, has only the United
// States at 40 with it in the relations of 2026: no partner at 40.)
// exile-cut: every relation with Austria is held under 40 every day (no
// support). Criteria: exile of 24 months or more (or a return) in 70 % of
// the seeds; cut: dissolution within 12 to 36 months in 80 %.
//
// liberation: the same annexation; France (played) declares war on Russia,
// takes back 400 tiles of Ukraine's first-day land from it (the harness
// moves them on the core), and signs a ceasefire the next day. Criterion:
// the tiles go back to Ukraine, which leaves its exile.
//
// last-stand: Ukraine (played) is annexed, its support cut until it is
// dissolved; the player goes on with Moldova; the campaign is saved and
// loaded again. Criterion: Moldova played, the journal and the last stand
// intact after the load.
//
// The harness reaches into the simulation (its private state): a test
// tool, not a way to play.

interface Internals {
  diplomacy: DiplomacyState;
  economy: EconomyState;
  nuclear: NuclearState;
  exile: ExileSection;
  nations: NationState[];
  deps: { world: WorldPort; config: VeritableConfig };
  nuclearEnv(date: string): NuclearEnv;
  sign(war: War, offer: PeaceOffer, date: string): void;
}

function option(args: string[], name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}

const SCENARIO = "world-2026";
// The medium nation of the exile tests.
const VICTIM = "AUT";

async function driverFor(
  seed: number,
  player: string,
  autopilot: boolean,
  save?: Uint8Array,
) {
  const source = createDataSource(fsDataFiles());
  const pack = await loadScenarioPackFrom(source, SCENARIO);
  const config = source.config();
  const driver = await coreDriver(
    pack,
    config,
    seed,
    player,
    autopilot,
    undefined,
    save,
  );
  return { driver, sim: driver.sim as Internals };
}

// `annexer` annexes `victim` by treaty (a war between them).
function annex(
  sim: Internals,
  annexer: string,
  victim: string,
  date: string,
): void {
  const war = sim.diplomacy.wars.find(
    (w) =>
      (w.aggressors.includes(annexer) && w.defenders.includes(victim)) ||
      (w.aggressors.includes(victim) && w.defenders.includes(annexer)),
  );
  if (war === undefined) throw new Error(`no war ${annexer}-${victim}`);
  const offer = proposePeace(
    sim.diplomacy,
    war,
    annexer,
    victim,
    {
      kind: "annexation",
      reparationsPctGdp: 0,
      reparationYears: 0,
      maxDivisions: null,
    },
    date,
  );
  sim.sign(war, offer, date);
}

function annexUkraine(sim: Internals, date: string): void {
  annex(sim, "RUS", "UKR", date);
}

function statusOf(sim: Internals, id: string): string {
  return sim.nations.find((n) => n.id === id)?.status ?? "?";
}

// No nation stays at 40 or more with `exile`: no support.
function cutSupport(sim: Internals, exile: string): void {
  for (const n of sim.nations) {
    if (n.id === exile) continue;
    if (relation(sim.diplomacy, n.id, exile) >= 40) {
      setRelation(sim.diplomacy, n.id, exile, 39);
    }
  }
}

// --- bomb ---------------------------------------------------------------------

async function bomb(seed: number, years: number) {
  const started = Date.now();
  const { driver, sim } = await driverFor(seed, "FRA", true);
  // Past the spawn immunity of the core (no warhead is built before).
  for (let d = 0; d < 5; d++) driver.advanceDay();
  const world = sim.deps.world;
  const ground = world.capitalTile("FRA")!;
  const around = world.blastTiles(ground, 40);
  const holdings = world.peopleHoldings().get("FRA") ?? 1;
  const population = sim.economy.nations.FRA.population;
  const metroPeople =
    (around.reduce((s, t) => s + t.people, 0) / holdings) * population;
  const ownersBefore = around.map((t) => world.ownerOf(t.tile));
  const date = driver.read().date;
  const events = launch(
    sim.nuclearEnv(date),
    "RUS",
    "FRA",
    { kind: "capital" },
    "capital",
  );
  if (events.length === 0) throw new Error("the warhead could not leave");
  let strike = sim.nuclear.strikes[sim.nuclear.strikes.length - 1];
  for (let d = 0; d < 20 && strike.status === "in-flight"; d++) {
    driver.advanceDay();
    strike = sim.nuclear.strikes[sim.nuclear.strikes.length - 1];
  }
  const ownersAfter = around.map((t) => world.ownerOf(t.tile));
  const ownersChanged = ownersBefore.filter(
    (o, i) => o !== ownersAfter[i],
  ).length;
  const level0 =
    sim.nuclear.contamination.find((c) => c.tile === strike.tile)?.level ?? 0;
  const save = driver.snapshot();
  const branch = async (help: boolean) => {
    const b = await driverFor(seed, "FRA", true, save);
    const days = Math.round(years * 365.25);
    for (let d = 0; d < days; d++) {
      if (help) {
        const e = b.sim.economy.nations.FRA;
        const infra = e.spending0.infrastructure + 0.02;
        e.spending.infrastructure = infra;
        e.spendingTargets.infrastructure = infra;
        e.grantsPctGdp = 0.02;
      }
      b.driver.advanceDay();
    }
    return (
      b.sim.nuclear.contamination.find((c) => c.tile === strike.tile)?.level ??
      0
    );
  };
  const plain = await branch(false);
  const helped = await branch(true);
  return {
    seed,
    status: strike.status,
    metroPeople,
    deaths: strike.deaths.FRA ?? 0,
    deathsAll: Object.values(strike.deaths).reduce((s, v) => s + v, 0),
    tilesHit: Object.values(strike.hits).reduce((s, v) => s + v, 0),
    ownersChanged,
    tilesAround: around.length,
    level0,
    plain,
    helped,
    speedRatio:
      plain > 0 && plain < level0 && helped > 0
        ? Math.log(helped / level0) / Math.log(plain / level0)
        : null,
    wallS: Math.round((Date.now() - started) / 1000),
  };
}

// --- exile --------------------------------------------------------------------

async function exile(seed: number, years: number, cut: boolean) {
  const started = Date.now();
  // Russia is the nation of the harness's commands; the AI plays it.
  const { driver, sim } = await driverFor(seed, "RUS", true);
  driver.advanceDay();
  driver.apply({ type: "declare-war", target: VICTIM, casusBelli: "none" });
  driver.advanceDay();
  annex(sim, "RUS", VICTIM, driver.read().date);
  driver.advanceDay();
  const opened = statusOf(sim, VICTIM);
  const first = sim.exile.nations[VICTIM];
  const start = { ...first };
  let months = 0;
  const track: { month: number; r: number; s: number; a: number }[] = [];
  let dissolvedAfter: number | null = null;
  let returnedAfter: number | null = null;
  for (let day = 1; day <= Math.round(years * 365.25); day++) {
    if (cut) cutSupport(sim, VICTIM);
    driver.advanceDay();
    if (day % 30 === 0) {
      months++;
      const e = sim.exile.nations[VICTIM];
      if (e !== undefined) {
        track.push({
          month: months,
          r: e.recognition,
          s: e.support,
          a: e.annexation,
        });
      }
      if (statusOf(sim, VICTIM) === "dissolved") {
        dissolvedAfter = months;
        break;
      }
      if (statusOf(sim, VICTIM) === "active") {
        returnedAfter ??= months;
        break;
      }
    }
  }
  return {
    seed,
    cut,
    opened,
    annexer: first?.annexer ?? null,
    start: {
      recognition: start.recognition,
      support: start.support,
      annexation: start.annexation,
      recognizers: start.recognizers?.length ?? 0,
    },
    dissolvedAfter,
    returnedAfter,
    status: statusOf(sim, VICTIM),
    reason:
      driver
        .read()
        .journal.find(
          (j) =>
            j.kind === "nation-status" &&
            j.nation === VICTIM &&
            j.params.to === "dissolved",
        )?.params.reason ?? null,
    returns: driver
      .read()
      .journal.filter((j) => j.kind === "exile-returned" && j.nation === VICTIM)
      .map((j) => j.params.way),
    track: track.filter((_, i) => i % 6 === 5),
    wallS: Math.round((Date.now() - started) / 1000),
  };
}

// --- liberation ---------------------------------------------------------------

async function liberation(seed: number) {
  const started = Date.now();
  const { driver, sim } = await driverFor(seed, "FRA", false);
  driver.advanceDay();
  annexUkraine(sim, driver.read().date);
  driver.advanceDay();
  const exiled = statusOf(sim, "UKR");
  driver.apply({ type: "declare-war", target: "RUS", casusBelli: "none" });
  driver.advanceDay();
  // 400 tiles of Ukraine's first-day land that Russia holds go to France
  // (a friend of Ukraine at war with its annexer: its relation is set to
  // 60 if it is under 40).
  const world = sim.deps.world as unknown as {
    claims: { homeland(n: string): Uint32Array };
    byNation: Map<string, { conquer(tile: number): void }>;
  } & WorldPort;
  const france = world.byNation.get("FRA")!;
  const taken: number[] = [];
  for (const tile of world.claims.homeland("UKR")) {
    if (world.ownerOf(tile) !== "RUS") continue;
    france.conquer(tile);
    taken.push(tile);
    if (taken.length >= 400) break;
  }
  if (relation(sim.diplomacy, "FRA", "UKR") < 40) {
    setRelation(sim.diplomacy, "FRA", "UKR", 60);
  }
  // The ceasefire the next day: a month of war let Russia take the pocket
  // back in most seeds (France has no army there), and the test is about
  // the land a liberator holds at the peace.
  driver.advanceDay();
  const war = sim.diplomacy.wars.find(
    (w) => w.aggressors.includes("FRA") && w.defenders.includes("RUS"),
  )!;
  const date = driver.read().date;
  const held = taken.filter((t) => world.ownerOf(t) === "FRA");
  const offer = proposePeace(
    sim.diplomacy,
    war,
    "FRA",
    "RUS",
    {
      kind: "ceasefire",
      reparationsPctGdp: 0,
      reparationYears: 0,
      maxDivisions: null,
    },
    date,
  );
  sim.sign(war, offer, date);
  const returned = held.filter((t) => world.ownerOf(t) === "UKR").length;
  driver.advanceDay();
  const back = driver
    .read()
    .journal.filter((j) => j.kind === "exile-returned" && j.nation === "UKR");
  return {
    seed,
    exiled,
    taken: taken.length,
    heldAtPeace: held.length,
    stillFrench: taken.filter((t) => world.ownerOf(t) === "FRA").length,
    returned,
    status: statusOf(sim, "UKR"),
    ways: back.map((j) => j.params.way),
    wallS: Math.round((Date.now() - started) / 1000),
  };
}

// --- last stand ---------------------------------------------------------------

// JSON with the keys of every object sorted: a reloaded entry may list its
// fields in another order (its place, then its thread).
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  );
}

async function lastStand(seed: number) {
  const started = Date.now();
  const { driver, sim } = await driverFor(seed, "UKR", false);
  driver.advanceDay();
  annexUkraine(sim, driver.read().date);
  let days = 0;
  while (statusOf(sim, "UKR") !== "dissolved" && days < 5 * 366) {
    cutSupport(sim, "UKR");
    driver.advanceDay();
    days++;
  }
  const dissolved = statusOf(sim, "UKR") === "dissolved";
  const choices = [...driver.read().lastStandChoices];
  if (dissolved) driver.apply({ type: "last-stand", nation: "MDA" });
  driver.advanceDay();
  const before = driver.read();
  const journal = canonical(before.journal);
  const save = driver.snapshot();
  const again = await driverFor(seed, "UKR", false, save);
  const after = again.driver.read();
  return {
    seed,
    dissolvedAfterDays: dissolved ? days : null,
    choices: choices.length,
    moldovaOffered: choices.includes("MDA"),
    player: before.playerNation,
    playerAfterLoad: after.playerNation,
    journalEntries: before.journal.length,
    // Every entry saved is there, unchanged (the loaded game may have gone
    // on by a tick and added one).
    journalIntact:
      canonical(after.journal.slice(0, before.journal.length)) === journal,
    lastStands: after.exile.lastStands,
    saveBytes: save.length,
    wallS: Math.round((Date.now() - started) / 1000),
  };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

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
              path.join(HERE, "forcedJ7c.ts"),
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

async function runOne(test: string, seed: number, years: number) {
  switch (test) {
    case "bomb":
      return bomb(seed, years);
    case "exile":
      return exile(seed, years, false);
    case "exile-cut":
      return exile(seed, years, true);
    case "liberation":
      return liberation(seed);
    case "last-stand":
      return lastStand(seed);
  }
  throw new Error(`unknown test ${test}`);
}

type Result = Awaited<ReturnType<typeof runOne>>;

function summarize(test: string, results: Result[]): Record<string, unknown> {
  const n = results.length;
  switch (test) {
    case "bomb": {
      const r = results as Awaited<ReturnType<typeof bomb>>[];
      const ratios = r
        .map((x) => x.speedRatio)
        .filter((x): x is number => x !== null);
      const deaths = r.map((x) => x.deaths).sort((a, b) => a - b);
      return {
        detonated: r.filter((x) => x.status === "detonated").length,
        metroPeopleMedian: r.map((x) => x.metroPeople).sort((a, b) => a - b)[
          Math.floor(n / 2)
        ],
        deathsMin: deaths[0],
        deathsMedian: deaths[Math.floor(n / 2)],
        deathsMax: deaths[n - 1],
        deathsInRange: r.every((x) => x.deaths >= 1e6 && x.deaths <= 3e6),
        ownersUnchanged: r.every((x) => x.ownersChanged === 0),
        speedRatioMin: Math.min(...ratios),
        speedRatioMax: Math.max(...ratios),
        twiceAsFast: ratios.every((x) => x >= 1.8 && x <= 2.2),
      };
    }
    case "exile": {
      const r = results as Awaited<ReturnType<typeof exile>>[];
      const lived24 = r.filter(
        (x) => x.dissolvedAfter === null || x.dissolvedAfter >= 24,
      ).length;
      return {
        exiled: r.filter((x) => x.opened === "exiled").length,
        livedAtLeast24Months: lived24,
        share: lived24 / n,
        criterion: lived24 / n >= 0.7,
      };
    }
    case "exile-cut": {
      const r = results as Awaited<ReturnType<typeof exile>>[];
      const inWindow = r.filter(
        (x) =>
          x.dissolvedAfter !== null &&
          x.dissolvedAfter >= 12 &&
          x.dissolvedAfter <= 36,
      ).length;
      return {
        dissolved: r.filter((x) => x.dissolvedAfter !== null).length,
        within12to36Months: inWindow,
        share: inWindow / n,
        criterion: inWindow / n >= 0.8,
        months: r.map((x) => x.dissolvedAfter),
      };
    }
    case "liberation": {
      const r = results as Awaited<ReturnType<typeof liberation>>[];
      return {
        // The land France holds at the peace (what Russia did not take back
        // within the day) goes back to Ukraine, which leaves its exile.
        returnedAll: r.every(
          (x) => x.returned === x.heldAtPeace && x.heldAtPeace > 0,
        ),
        heldAtPeaceMin: Math.min(...r.map((x) => x.heldAtPeace)),
        backFromExile: r.filter((x) => x.status === "active").length,
        criterion: r.every(
          (x) =>
            x.returned === x.heldAtPeace &&
            x.heldAtPeace > 0 &&
            x.status === "active",
        ),
      };
    }
    case "last-stand": {
      const r = results as Awaited<ReturnType<typeof lastStand>>[];
      return {
        dissolved: r.filter((x) => x.dissolvedAfterDays !== null).length,
        criterion: r.every(
          (x) =>
            x.playerAfterLoad === "MDA" &&
            x.journalIntact &&
            x.lastStands.length === 1,
        ),
      };
    }
  }
  return {};
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const test = option(args, "test", "bomb");
  const seeds = Number(option(args, "seeds", "20"));
  const seed0 = Number(option(args, "seed", "1"));
  const years = Number(option(args, "years", test === "bomb" ? "3" : "3"));
  const parallel = Number(option(args, "parallel", "1"));
  const out = option(args, "out", "");
  const list =
    option(args, "list", "") !== ""
      ? option(args, "list", "").split(",").map(Number)
      : Array.from({ length: seeds }, (_, i) => seed0 + i);
  const child = args.includes("--child");
  let results: Result[] = [];
  if (parallel > 1 && !child) {
    results = await inChildren<Result>(
      ["--test", test, "--years", String(years)],
      list,
      parallel,
    );
  } else {
    for (const seed of list) {
      const r = await runOne(test, seed, years);
      results.push(r);
      process.stdout.write(`${JSON.stringify(r)}\n`);
    }
  }
  if (child) return;
  const summary = { test, seeds: list, years, ...summarize(test, results) };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (out !== "") {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(
      path.join(out, `${test}.json`),
      `${JSON.stringify({ ...summary, results }, null, 2)}\n`,
    );
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
