import fs from "fs";
import path from "path";
import { simDataFrom } from "../../adapters/scenarioPackFrom";
import { bordersTileCounts } from "../../data/bordersFile";
import { dataSource } from "../../data/catalog";
import {
  SAVE_SCHEMA_VERSION,
  TILE_CONTESTED_BIT,
  TILE_NATION_MASK,
} from "../../data/schemas/save";
import { CONTEST_CEDED_BIT, monthIndex } from "../../sim/war/contest";
import { decodeSave, encodeSave, peekSchemaVersion } from "../serialize";
import { MigrationContext } from "./index";

// A REAL J4 save: europe-10 on the Europe map, France played, saved on
// 2027-05-06 by the J4 build (schemaVersion 4), at war with Spain, Spanish
// land taken and tagged contested.
const FIXTURE = new Uint8Array(
  fs.readFileSync(path.join(__dirname, "../fixtures/j4-europe-10.vsave")),
);

async function context(withBorders: boolean): Promise<MigrationContext> {
  const scenario = dataSource.scenario("europe-10");
  return {
    config: dataSource.config(),
    nationData: (id) => dataSource.nation(id),
    scenario,
    data: simDataFrom(dataSource, scenario),
    initialTiles: withBorders
      ? bordersTileCounts(await dataSource.borders(scenario))
      : undefined,
  };
}

describe("migration v4 -> v5 on a real J4 save", () => {
  it("the fixture really is a version 4 file", () => {
    expect(peekSchemaVersion(FIXTURE)).toBe(4);
  });

  it("dates the contested tiles from the month of the save, keeps the rest, and takes the first-day territory from the borders", async () => {
    const ctx = await context(true);
    const save = decodeSave(FIXTURE, { context: ctx });
    expect(save.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(save.calendar.date).toBe("2027-05-06");
    expect(save.contest.length).toBe(save.tiles.length);

    // Every tile tagged contested in the v4 has a contest, of the month of
    // the save, not ceded; no other tile has one.
    const month = monthIndex(save.calendar.startDate, save.calendar.date) + 1;
    let contested = 0;
    let wrong = 0;
    for (let tile = 0; tile < save.tiles.length; tile++) {
      const tagged =
        (save.tiles[tile] & TILE_NATION_MASK) !== 0 &&
        (save.tiles[tile] & TILE_CONTESTED_BIT) !== 0;
      if (tagged) contested++;
      const expected = tagged ? month : 0;
      if (save.contest[tile] !== expected) wrong++;
      if ((save.contest[tile] & CONTEST_CEDED_BIT) !== 0) wrong++;
    }
    expect(contested).toBeGreaterThan(0);
    expect(wrong).toBe(0);

    // The territory of the first day comes from the scenario borders.
    expect(save.territory.initialTiles).toEqual(ctx.initialTiles);
    // France holds more than it started with, Spain less.
    const counts = new Map<number, number>();
    for (const value of save.tiles) {
      const owner = value & TILE_NATION_MASK;
      counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    const index = (id: string) => save.nations.findIndex((n) => n.id === id);
    expect(counts.get(index("FRA") + 1)!).toBeGreaterThan(
      save.territory.initialTiles.FRA,
    );
    expect(counts.get(index("ESP") + 1)!).toBeLessThan(
      save.territory.initialTiles.ESP,
    );

    // The blocs of the data, the leader of the month (the EU presidency of
    // the first half of 2027 among the simulated members is Poland's), the
    // wars of the v4 already handled (no collective defence after the fact).
    expect(save.blocs.blocs.length).toBe(12);
    expect(save.blocs.leaders.eu).toBe("POL");
    expect(save.blocs.proposals).toEqual([]);
    expect(save.blocs.handledWars).toEqual(
      save.diplomacy.wars.map((w) => w.id),
    );
    expect(
      save.blocs.blocs
        .find((b) => b.id === "eu")!
        .members.find((m) => m.nation === "UKR")?.status,
    ).toBe("candidate");

    // Technology: what each nation had on the first day, nothing under
    // research; events: none yet, no grievance.
    expect(save.tech.nations.GBR.done.length).toBeGreaterThan(
      save.tech.nations.UKR.done.length,
    );
    expect(save.tech.nations.FRA.baseline).toEqual(save.tech.nations.FRA.done);
    expect(save.tech.nations.FRA.projects).toEqual([]);
    expect(save.events.pending).toEqual([]);
    expect(save.diplomacy.grievances).toEqual([]);

    // The migrated save writes and reads back as a v5, identical.
    const bytes = encodeSave(save);
    expect(peekSchemaVersion(bytes)).toBe(SAVE_SCHEMA_VERSION);
    const again = decodeSave(bytes, { context: ctx });
    expect(Buffer.from(encodeSave(again)).equals(Buffer.from(bytes))).toBe(
      true,
    );
  }, 120_000);

  it("without the borders, the first-day territory is the one of the save", async () => {
    const save = decodeSave(FIXTURE, { context: await context(false) });
    const index = save.nations.findIndex((n) => n.id === "FRA") + 1;
    let france = 0;
    for (const value of save.tiles) {
      if ((value & TILE_NATION_MASK) === index) france++;
    }
    expect(save.territory.initialTiles.FRA).toBe(france);
  });
});
