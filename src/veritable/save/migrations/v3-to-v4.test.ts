import fs from "fs";
import path from "path";
import { dataSource } from "../../data/catalog";
import { SAVE_SCHEMA_VERSION } from "../../data/schemas/save";
import { decodeSave, encodeSave, peekSchemaVersion } from "../serialize";
import { MigrationContext } from "./index";

// A REAL J3 save: europe-10 on the Europe map, France played, saved on
// 2027-04-11 by the J3 build (schemaVersion 3), one hundred days into a war
// of aggression against Spain (ten armoured divisions on the front, three
// nations sanctioning France, Spanish land taken and tagged contested).
const FIXTURE = new Uint8Array(
  fs.readFileSync(path.join(__dirname, "../fixtures/j3-europe-10.vsave")),
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

describe("migration v3 -> v4 on a real J3 save", () => {
  it("the fixture really is a version 3 file", () => {
    expect(peekSchemaVersion(FIXTURE)).toBe(3);
  });

  it("keeps the campaign, its war and its economy, adds what the v4 tracks", () => {
    const save = decodeSave(FIXTURE, { context: context() });
    expect(save.schemaVersion).toBe(SAVE_SCHEMA_VERSION);

    // Untouched: calendar, nations, tiles, the war as played.
    expect(save.calendar.date).toBe("2027-04-11");
    expect(
      save.nations.map((n) => [n.id, n.status, n.isPlayer]),
    ).toContainEqual(["FRA", "active", true]);
    expect(save.tiles.length).toBe(2904 * 1672);
    const war = save.diplomacy.wars.find((w) => w.id === "war-1")!;
    // Ukraine had joined the coalition against France by then.
    expect(war).toMatchObject({
      aggressors: ["FRA"],
      defenders: ["ESP", "UKR"],
      casusBelli: null,
      declaredInCampaign: true,
    });
    expect(war.tilesTaken.FRA).toBeGreaterThan(0);
    // Ukraine sanctions Russia (scenario war), Spain and Ukraine France.
    expect(save.diplomacy.sanctions.length).toBe(3);
    expect(
      save.diplomacy.sanctions.filter((s) => s.against === "FRA").length,
    ).toBe(2);
    expect(
      save.military.nations.FRA.divisions.filter((d) => d.front !== null)
        .length,
    ).toBeGreaterThan(10);
    expect(save.military.nations.FRA.conscription).toBe("partial");
    expect(save.economy.market.embargoes.length).toBeGreaterThan(0);

    // Changed by the v4: the circumvention index is kept per good, the v3
    // scalar given to every good.
    const france = save.economy.nations.FRA;
    expect(Object.keys(france.circumvention).sort()).toEqual(
      dataSource
        .goods()
        .map((g) => g.id)
        .sort(),
    );
    const values = new Set(Object.values(france.circumvention));
    expect(values.size).toBe(1);
    expect([...values][0]).toBeGreaterThan(0); // France was embargoed
    expect(
      new Set(Object.values(save.economy.nations.NOR.circumvention)),
    ).toEqual(new Set([0]));
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
