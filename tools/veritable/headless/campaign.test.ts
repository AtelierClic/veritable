import { BordersWorld } from "../../../src/veritable/adapters/BordersWorld";
import { loadScenarioPackFrom } from "../../../src/veritable/adapters/scenarioPackFrom";
import { ScenarioPack } from "../../../src/veritable/adapters/scenarioWorld";
import { createDataSource } from "../../../src/veritable/data/DataSource";
import { fsDataFiles } from "../../../src/veritable/data/files.fs";
import { VeritableConfig } from "../../../src/veritable/data/schemas/config";
import { GOOD_IDS } from "../../../src/veritable/data/schemas/goods";
import { decodeSave, encodeSave } from "../../../src/veritable/save/serialize";
import { VeritableSimImpl } from "../../../src/veritable/sim/VeritableSimImpl";
import { parseShock, runCampaign, seriesCsv } from "./campaign";

// The integration test of the J2: europe-10 with its real data, read from disk
// like the runner does (fs DataSource), simulation alone.

const source = createDataSource(fsDataFiles());
let pack: ScenarioPack;
let config: VeritableConfig;

beforeAll(async () => {
  pack = await loadScenarioPackFrom(source, "europe-10");
  config = source.config();
});

function quiet(): VeritableConfig {
  const c = structuredClone(config);
  c.economy.growth.noiseMonthlySd = 0;
  c.economy.rowSupplyNoise.monthlySd = 0;
  return c;
}

describe("fifty years headless", () => {
  it("prices never reach their bounds and do not keep oscillating", () => {
    const result = runCampaign({ pack, config: quiet(), seed: 1, years: 50 });
    const { priceFloor, priceCeiling } = config.economy;
    for (const good of GOOD_IDS) {
      const [low, high] = result.final.priceRange[good];
      expect(low, good).toBeGreaterThan(priceFloor * 1.5);
      expect(high, good).toBeLessThan(priceCeiling / 1.5);

      // No sustained oscillation: over the last twenty years, the monthly
      // change of a price hardly ever flips sign with any amplitude.
      const series = result.series.slice(-240).map((row) => row.prices[good]);
      let flips = 0;
      for (let i = 2; i < series.length; i++) {
        const a = series[i - 1] - series[i - 2];
        const b = series[i] - series[i - 1];
        if (a * b < 0 && Math.min(Math.abs(a), Math.abs(b)) > 0.002) flips++;
      }
      expect(flips, `${good} oscillates`).toBeLessThan(6);
    }
  }, 120_000);

  it("with its random shocks too, on three seeds; debt does not diverge", () => {
    for (const seed of [42, 43, 44]) {
      const result = runCampaign({ pack, config, seed, years: 50 });
      for (const good of GOOD_IDS) {
        const [low, high] = result.final.priceRange[good];
        expect(low, `${good} seed ${seed}`).toBeGreaterThan(0.5);
        expect(high, `${good} seed ${seed}`).toBeLessThan(2);
      }
      // Since the J4 a nation can fall to a junta (legitimacy 0.4, unrest,
      // suspension by the EU): its interest rate climbs and, over decades,
      // it may default. A default is only tolerated there; a stable state
      // never defaults and its debt does not diverge.
      const shaken = new Set(
        Object.entries(result.politics)
          .filter(([, p]) => p.coups > 0 || p.revolutions > 0)
          .map(([id]) => id),
      );
      for (const entry of result.defaults) {
        expect(shaken.has(entry.split("@")[0]), `${entry} seed ${seed}`).toBe(
          true,
        );
      }
      for (const [nation, debt] of Object.entries(result.final.maxDebtToGdp)) {
        if (shaken.has(nation)) continue;
        expect(debt, `${nation} seed ${seed}`).toBeLessThan(
          config.budget.default.debtToGdp,
        );
      }
      // Debt/GDP ends close to where it started, or under the prudent mark
      // (Ukraine carries the war of the scenario and its Black Sea blockade).
      const first = result.series[0].debtToGdp;
      const prudent = config.ai.fiscal.prudentDebtToGdp;
      for (const [nation, debt] of Object.entries(result.final.debtToGdp)) {
        if (shaken.has(nation)) continue;
        expect(debt, `${nation} seed ${seed}`).toBeLessThan(
          Math.max(first[nation], prudent) + 0.2,
        );
      }
      expect(result.final.meanStability).toBeGreaterThan(0.5);
    }
  }, 180_000);

  it("seeds differ, the same seed repeats exactly", () => {
    const a = runCampaign({ pack, config, seed: 5, years: 3 });
    const b = runCampaign({ pack, config, seed: 5, years: 3 });
    const c = runCampaign({ pack, config, seed: 6, years: 3 });
    expect(b.final.prices).toEqual(a.final.prices);
    expect(b.final.debtToGdp).toEqual(a.final.debtToGdp);
    expect(c.final.prices).not.toEqual(a.final.prices);
  }, 60_000);
});

describe("cutting a gas supplier shows in the curves", () => {
  it("Russian gas cut in January 2028: price up, coverage down, growth lost", () => {
    const shock = parseShock("cut-gas-exports:RUS@2028-01");
    const control = runCampaign({ pack, config, seed: 42, years: 5 });
    const cut = runCampaign({ pack, config, seed: 42, years: 5, shock });
    const at = (date: string, r: typeof control) =>
      r.series.find((row) => row.date === date)!;

    // Identical until the cut.
    expect(at("2028-01-01", cut)).toEqual(at("2028-01-01", control));

    // Two months later: importers lack gas, the world price has moved.
    const soon = at("2028-03-01", cut);
    const soonControl = at("2028-03-01", control);
    expect(soon.gasCoverage.DEU).toBeLessThan(
      soonControl.gasCoverage.DEU - 0.2,
    );
    expect(soon.gasCoverage.ITA).toBeLessThan(
      soonControl.gasCoverage.ITA - 0.2,
    );
    expect(soon.shortage.DEU).toBeGreaterThan(soonControl.shortage.DEU + 0.02);
    expect(soon.prices.gas).toBeGreaterThan(soonControl.prices.gas * 1.01);
    expect(soon.stability.DEU).toBeLessThan(soonControl.stability.DEU - 0.02);
    // Norway sells the same gas dearer, and is not short of anything.
    expect(soon.gasCoverage.NOR).toBe(1);

    // Within the year the price has done its work: supply came back...
    const later = at("2029-01-01", cut);
    const laterControl = at("2029-01-01", control);
    expect(later.prices.gas).toBeGreaterThan(laterControl.prices.gas * 1.04);
    // Pipeline gas re-routes little (circumvention cap of the J3 close-out):
    // part of the Russian gas stays withheld, the world covers most of it.
    expect(later.gasCoverage.DEU).toBeGreaterThan(0.9);
    // ...but the growth lost is lost.
    expect(later.gdp.DEU).toBeLessThan(laterControl.gdp.DEU * 0.998);
    expect(cut.series[cut.series.length - 1].gdp.DEU).toBeLessThan(
      control.series[control.series.length - 1].gdp.DEU,
    );
  }, 60_000);

  // Delivery test 1 of the J3: the full EU members stop buying Russian gas
  // and oil in January 2027.
  it("EU embargo on Russian gas and oil: Russian GDP -3 % in two years, gas import price +25 % in the first year", () => {
    const shock = parseShock("eu-embargo:RUS@2027-01");
    const control = runCampaign({ pack, config, seed: 42, years: 4 });
    const cut = runCampaign({ pack, config, seed: 42, years: 4, shock });
    const at = (date: string, r: typeof control) =>
      r.series.find((row) => row.date === date)!;
    expect(at("2027-01-01", cut)).toEqual(at("2027-01-01", control));
    const year1 = cut.series.filter(
      (row) => row.date > "2027-01-01" && row.date <= "2028-01-01",
    );
    const peak = Math.max(...year1.map((row) => row.importPrices.gas));
    const before = at("2027-01-01", cut).importPrices.gas;
    expect(peak).toBeGreaterThan(before * 1.25);
    // The world price alone cannot move that much: the stranded volume is a
    // few percent of the world supply (DECISIONS.md, J3).
    expect(Math.max(...year1.map((row) => row.prices.gas))).toBeLessThan(
      before * 1.15,
    );
    expect(at("2029-01-01", cut).gdp.RUS).toBeLessThan(
      at("2029-01-01", control).gdp.RUS * 0.97,
    );
    // The importers suffered too, then adapted.
    expect(at("2027-03-01", cut).gasCoverage.DEU).toBeLessThan(0.8);
    expect(at("2030-01-01", cut).gasCoverage.DEU).toBeGreaterThan(0.95);
  }, 60_000);

  it("rejects an unknown shock", () => {
    expect(() => parseShock("cut-gas:RUS")).toThrow(/unknown shock/);
    expect(parseShock("cut-gas-exports:NOR@2030-06")).toEqual({
      kind: "cut-gas-exports",
      nation: "NOR",
      month: "2030-06",
    });
  });
});

describe("outputs", () => {
  it("one CSV row per game month, one column per series", () => {
    const result = runCampaign({ pack, config, seed: 1, years: 2 });
    const lines = seriesCsv(result).trim().split("\n");
    expect(lines).toHaveLength(1 + 25); // header + 2026-01 .. 2028-01
    const header = lines[0].split(",");
    expect(header).toContain("price_gas");
    expect(header).toContain("gdp_FRA");
    expect(header).toContain("debt_ITA");
    expect(header).toContain("stability_UKR");
    expect(header).toContain("gas_coverage_DEU");
    expect(lines[1].split(",")).toHaveLength(header.length);
    expect(Object.keys(result.cpuMsByDomain)).toContain("economy:day");
    expect(result.cpuMsByDomain["economy:month"].calls).toBe(24);
  }, 60_000);
});

describe("a campaign reloaded mid-way continues identically", () => {
  it("save at three years, reload in a fresh simulation, play two more: same bytes", () => {
    const make = () =>
      new VeritableSimImpl({
        config,
        world: new BordersWorld(pack.borders),
        data: pack.data,
        nationData: (id) => pack.nations.find((n) => n.id === id),
        autopilot: true,
      });
    const DAY = 1440;
    const original = make();
    original.init(pack.scenario, 99);
    for (let d = 0; d < 365 * 3 + 17; d++) original.advance(DAY);
    const bytes = encodeSave(original.snapshot());

    const reloaded = make();
    reloaded.restore(decodeSave(bytes));
    expect(encodeSave(reloaded.snapshot())).toEqual(bytes);

    for (let d = 0; d < 365 * 2; d++) {
      original.advance(DAY);
      reloaded.advance(DAY);
    }
    expect(encodeSave(reloaded.snapshot())).toEqual(
      encodeSave(original.snapshot()),
    );
  }, 120_000);
});
