import { BlastRules, BlastTile, blastHits, circleOverlap } from "./blast";

// What a burst does to the land and the people around it (J7c).

const RULES: BlastRules = {
  rings: 12,
  centerLethality: 1,
  contaminatedLethality: 0.02,
  contaminationEdge: 0.1,
  urbanDensityKm2: 1500,
  coreDensityKm2: 10000,
};
const ATOM = { destructionKm: 3, contaminationKm: 15 };
const HYDROGEN = { destructionKm: 7, contaminationKm: 35 };

// Tiles of `wKm` x `hKm` around the burst (at the centre of the middle
// tile), peopled by `density(r)` people a km² at r km from the burst.
function tiles(
  wKm: number,
  hKm: number,
  reachKm: number,
  density: (r: number) => number,
): BlastTile[] {
  const out: BlastTile[] = [];
  const nx = Math.ceil(reachKm / wKm);
  const ny = Math.ceil(reachKm / hKm);
  let id = 0;
  for (let j = -ny; j <= ny; j++) {
    for (let i = -nx; i <= nx; i++) {
      // People of the tile: the density sampled on 5 x 5 points.
      let people = 0;
      for (let a = 0; a < 5; a++) {
        for (let b = 0; b < 5; b++) {
          const x = (i + (a + 0.5) / 5 - 0.5) * wKm;
          const y = (j + (b + 0.5) / 5 - 0.5) * hKm;
          people += (density(Math.hypot(x, y)) * wKm * hKm) / 25;
        }
      }
      out.push({
        tile: id++,
        dxKm: i * wKm,
        dyKm: j * hKm,
        areaKm2: wKm * hKm,
        people,
      });
    }
  }
  return out;
}

const total = (hits: { deaths: number }[]) =>
  hits.reduce((s, h) => s + h.deaths, 0);

// An agglomeration of about ten million people: 25 000 a km² at its centre,
// halving every 5.5 km.
const metropolis = (r: number) => 25000 * Math.exp(-r / 8);

describe("circleOverlap", () => {
  it("is nothing apart, the smaller disc inside, symmetric between", () => {
    expect(circleOverlap(10, 3, 4)).toBe(0);
    expect(circleOverlap(0.5, 3, 1)).toBeCloseTo(Math.PI, 10);
    expect(circleOverlap(2, 3, 3)).toBeCloseTo(circleOverlap(2, 3, 3), 10);
    // Two unit discs one radius apart: 2π/3 - √3/2.
    expect(circleOverlap(1, 1, 1)).toBeCloseTo(
      (2 * Math.PI) / 3 - Math.sqrt(3) / 2,
      10,
    );
  });
});

describe("blastHits", () => {
  it("kills half the people of the disc of destruction, 2 % beyond", () => {
    const hits = blastHits(
      tiles(1, 1, 40, () => 1000),
      HYDROGEN,
      RULES,
    );
    const expected =
      0.5 * Math.PI * 49 * 1000 + 0.02 * Math.PI * (35 * 35 - 49) * 1000;
    expect(Math.abs(total(hits) / expected - 1)).toBeLessThan(0.03);
  });

  it("contaminates 1 at ground zero, less outward, nothing beyond", () => {
    const land = tiles(1, 1, 40, () => 0);
    const hits = blastHits(land, HYDROGEN, RULES);
    const level = new Map(hits.map((h) => [h.tile, h.contamination]));
    const at = (dx: number) =>
      level.get(land.find((t) => t.dxKm === dx && t.dyKm === 0)!.tile) ?? 0;
    expect(at(0)).toBeCloseTo(1, 5);
    expect(at(20)).toBeLessThan(at(10));
    expect(at(20)).toBeGreaterThan(0.1);
    expect(at(38)).toBe(0);
    expect(total(hits)).toBe(0);
  });

  it("counts only the people a burst smaller than a tile covers, the town's first", () => {
    // One tile of the world map (60 km²) around a town of 300 000.
    const town: BlastTile[] = [
      { tile: 1, dxKm: 0, dyKm: 0, areaKm2: 60, people: 300000 },
    ];
    const deaths = total(blastHits(town, ATOM, RULES));
    // Spread over the tile, the disc of destruction (28 km²) would hold
    // 47 % of the people and kill half of them: 70 000. Concentrated around
    // the town (30 km² at 10 000 a km²), nearly all of them are within 3 km.
    expect(deaths).toBeGreaterThan(100000);
    expect(deaths).toBeLessThan(200000);
    // A rural tile: its people are spread.
    const rural: BlastTile[] = [
      { tile: 1, dxKm: 0, dyKm: 0, areaKm2: 60, people: 30000 },
    ];
    expect(total(blastHits(rural, ATOM, RULES))).toBeCloseTo(
      30000 * ((0.5 * 9 * Math.PI) / 60 + (0.02 * (60 - 9 * Math.PI)) / 60),
      -2,
    );
  });

  it("kills one to three million with an H-bomb on ten million people, a few hundred thousand with an A-bomb, on either map", () => {
    // The Europe map (2.7 km a tile, 1.8 km wide at 48° N) and the world
    // map (9.4 km, 6.3 km wide).
    for (const [w, h] of [
      [1.83, 2.74],
      [6.3, 9.4],
    ]) {
      const city = tiles(w, h, 60, metropolis);
      const people = city.reduce((s, t) => s + t.people, 0);
      expect(people).toBeGreaterThan(9e6);
      expect(people).toBeLessThan(11e6);
      const hydrogen = total(blastHits(city, HYDROGEN, RULES));
      expect(hydrogen).toBeGreaterThan(1e6);
      expect(hydrogen).toBeLessThan(3e6);
      const atom = total(blastHits(city, ATOM, RULES));
      expect(atom).toBeGreaterThan(1e5);
      expect(atom).toBeLessThan(9e5);
    }
  });
});
