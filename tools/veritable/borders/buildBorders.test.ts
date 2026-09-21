import fs from "fs";
import path from "path";
import {
  decodeBorders,
  encodeBorders,
} from "../../../src/veritable/data/bordersFile";
import { buildBorders } from "./buildBorders";
import { LandMask } from "./calibrate";
import { Feature } from "./geodata";
import { Georef } from "./projections";

// 1 tile per degree, tile (x, y) = (lon, -lat): easy to reason about.
const georef: Georef = {
  projection: "eqc",
  lon0: 0,
  lat0: 0,
  lat1: 0,
  lat2: 0,
  scale: 180 / Math.PI,
  aspect: 1,
  rotation: 0,
  tx: 0,
  ty: 0,
};

const box = (
  id: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Feature => ({
  id,
  name: id,
  label: null,
  polygons: [
    [
      [
        [x0, -y0],
        [x1, -y0],
        [x1, -y1],
        [x0, -y1],
        [x0, -y0],
      ],
    ],
  ],
});

// 30 x 10 world. Land everywhere except a lake and a sea column.
function world(): LandMask {
  const mask = { width: 30, height: 10, land: new Uint8Array(300).fill(1) };
  for (let y = 0; y < 10; y++) mask.land[y * 30 + 20] = 0; // sea at x = 20
  mask.land[5 * 30 + 3] = 0; // a lake inside AAA
  return mask;
}

// AAA covers x 0..7, BBB x 9..14 (x = 8 is an uncovered coast strip),
// CCC x 14..20; beyond the sea, an uncovered island from x = 21.
const countries = [
  box("AAA", 0, 0, 8, 10),
  box("BBB", 9, 0, 14, 10),
  box("CCC", 14, 0, 20, 10),
];

describe("buildBorders", () => {
  const run = (
    nations: string[],
    overrides = [] as never[],
    insets = [] as never[],
  ) => buildBorders(world(), georef, countries, overrides, insets, nations, 4);

  it("gives an owner to land tiles only", () => {
    const { borders } = run(["AAA", "BBB", "CCC"]);
    expect(borders.tiles[5 * 30 + 3]).toBe(0); // the lake stays water
    expect(borders.tiles[5 * 30 + 2]).toBe(1);
    for (let y = 0; y < 10; y++) expect(borders.tiles[y * 30 + 20]).toBe(0);
  });

  it("attaches orphan coast to the nearest country among ALL countries, then filters", () => {
    // x = 8 touches AAA (x = 7) and BBB (x = 9): the search reaches it from
    // both at distance 1; AAA wins the tie by queue order. The point of the
    // test is the second case: with BBB outside the scenario, tiles that
    // belong to BBB must become neutral, never AAA's.
    const all = run(["AAA", "BBB", "CCC"]);
    expect(all.report.orphansReattached).toBeGreaterThan(0);
    const onlyA = run(["AAA"]);
    for (let y = 0; y < 10; y++) {
      expect(onlyA.borders.tiles[y * 30 + 10]).toBe(0); // BBB land: neutral
      expect(onlyA.borders.tiles[y * 30 + 2]).toBe(1);
    }
    expect(onlyA.report.nations[0].total).toBe(all.report.nations[0].total);
    expect(onlyA.report.neutralLand).toBe(
      all.report.nations[1].total + all.report.nations[2].total,
    );
  });

  it("leaves land beyond the distance limit unattached, and insets neutral", () => {
    const { report, borders } = run(["AAA", "BBB", "CCC"]);
    // Island x 21..29: CCC's edge is x = 19, so x 21..23 are within 4 tiles.
    expect(borders.tiles[0 * 30 + 23]).toBe(3);
    expect(borders.tiles[0 * 30 + 24]).toBe(0);
    expect(report.unattachedLand).toBe(6 * 10);

    const withInset = buildBorders(
      world(),
      georef,
      countries,
      [],
      [{ name: "inset", box: [21, 0, 29, 9] }],
      ["AAA", "BBB", "CCC"],
      4,
    );
    expect(withInset.borders.tiles[0 * 30 + 23]).toBe(0);
    expect(withInset.report.insetLand).toBe(9 * 10);
    expect(withInset.report.unattachedLand).toBe(0);
  });

  it("an override moves tiles only from the listed owners", () => {
    const override = {
      id: "occupied",
      controller: "CCC",
      from: ["BBB"],
      feature: box("occupied", 5, 2, 12, 6), // straddles AAA and BBB
    };
    const { borders, report } = buildBorders(
      world(),
      georef,
      countries,
      [override],
      [],
      ["AAA", "BBB", "CCC"],
      4,
    );
    expect(borders.tiles[3 * 30 + 6]).toBe(1); // AAA untouched
    expect(borders.tiles[3 * 30 + 10]).toBe(3); // BBB -> CCC
    expect(borders.tiles[8 * 30 + 10]).toBe(2); // outside the polygon
    expect(report.overrides).toEqual([
      { id: "occupied", controller: "CCC", tiles: 3 * 4 },
    ]);
    expect(report.nations[1].lostToOverride).toBe(12);
    expect(report.nations[2].gainedByOverride).toBe(12);
  });

  it("every land tile is accounted for", () => {
    const { report } = run(["AAA", "CCC"]);
    const owned = report.nations.reduce((s, n) => s + n.total, 0);
    expect(
      owned + report.neutralLand + report.insetLand + report.unattachedLand,
    ).toBe(report.landTiles);
  });
});

describe("borders file", () => {
  it("round-trips", () => {
    const { borders } = buildBorders(
      world(),
      georef,
      countries,
      [],
      [],
      ["AAA", "CCC"],
      4,
    );
    const back = decodeBorders(encodeBorders(borders));
    expect(back.nations).toEqual(["AAA", "CCC"]);
    expect(Array.from(back.tiles)).toEqual(Array.from(borders.tiles));
    expect([back.width, back.height]).toEqual([30, 10]);
  });

  it("rejects corrupt files", () => {
    const bytes = encodeBorders({
      width: 2,
      height: 1,
      nations: ["AAA"],
      tiles: Uint16Array.from([1, 0]),
    });
    expect(() => decodeBorders(bytes.subarray(0, 10))).toThrow();
    const bad = bytes.slice();
    bad[0] = 0;
    expect(() => decodeBorders(bad)).toThrow(/magic/);
    expect(() =>
      encodeBorders({
        width: 2,
        height: 1,
        nations: [],
        tiles: Uint16Array.from([1, 0]),
      }),
    ).not.toThrow();
    expect(() =>
      decodeBorders(
        encodeBorders({
          width: 2,
          height: 1,
          nations: [],
          tiles: Uint16Array.from([1, 0]),
        }),
      ),
    ).toThrow(/unknown nation/);
  });
});

describe("data/veritable/borders/europe-10.bin", () => {
  const root = path.resolve(__dirname, "../../../data/veritable");
  const borders = decodeBorders(
    fs.readFileSync(path.join(root, "borders/europe-10.bin")),
  );
  const scenario = JSON.parse(
    fs.readFileSync(path.join(root, "scenarios/europe-10.json"), "utf8"),
  );
  const report = JSON.parse(
    fs.readFileSync(path.join(root, "borders/europe-10.report.json"), "utf8"),
  );

  it("matches the scenario and the Europe map", () => {
    expect(borders.nations).toEqual(scenario.nations);
    expect([borders.width, borders.height]).toEqual([2904, 1672]);
  });

  it("every nation has territory, and the report tells the truth", () => {
    const totals = new Array(borders.nations.length + 1).fill(0);
    for (const v of borders.tiles) totals[v]++;
    borders.nations.forEach((nation, n) => {
      expect(totals[n + 1]).toBeGreaterThan(10_000);
      expect(report.nations[n]).toMatchObject({ nation, total: totals[n + 1] });
    });
  });

  it("only land tiles of map.bin have an owner", () => {
    const terrain = fs.readFileSync(
      path.resolve(root, "../../resources/maps/europe/map.bin"),
    );
    for (let i = 0; i < borders.tiles.length; i++) {
      if (borders.tiles[i] !== 0 && (terrain[i] & 0x80) === 0) {
        throw new Error(`tile ${i} is water but has an owner`);
      }
    }
  });
});
