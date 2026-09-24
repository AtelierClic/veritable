import fs from "fs";
import path from "path";
import { simDataFrom } from "../../adapters/scenarioPackFrom";
import { bordersTileCounts } from "../../data/bordersFile";
import { dataSource } from "../../data/catalog";
import { SAVE_SCHEMA_VERSION, TILE_SETTLED_BIT } from "../../data/schemas/save";
import { decodeSave, encodeSave, peekSchemaVersion } from "../serialize";
import { MigrationContext } from "./index";
import { J5_INDEX_POINT_MUSD } from "./v5-to-v6";

// A REAL J5 save: europe-10 on the Europe map, France played, saved on
// 2027-04-16 by the J5 build (schemaVersion 5): France at war with Spain
// since January 2027 (no casus belli), the war of the scenario between
// Russia and Ukraine, three research projects, the EU budget raised by a
// vote, an event pending, a grievance, contested tiles.
const FIXTURE = new Uint8Array(
  fs.readFileSync(path.join(__dirname, "../fixtures/j5-europe-10.vsave")),
);

async function context(): Promise<MigrationContext> {
  const scenario = dataSource.scenario("europe-10");
  return {
    config: dataSource.config(),
    nationData: (id) => dataSource.nation(id),
    scenario,
    data: simDataFrom(dataSource, scenario),
    initialTiles: bordersTileCounts(await dataSource.borders(scenario)),
  };
}

describe("migration v5 -> v6 on a real J5 save", () => {
  it("the fixture really is a version 5 file", () => {
    expect(peekSchemaVersion(FIXTURE)).toBe(5);
  });

  it("adds the claims, the losses and claims of each war and an empty war memory, and keeps the rest", async () => {
    const ctx = await context();
    const save = decodeSave(FIXTURE, { context: ctx });
    expect(save.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(save.calendar.date).toBe("2027-04-16");

    // The claims of the scenario, at full weight.
    const claims = save.diplomacy.claims
      .map((c) => `${c.claimant}:${c.region}:${c.weight}:${c.failures}`)
      .sort();
    expect(claims).toEqual([
      "RUS:ukraine-oblasts-claimed-by-russia:1:0",
      "UKR:crimea:1:0",
      "UKR:ukraine-occupied-mainland:1:0",
    ]);
    expect(save.diplomacy.warMemory).toEqual({});
    expect("contestedRegions" in save.diplomacy).toBe(false);

    // The war of the scenario is fought on the Russian claim; the French
    // war without casus belli on none. Losses count from the save on.
    const byId = new Map(save.diplomacy.wars.map((w) => [w.id, w]));
    expect(byId.get("rus-ukr-2022")!.claims).toEqual([
      "ukraine-oblasts-claimed-by-russia",
    ]);
    expect(byId.get("rus-ukr-2022")!.losses).toEqual({ RUS: 0, UKR: 0 });
    expect(byId.get("war-1")!.claims).toEqual([]);
    expect(byId.get("war-1")!.aggressors).toEqual(["FRA"]);

    // No treaty was ever signed in this campaign: nothing is settled.
    expect(save.tiles.some((v) => (v & TILE_SETTLED_BIT) !== 0)).toBe(false);

    // The goods measured as an index are now in bn US$: same value.
    const raw = decodeSave(FIXTURE, {
      context: ctx,
      targetVersion: 5,
    }) as unknown as {
      economy: {
        market: { prices: Record<string, number> };
        nations: Record<string, { production: Record<string, number> }>;
      };
    };
    for (const good of ["arms", "services", "steel"]) {
      const point = J5_INDEX_POINT_MUSD[good];
      const before =
        raw.economy.nations.FRA.production[good] *
        raw.economy.market.prices[good];
      const after =
        save.economy.nations.FRA.production[good] *
        save.economy.market.prices[good];
      expect(after).toBeCloseTo(before, 6);
      expect(save.economy.nations.FRA.production[good]).toBeCloseTo(
        (raw.economy.nations.FRA.production[good] * point) / 1000,
        9,
      );
    }
    expect(save.economy.market.prices.oil).toBe(raw.economy.market.prices.oil);

    // The rest of the v5 is untouched: research, bloc budget, events.
    expect(save.tech.nations.FRA.done.length).toBe(31);
    expect(save.blocs.blocs.find((b) => b.id === "eu")!.budgetScale).toBe(1.2);
    expect(save.events.pending.map((p) => p.event)).toEqual([
      "fertilizer-price-shock",
    ]);
    expect(save.diplomacy.grievances.length).toBe(1);

    // The migrated save writes and reads back as a v6, identical.
    const bytes = encodeSave(save);
    expect(peekSchemaVersion(bytes)).toBe(SAVE_SCHEMA_VERSION);
    const again = decodeSave(bytes, { context: ctx });
    expect(Buffer.from(encodeSave(again)).equals(Buffer.from(bytes))).toBe(
      true,
    );
  }, 120_000);
});
