import fs from "fs";
import path from "path";
import { loadScenarioPackFrom } from "../../../src/veritable/adapters/scenarioPackFrom";
import { createDataSource } from "../../../src/veritable/data/DataSource";
import { fsDataFiles } from "../../../src/veritable/data/files.fs";
import {
  DiplomacyState,
  NationState,
  PeaceOffer,
  War,
} from "../../../src/veritable/data/schemas/save";
import {
  relation,
  setRelation,
} from "../../../src/veritable/sim/diplomacy/diplomacy";
import { proposePeace } from "../../../src/veritable/sim/war/peace";
import { coreDriver } from "./coreDriver";

// The saves of the J7 test guide (J7c), on the world map, loaded in the
// game by « Importer un fichier » of the campaign panel:
//   j7-guerre-nucleaire.vsave  France at war with Russia (declared the
//                              second day of 2026): the nuclear strike.
//   j7-exil.vsave              Ukraine played, annexed by Russia by treaty on
//                              the second day: its government in exile.
//   j7-baroud.vsave            the same Ukraine, its support cut until its
//                              dissolution: the last stand.
//   npx tsx tools/veritable/headless/prepareJ7Saves.ts --out <folder>

interface Internals {
  diplomacy: DiplomacyState;
  nations: NationState[];
  sign(war: War, offer: PeaceOffer, date: string): void;
}

function option(args: string[], name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}

async function driverFor(seed: number, player: string) {
  const source = createDataSource(fsDataFiles());
  const pack = await loadScenarioPackFrom(source, "world-2026");
  const driver = await coreDriver(pack, source.config(), seed, player, false);
  return { driver, sim: driver.sim as Internals };
}

function annexUkraine(sim: Internals, date: string): void {
  const war = sim.diplomacy.wars.find(
    (w) =>
      (w.aggressors.includes("RUS") && w.defenders.includes("UKR")) ||
      (w.aggressors.includes("UKR") && w.defenders.includes("RUS")),
  )!;
  const offer = proposePeace(
    sim.diplomacy,
    war,
    "RUS",
    "UKR",
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const out = path.resolve(option(args, "out", "."));
  const seed = Number(option(args, "seed", "7"));
  fs.mkdirSync(out, { recursive: true });

  // 1. France at war with Russia.
  {
    const { driver } = await driverFor(seed, "FRA");
    driver.advanceDay();
    driver.apply({ type: "declare-war", target: "RUS", casusBelli: "none" });
    driver.advanceDay();
    fs.writeFileSync(
      path.join(out, "j7-guerre-nucleaire.vsave"),
      driver.snapshot(),
    );
    process.stdout.write(`j7-guerre-nucleaire ${driver.read().date}\n`);
  }

  // 2. Ukraine in exile.
  {
    const { driver, sim } = await driverFor(seed, "UKR");
    driver.advanceDay();
    annexUkraine(sim, driver.read().date);
    driver.advanceDay();
    fs.writeFileSync(path.join(out, "j7-exil.vsave"), driver.snapshot());
    process.stdout.write(
      `j7-exil ${driver.read().date} ${
        sim.nations.find((n) => n.id === "UKR")?.status
      }\n`,
    );
  }

  // 3. Ukraine dissolved: the last stand.
  {
    const { driver, sim } = await driverFor(seed, "UKR");
    driver.advanceDay();
    annexUkraine(sim, driver.read().date);
    const status = () => sim.nations.find((n) => n.id === "UKR")?.status;
    for (let day = 0; day < 5 * 366 && status() !== "dissolved"; day++) {
      for (const n of sim.nations) {
        if (n.id !== "UKR" && relation(sim.diplomacy, n.id, "UKR") >= 40) {
          setRelation(sim.diplomacy, n.id, "UKR", 39);
        }
      }
      driver.advanceDay();
    }
    fs.writeFileSync(path.join(out, "j7-baroud.vsave"), driver.snapshot());
    process.stdout.write(`j7-baroud ${driver.read().date} ${status()}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
