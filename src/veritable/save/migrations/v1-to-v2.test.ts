import fs from "fs";
import path from "path";
import { dataSource } from "../../data/catalog";
import { GOOD_IDS } from "../../data/schemas/goods";
import { decodeSave, encodeSave, peekSchemaVersion } from "../serialize";
import { MigrationContext } from "./index";

// A REAL J1 save: europe-10 on the Europe map, Poland played, saved on
// 2026-03-15 at speed x2 by the J1 build (schemaVersion 1).
const FIXTURE = new Uint8Array(
  fs.readFileSync(path.join(__dirname, "../fixtures/j1-europe-10.vsave")),
);

function context(): MigrationContext {
  const scenario = dataSource.scenario("europe-10");
  const meta = dataSource.bordersMeta(scenario);
  return {
    config: dataSource.config(),
    nationData: (id) => dataSource.nation(id),
    scenario,
    data: {
      goods: dataSource.goods(),
      row: dataSource.row(),
      blocs: dataSource.blocs(),
      divisions: dataSource.divisions(),
      casusBelli: dataSource.casusBelli(),
      seas: dataSource.seas(scenario.map).zones,
      geography: {
        landNeighbours: meta.landNeighbours,
        bordersNeutralLand: meta.bordersNeutralLand,
      },
    },
  };
}

describe("migration v1 -> v2 on a real J1 save", () => {
  it("the fixture really is a version 1 file", () => {
    expect(peekSchemaVersion(FIXTURE)).toBe(1);
  });

  it("keeps the campaign and adds the economy and the politics", () => {
    // Migrated all the way to the current version (v1 -> v2 -> v3).
    const save = decodeSave(FIXTURE, { context: context() });
    expect(save.schemaVersion).toBe(3);

    // Untouched: calendar, nations, tiles, core world, Rng.
    expect(save.calendar).toEqual({
      startDate: "2026-01-01",
      elapsedGameMinutes: save.calendar.elapsedGameMinutes,
      date: "2026-03-15",
      speed: 2,
    });
    expect(
      save.nations.map((n) => [n.id, n.status, n.isPlayer]),
    ).toContainEqual(["POL", "active", true]);
    expect(save.nations).toHaveLength(10);
    expect(save.tiles.length).toBe(2904 * 1672);
    expect(save.world.players).toHaveLength(10);
    expect(save.journal[0].kind).toBe("campaign-started");

    // Added: the economy of the ten nations, from their sheets.
    expect(Object.keys(save.economy.nations)).toEqual(
      save.nations.map((n) => n.id),
    );
    const poland = save.economy.nations.POL;
    expect(poland.gdp).toBe(dataSource.nation("POL").gdp.value);
    expect(Object.keys(poland.production)).toEqual([...GOOD_IDS]);
    expect(save.economy.market.prices.gas).toBe(
      dataSource.goods().find((g) => g.id === "gas")!.basePrice,
    );
    // Politics: eight groups for the player's nation only.
    expect(Object.keys(save.politics.nations.POL.groups!)).toHaveLength(8);
    expect(save.politics.nations.FRA.groups).toBeNull();
    expect(save.politics.autopilot).toBe(false);
    // v3 fields, built by the current initialisation.
    expect(poland.exportsValue).toBeGreaterThan(0);
    expect(poland.exportShareReference).toBeCloseTo(
      poland.exportsValue / poland.gdp,
      12,
    );
    expect(save.economy.market.importPrices).toEqual(
      save.economy.market.prices,
    );
    expect(save.politics.nations.POL.reprimandMalus).toBe(0);
  });

  it("is deterministic, and the migrated save round-trips in the current version", () => {
    const a = encodeSave(decodeSave(FIXTURE, { context: context() }));
    const b = encodeSave(decodeSave(FIXTURE, { context: context() }));
    expect(a).toEqual(b);
    expect(peekSchemaVersion(a)).toBe(3);
    expect(encodeSave(decodeSave(a))).toEqual(a);
  });

  it("fails clearly without the campaign data", () => {
    expect(() => decodeSave(FIXTURE)).toThrow(/needs the campaign data/);
  });
});
