import fs from "fs";
import path from "path";
import { loadScenarioPackFrom } from "../../../src/veritable/adapters/scenarioPackFrom";
import { ScenarioPack } from "../../../src/veritable/adapters/scenarioWorld";
import { createDataSource } from "../../../src/veritable/data/DataSource";
import { fsDataFiles } from "../../../src/veritable/data/files.fs";
import { VeritableConfig } from "../../../src/veritable/data/schemas/config";
import {
  CampaignResult,
  parseScript,
  runCampaign,
  ScriptEntry,
} from "./campaign";
import { coreDriver } from "./coreDriver";

// Delivery tests 2, 3 and 4 of the J3: the campaign on the OpenFront core, on
// the real Europe map, with the scripted commands of tools/veritable/headless/
// scripts/. Slow (a game year takes a few seconds): one campaign each.

const source = createDataSource(fsDataFiles());
let pack: ScenarioPack;
let config: VeritableConfig;

beforeAll(async () => {
  pack = await loadScenarioPackFrom(source, "europe-10");
  config = structuredClone(source.config());
  config.economy.growth.noiseMonthlySd = 0;
  config.economy.rowSupplyNoise.monthlySd = 0;
});

function script(name: string): ScriptEntry[] {
  return parseScript(
    JSON.parse(
      fs.readFileSync(path.join(__dirname, "scripts", `${name}.json`), "utf8"),
    ),
  );
}

async function play(
  player: string,
  years: number,
  entries?: ScriptEntry[],
): Promise<CampaignResult> {
  return runCampaign({
    pack,
    config,
    seed: 42,
    years,
    player,
    script: entries,
    driver: await coreDriver(pack, config, 42, player, false),
  });
}

const at = (r: CampaignResult, date: string) =>
  r.series.find((row) => row.date === date)!;

describe("delivery test 2: a war without casus belli does not pay", () => {
  it("France attacks Spain with ten armoured divisions: sanctioned by five nations within six months, and at three years its GDP loss exceeds the value of the tiles it holds", async () => {
    const control = await play("FRA", 3);
    const war = await play("FRA", 3, script("war-fra-esp"));
    expect(war.wars[0]).toMatch(/^FRA>ESP@2027-01/);
    // Sanctions within six months.
    expect(at(war, "2027-07-01").sanctionsAgainst.FRA).toBeGreaterThanOrEqual(
      5,
    );
    // A coalition formed against the aggressor.
    expect(war.wars.length).toBeGreaterThan(1);
    // The Spanish line moved: France holds Spanish land, tagged contested.
    const start = at(war, "2027-01-01");
    const end = war.series[war.series.length - 1];
    expect(end.tiles.ESP).toBeLessThan(start.tiles.ESP);
    // Value of the tiles France holds at three years, at the Spanish GDP per
    // tile of the first day, against the GDP France lost to the war.
    const netTiles = end.tiles.FRA - start.tiles.FRA;
    const tileValue = (start.gdp.ESP / start.tiles.ESP) * Math.max(0, netTiles);
    const gdpLoss =
      control.series[control.series.length - 1].gdp.FRA - end.gdp.FRA;
    expect(gdpLoss).toBeGreaterThan(tileValue);
    expect(gdpLoss).toBeGreaterThan(0.05 * end.gdp.FRA);
    // Its people paid too: exhaustion up, and a stability that does not
    // recover while the sanctions last (J3 correction 5).
    expect(end.exhaustion.FRA).toBeGreaterThan(0.2);
    expect(end.stability.FRA).toBeLessThanOrEqual(
      control.series[control.series.length - 1].stability.FRA - 0.08,
    );
  }, 600_000);
});

describe("delivery test 3: a blockade reads in the trade of the blockaded", () => {
  it("the United Kingdom blockades Norway: Norwegian maritime flows fall by at least 40 %", async () => {
    const control = await play("GBR", 2);
    const blockade = await play("GBR", 2, script("blockade-gbr-nor"));
    const before = at(blockade, "2027-01-01");
    expect(before.blockade.NOR).toBe(0);
    const later = at(blockade, "2027-07-01");
    expect(later.blockade.NOR).toBeGreaterThanOrEqual(0.35);
    expect(later.maritimeTrade.NOR).toBeLessThan(
      at(control, "2027-07-01").maritimeTrade.NOR * 0.6,
    );
    // Norway lacks what it imported by sea; its gas still sells by pipeline
    // to its land neighbour only.
    expect(later.shortage.NOR).toBeGreaterThan(
      at(control, "2027-07-01").shortage.NOR,
    );
  }, 600_000);
});

describe("delivery test 4: no landing without the sea", () => {
  it("Italy, without control of the western Mediterranean, is refused a landing in Spain", async () => {
    const run = await play("ITA", 1, script("landing-ita-esp"));
    expect(run.wars).toEqual(["ITA>ESP@2026-07-01"]);
    expect(run.events["landing-refused"]).toBe(1);
    expect(run.events.landing).toBeUndefined();
    expect(at(run, "2026-08-01").tiles.ITA).toBe(
      at(run, "2026-07-01").tiles.ITA,
    );
  }, 600_000);
});
