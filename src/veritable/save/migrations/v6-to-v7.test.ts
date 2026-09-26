import fs from "fs";
import path from "path";
import { BordersWorld } from "../../adapters/BordersWorld";
import { loadScenarioPack } from "../../adapters/scenarioPack";
import { ScenarioPack } from "../../adapters/scenarioWorld";
import { bordersTileCounts } from "../../data/bordersFile";
import { dataSource } from "../../data/catalog";
import { SAVE_SCHEMA_VERSION } from "../../data/schemas/save";
import { populationFactor } from "../../sim/economy/population";
import { calendarMonth, MINUTES_PER_YEAR } from "../../sim/time";
import { VeritableSimImpl } from "../../sim/VeritableSimImpl";
import { decodeSave, encodeSave, peekSchemaVersion } from "../serialize";
import { MigrationContext } from "./index";

// A REAL J6 save: world-2026 on the world map, 208 nations, written on
// 2076-01-01 after fifty years on the OpenFront core by the final J6 code
// (perfWorld, seed 42): wars, claims given up, sanctions, a journal
// compacted by year, a 2 MB file.
const FIXTURE = new Uint8Array(
  fs.readFileSync(path.join(__dirname, "../fixtures/j6-world-2026-50y.vsave")),
);

const DAY = 24 * 60;
let pack: ScenarioPack;
let ctx: MigrationContext;

beforeAll(async () => {
  pack = await loadScenarioPack("world-2026");
  ctx = {
    config: dataSource.config(),
    nationData: (id) => dataSource.nation(id),
    scenario: pack.scenario,
    data: pack.data,
    initialTiles: bordersTileCounts(pack.borders),
  };
}, 120_000);

describe("migration v6 -> v7 on a real J6 save of the world at fifty years", () => {
  it("the fixture really is a version 6 file", () => {
    expect(peekSchemaVersion(FIXTURE)).toBe(6);
  });

  it("puts every nation in the rolling queue, grows the population, keeps the rest", () => {
    const raw = decodeSave(FIXTURE, { context: ctx, targetVersion: 6 });
    const save = decodeSave(FIXTURE, { context: ctx });
    expect(save.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(save.calendar.date).toBe("2076-01-01");
    const now = save.calendar.elapsedGameMinutes;
    const years = now / MINUTES_PER_YEAR;
    const month = calendarMonth(save.calendar.startDate, save.calendar.date);

    // The queue: every nation due within a week, none in the past.
    const ids = save.nations.map((n) => n.id);
    expect(ids.length).toBe(208);
    for (const id of ids) {
      const clock = save.schedule.nations[id];
      expect(clock, id).toBeDefined();
      expect(clock.last).toBe(now);
      expect(clock.next).toBeGreaterThan(now);
      expect(clock.next).toBeLessThanOrEqual(now + 7 * DAY);
    }

    for (const id of ids) {
      const e = save.economy.nations[id];
      const sheet = ctx.nationData(id)!;
      // The population of the sheet, grown on its trend over fifty years.
      expect(e.population, id).toBeCloseTo(
        sheet.population.value *
          populationFactor(ctx.config, sheet.populationGrowth?.value, 0, years),
        -1,
      );
      // The twelve monthly balances, the last one the save's month; the
      // debt of the save as the mark of the months of rising debt.
      expect(e.balances.length).toBeLessThanOrEqual(12);
      expect(e.balances[e.balances.length - 1].month).toBe(month);
      expect(e.monthMark).toBe(month);
      expect(e.debtMark).toBe(e.debt);
      // The trade of each good at the prices of the save.
      const prices = save.economy.market.prices;
      for (const good of Object.keys(e.exports)) {
        expect(e.exportValue[good]).toBeCloseTo(
          e.exports[good] * prices[good] * 1e6,
          -3,
        );
      }
    }
    // Growth over fifty years: the Nigerian population about doubles, the
    // Japanese one shrinks.
    expect(save.economy.nations.NGA.population).toBeGreaterThan(
      1.5 * ctx.nationData("NGA")!.population.value,
    );
    expect(save.economy.nations.JPN.population).toBeLessThan(
      ctx.nationData("JPN")!.population.value,
    );

    // A war closes its months on the 1st of the next month.
    for (const war of save.diplomacy.wars) {
      expect(war.ledgerOn).toBe("2076-02-01");
    }
    // The claims given up at the J6c sleep.
    const abandon = ctx.config.diplomacy.claims.abandonAfterFailures;
    for (const claim of save.diplomacy.claims) {
      expect(claim.dormant).toBe(claim.failures >= abandon);
    }

    // The rest of the v6 is untouched.
    const v6 = raw as unknown as {
      economy: { nations: Record<string, { gdp: number; debt: number }> };
      diplomacy: { sanctions: unknown[]; wars: unknown[] };
      journal: unknown[];
    };
    for (const id of ids) {
      expect(save.economy.nations[id].gdp).toBe(v6.economy.nations[id].gdp);
      expect(save.economy.nations[id].debt).toBe(v6.economy.nations[id].debt);
    }
    expect(save.diplomacy.sanctions.length).toBe(v6.diplomacy.sanctions.length);
    expect(save.diplomacy.wars.length).toBe(v6.diplomacy.wars.length);
    expect(save.journal.length).toBe(v6.journal.length);
    expect(save.tiles).toEqual(raw.tiles);

    // The migrated save writes and reads back as a v7, identical.
    const bytes = encodeSave(save);
    expect(peekSchemaVersion(bytes)).toBe(SAVE_SCHEMA_VERSION);
    const again = decodeSave(bytes, { context: ctx });
    expect(Buffer.from(encodeSave(again)).equals(Buffer.from(bytes))).toBe(
      true,
    );
  }, 180_000);

  it("the migrated campaign plays on: every nation updated within its first week", () => {
    const save = decodeSave(FIXTURE, { context: ctx });
    const sim = new VeritableSimImpl({
      config: ctx.config,
      world: new BordersWorld(
        pack.borders,
        pack.zones,
        undefined,
        pack.regions,
      ),
      data: pack.data,
      nationData: (id) => ctx.nationData(id),
      scenario: pack.scenario,
      autopilot: save.politics.autopilot,
    });
    sim.restore(save);
    const start = sim.read().schedule.nations;
    const now = save.calendar.elapsedGameMinutes;
    for (let d = 0; d < 8; d++) sim.advance(DAY);
    const view = sim.read();
    expect(view.date).toBe("2076-01-09");
    for (const id of Object.keys(start)) {
      expect(view.schedule.nations[id].last, id).toBeGreaterThan(now);
    }
  }, 180_000);
});
