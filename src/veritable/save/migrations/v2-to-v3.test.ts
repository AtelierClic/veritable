import fs from "fs";
import path from "path";
import { simDataFrom } from "../../adapters/scenarioPackFrom";
import { dataSource } from "../../data/catalog";
import { SAVE_SCHEMA_VERSION } from "../../data/schemas/save";
import { decodeSave, encodeSave, peekSchemaVersion } from "../serialize";
import { MigrationContext } from "./index";

// A REAL J2 save: europe-10 on the Europe map, Germany played, saved on
// 2026-03-10 at speed x2 by the J2 build (schemaVersion 2), with VAT raised
// to 30 % and an embargo on Russian gas.
const FIXTURE = new Uint8Array(
  fs.readFileSync(path.join(__dirname, "../fixtures/j2-europe-10.vsave")),
);

function context(): MigrationContext {
  const scenario = dataSource.scenario("europe-10");
  return {
    config: dataSource.config(),
    nationData: (id) => dataSource.nation(id),
    scenario,
    data: simDataFrom(dataSource, scenario),
  };
}

describe("migration v2 -> v3 on a real J2 save", () => {
  it("the fixture really is a version 2 file", () => {
    expect(peekSchemaVersion(FIXTURE)).toBe(2);
  });

  it("keeps the campaign and its economy, adds what the v3 tracks", () => {
    const save = decodeSave(FIXTURE, { context: context() });
    expect(save.schemaVersion).toBe(SAVE_SCHEMA_VERSION);

    // Untouched: calendar, nations, tiles, core world, the economy as played.
    expect(save.calendar.date).toBe("2026-03-10");
    expect(save.calendar.speed).toBe(2);
    expect(
      save.nations.map((n) => [n.id, n.status, n.isPlayer]),
    ).toContainEqual(["DEU", "active", true]);
    expect(save.tiles.length).toBe(2904 * 1672);
    const germany = save.economy.nations.DEU;
    expect(germany.taxes.vat).toBe(0.3);
    expect(germany.balances.length).toBeGreaterThan(0);
    expect(save.economy.market.embargoes).toEqual([
      { from: "RUS", to: "DEU", good: "gas" },
    ]);

    // Added by the v3: export value and its reference share, import prices,
    // the capacity the rest of the world delivers, the bloc rule counters.
    expect(germany.exportsValue).toBeGreaterThan(0);
    expect(germany.exportShareReference).toBeCloseTo(
      germany.exportsValue / germany.gdp,
      12,
    );
    expect(save.economy.market.importPrices).toEqual(
      save.economy.market.prices,
    );
    expect(save.economy.market.rowEffectiveProduction).toEqual(
      save.economy.market.rowProduction,
    );
    expect(save.politics.nations.DEU.deficitBreachMonths).toBe(0);
    // Germany was reprimanded under the J2 rule (debt above 60 %): the malus
    // in force is kept, the revised rule re-evaluates it next month.
    expect(save.politics.nations.DEU.reprimanded).toBe(true);
    expect(save.politics.nations.DEU.reprimandMalus).toBe(0.03);
    expect(save.politics.nations.NOR.reprimandMalus).toBe(0);

    // Diplomacy and military, from the sheets and the scenario.
    expect(save.diplomacy.wars.map((w) => w.id)).toEqual(["rus-ukr-2022"]);
    expect(save.diplomacy.relations.RUS.UKR).toBe(-100);
    expect(save.diplomacy.relations.DEU.FRA).toBe(60);
    expect(save.military.nations.FRA.divisions.length).toBeGreaterThan(5);
    expect(save.military.nations.UKR.conscription).toBe("total");
    expect(save.military.nations.DEU.exhaustion).toBe(0);
  });

  it("is deterministic, and the migrated save round-trips in the current version", () => {
    const a = encodeSave(decodeSave(FIXTURE, { context: context() }));
    const b = encodeSave(decodeSave(FIXTURE, { context: context() }));
    expect(a).toEqual(b);
    expect(peekSchemaVersion(a)).toBe(SAVE_SCHEMA_VERSION);
    expect(encodeSave(decodeSave(a))).toEqual(a);
  });

  it("fails clearly without the campaign data", () => {
    expect(() => decodeSave(FIXTURE)).toThrow(/needs the campaign data/);
  });
});
