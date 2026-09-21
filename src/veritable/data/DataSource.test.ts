import { dataSource } from "./catalog";
import { createDataSource } from "./DataSource";
import { fsDataFiles } from "./files.fs";
import { hasTextKey } from "./i18n";
import { GOOD_IDS } from "./schemas/goods";
import { ROW_ID } from "./schemas/row";

// The same data/veritable/ through both implementations: Vite (client, worker)
// and fs (headless runner under tsx).
const fromDisk = createDataSource(fsDataFiles());

describe("DataSource: Vite and fs implementations", () => {
  it("give exactly the same validated data", async () => {
    expect(fromDisk.config()).toEqual(dataSource.config());
    expect(fromDisk.goods()).toEqual(dataSource.goods());
    expect(fromDisk.row()).toEqual(dataSource.row());
    expect(fromDisk.blocs()).toEqual(dataSource.blocs());
    expect(fromDisk.scenarioIds()).toEqual(dataSource.scenarioIds());
    const scenario = dataSource.scenario("europe-10");
    expect(fromDisk.scenario("europe-10")).toEqual(scenario);
    for (const id of scenario.nations) {
      expect(fromDisk.nation(id)).toEqual(dataSource.nation(id));
    }
    expect(fromDisk.bordersMeta(scenario)).toEqual(
      dataSource.bordersMeta(scenario),
    );
    const a = await fromDisk.borders(scenario);
    const b = await dataSource.borders(scenario);
    expect(a.nations).toEqual(b.nations);
    expect(a.tiles.length).toBe(b.tiles.length);
    expect(a.tiles.every((v, i) => v === b.tiles[i])).toBe(true);
  });

  it("fails clearly on a missing file", () => {
    expect(() => fromDisk.nation("XXX")).toThrow(/not found/);
    expect(() => dataSource.scenario("atlantis")).toThrow(/not found/);
  });
});

describe("J2 data", () => {
  it("the twelve goods of tier 1, each with a label", () => {
    const goods = dataSource.goods();
    expect(goods.map((g) => g.id)).toEqual([...GOOD_IDS]);
    for (const g of goods) expect(hasTextKey(g.name)).toBe(true);
    expect(goods.find((g) => g.id === "electricity")!.transport).toBe(
      "neighbors-only",
    );
    expect(goods.find((g) => g.id === "services")!.transport).toBe("free");
  });

  it("every figure of every sheet says where it comes from; estimates are justified", () => {
    const scenario = dataSource.scenario("europe-10");
    const estimates: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (node === null || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (typeof record.source === "string") {
        expect(record.asOf, path).toBeTruthy();
        if (record.source === "estimate") {
          expect(String(record.note ?? "").length, path).toBeGreaterThan(20);
          estimates.push(path);
        }
      }
      for (const [key, value] of Object.entries(record)) {
        walk(value, `${path}.${key}`);
      }
    };
    for (const id of scenario.nations) walk(dataSource.nation(id), id);
    expect(estimates.length).toBeGreaterThan(0);
  });

  it("the rest of the world closes the world balance of every good", () => {
    const scenario = dataSource.scenario("europe-10");
    const row = dataSource.row();
    expect(row.id).toBe(ROW_ID);
    for (const good of GOOD_IDS) {
      const sheets = scenario.nations.map(
        (id) => dataSource.nation(id).economy.goods[good],
      );
      const production =
        sheets.reduce((s, g) => s + g.production.value, 0) +
        row.goods[good]!.production.value;
      const consumption =
        sheets.reduce((s, g) => s + g.consumption.value, 0) +
        row.goods[good]!.consumption.value;
      expect(row.goods[good]!.production.value).toBeGreaterThan(0);
      expect(Math.abs(production - consumption) / production).toBeLessThan(
        0.01,
      );
    }
  });

  it("index goods: the ten nations produce 100", () => {
    const scenario = dataSource.scenario("europe-10");
    for (const good of ["steel", "services", "critical-minerals"] as const) {
      const total = scenario.nations.reduce(
        (s, id) =>
          s + dataSource.nation(id).economy.goods[good].production.value,
        0,
      );
      expect(total).toBeCloseTo(100, 1);
    }
  });

  it("the EU carries its fiscal rule, and land adjacency is in the borders meta", () => {
    const eu = dataSource.blocs().find((b) => b.id === "eu")!;
    expect(eu.fiscalRule).toMatchObject({
      maxDeficitToGdp: 0.03,
      maxDebtToGdp: 0.6,
    });
    const meta = dataSource.bordersMeta(dataSource.scenario("europe-10"));
    expect(meta.landNeighbours).toContainEqual(["FRA", "DEU"]);
    expect(meta.landNeighbours).toContainEqual(["POL", "RUS"]); // Kaliningrad
    expect(meta.landNeighbours).not.toContainEqual(["FRA", "GBR"]);
    expect(meta.bordersNeutralLand).toContain("GBR"); // Ireland
  });
});
