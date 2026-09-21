import {
  calibrate,
  LandMask,
  overlap,
  prepare,
  rasterize,
  similarityFromPoints,
} from "./calibrate";
import { clipToBox, Feature, parseFeatures } from "./geodata";
import { encodePng } from "./png";
import { forwardProjection, Georef, toTile } from "./projections";
import { fillPolygon } from "./raster";

const base: Georef = {
  projection: "eqc",
  lon0: 10,
  lat0: 50,
  lat1: 40,
  lat2: 62,
  scale: 2000,
  aspect: 1,
  rotation: 0,
  tx: 100,
  ty: 80,
};

describe("projections", () => {
  it("every projection sends its centre to the origin", () => {
    for (const projection of [
      "eqc",
      "laea",
      "stereo",
      "lcc",
      "albers",
    ] as const) {
      const [x, y] = forwardProjection({ ...base, projection })(10, 50);
      expect(Math.abs(x)).toBeLessThan(1e-9);
      expect(Math.abs(y)).toBeLessThan(1e-9);
    }
  });

  it("north is up and east is right, near the centre", () => {
    for (const projection of [
      "eqc",
      "laea",
      "stereo",
      "lcc",
      "albers",
    ] as const) {
      const f = forwardProjection({ ...base, projection });
      expect(f(11, 50)[0]).toBeGreaterThan(0);
      expect(f(10, 51)[1]).toBeGreaterThan(0);
    }
  });

  it("equirectangular is linear in degrees; tile y grows southwards", () => {
    const tile = toTile(base);
    const perDegree = (2000 * Math.PI) / 180;
    expect(tile(10, 50)).toEqual([100, 80]);
    expect(tile(12, 50)[0]).toBeCloseTo(100 + 2 * perDegree, 9);
    expect(tile(10, 47)[1]).toBeCloseTo(80 + 3 * perDegree, 9);
  });

  it("conformal projections keep local scale equal in both directions", () => {
    for (const projection of ["stereo", "lcc"] as const) {
      const f = forwardProjection({ ...base, projection });
      const d = 1e-4;
      const [x0, y0] = f(25, 60);
      const east = Math.hypot(f(25 + d, 60)[0] - x0, f(25 + d, 60)[1] - y0);
      const north = Math.hypot(f(25, 60 + d)[0] - x0, f(25, 60 + d)[1] - y0);
      expect(east / Math.cos((60 * Math.PI) / 180) / north).toBeCloseTo(1, 3);
    }
  });
});

describe("fillPolygon", () => {
  const count = (rings: number[][], w = 20, h = 20) => {
    const grid = new Uint8Array(w * h);
    fillPolygon(rings, w, h, (i) => grid[i]++);
    return grid;
  };

  it("fills a square by tile centres", () => {
    const grid = count([[2, 2, 7, 2, 7, 6, 2, 6]]);
    expect(grid.reduce((a, b) => a + b, 0)).toBe(5 * 4);
    expect(grid[2 * 20 + 2]).toBe(1);
    expect(grid[6 * 20 + 2]).toBe(0);
  });

  it("leaves holes empty (even-odd)", () => {
    const grid = count([
      [0, 0, 10, 0, 10, 10, 0, 10],
      [3, 3, 7, 3, 7, 7, 3, 7],
    ]);
    expect(grid.reduce((a, b) => a + b, 0)).toBe(100 - 16);
    expect(grid[5 * 20 + 5]).toBe(0);
  });

  it("two polygons sharing an edge neither overlap nor leave a gap", () => {
    const grid = new Uint8Array(400);
    const paint = (i: number) => grid[i]++;
    fillPolygon([[1, 1, 9.37, 1, 6.2, 15, 1, 15]], 20, 20, paint);
    fillPolygon([[9.37, 1, 18, 1, 18, 15, 6.2, 15]], 20, 20, paint);
    let total = 0;
    for (const v of grid) {
      expect(v).toBeLessThanOrEqual(1);
      total += v;
    }
    expect(total).toBe(17 * 14);
  });

  it("clips to the grid", () => {
    const grid = count([[-50, -50, 500, -50, 500, 500, -50, 500]]);
    expect(grid.every((v) => v === 1)).toBe(true);
  });
});

describe("geodata", () => {
  const geojson = JSON.stringify({
    features: [
      {
        properties: { ADM0_A3: "AAA", ADMIN: "Aland", LABEL_X: 1, LABEL_Y: 2 },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      },
      {
        properties: { ADM0_A3: "BBB", ADMIN: "Bland" },
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [100, 0],
                [101, 0],
                [101, 1],
                [100, 0],
              ],
            ],
            [
              [
                [2, 2],
                [3, 2],
                [3, 3],
                [2, 2],
              ],
            ],
          ],
        },
      },
      { properties: { ADM0_A3: "CCC" }, geometry: null },
    ],
  });

  it("parses polygons, multipolygons and label points", () => {
    const features = parseFeatures(geojson, "ADM0_A3", "ADMIN");
    expect(features.map((f) => [f.id, f.polygons.length, f.label])).toEqual([
      ["AAA", 1, [1, 2]],
      ["BBB", 2, null],
    ]);
  });

  it("keeps only the polygons that reach the box", () => {
    const features = parseFeatures(geojson, "ADM0_A3", "ADMIN");
    const clipped = clipToBox(features, {
      west: -5,
      east: 5,
      south: -5,
      north: 5,
    });
    expect(clipped.map((f) => [f.id, f.polygons.length])).toEqual([
      ["AAA", 1],
      ["BBB", 1],
    ]);
  });
});

describe("calibration", () => {
  // A synthetic world of a few irregular islands, drawn with a known
  // georeference: the calibration has to find it back from the mask alone.
  const islands: Feature[] = [
    [
      [-8, 36],
      [3, 37],
      [4, 43],
      [-2, 44],
      [-9, 42],
    ],
    [
      [6, 45],
      [18, 44],
      [20, 52],
      [14, 55],
      [7, 53],
    ],
    [
      [-6, 50],
      [1, 51],
      [-1, 58],
      [-5, 57],
    ],
    [
      [22, 58],
      [30, 60],
      [28, 68],
      [21, 65],
    ],
    [
      [24, 36],
      [34, 37],
      [33, 41],
      [26, 40],
    ],
  ].map((ring, i) => ({
    id: `I${i}`,
    name: `island ${i}`,
    label: null,
    polygons: [[[...ring, ring[0]]]],
  }));
  const truth: Georef = { ...base, scale: 600, tx: 140, ty: 210 };
  const land = prepare(islands);

  function truthMask(): LandMask {
    const mask = { width: 480, height: 400, land: new Uint8Array(480 * 400) };
    rasterize(land, truth, 480, 400, 1, (i) => (mask.land[i] = 1));
    return mask;
  }

  it("overlap is 1 for the true georeference and drops when it is shifted", () => {
    const mask = truthMask();
    expect(overlap(land, truth, mask, 1)).toBe(1);
    expect(
      overlap(land, { ...truth, tx: truth.tx + 12 }, mask, 1),
    ).toBeLessThan(0.9);
  });

  it("the similarity seed is exact on exact anchors", () => {
    const tile = toTile(truth);
    const anchors = [
      [-8, 36],
      [20, 52],
      [28, 68],
      [34, 37],
    ].map(([lon, lat]) => {
      const [x, y] = tile(lon, lat);
      return { lon, lat, x, y };
    });
    const seed = similarityFromPoints(
      { ...truth, scale: 1, rotation: 0, tx: 0, ty: 0 },
      anchors,
    );
    expect(seed.scale).toBeCloseTo(600, 6);
    expect(seed.rotation).toBeCloseTo(0, 6);
    expect(seed.tx).toBeCloseTo(140, 6);
    expect(seed.ty).toBeCloseTo(210, 6);
  });

  it("recovers projection and placement from sloppy anchors", () => {
    const tile = toTile(truth);
    const sloppy = [
      [-3, 40],
      [13, 49],
      [-3, 54],
      [25, 63],
      [29, 38],
      [16, 46],
    ].map(([lon, lat], i) => {
      const [x, y] = tile(lon, lat);
      return { lon, lat, x: x + (i % 2 ? 9 : -7), y: y + (i % 3 ? -8 : 6) };
    });
    const result = calibrate(truthMask(), land, sloppy);
    expect(result.georef.projection).toBe("eqc");
    expect(result.iou).toBeGreaterThan(0.97);
    const [x, y] = toTile(result.georef)(10, 50);
    expect(Math.abs(x - 140)).toBeLessThan(2);
    expect(Math.abs(y - 210)).toBeLessThan(2);
  }, 120_000);
});

describe("png", () => {
  it("writes a valid signature and header", () => {
    const png = encodePng(new Uint8Array(2 * 2 * 3).fill(128), 2, 2);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(2);
  });
});
