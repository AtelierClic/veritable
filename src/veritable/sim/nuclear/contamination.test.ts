import { TILE_FALLOUT_BIT } from "../../data/schemas/save";
import { PeopleTiles } from "../war/people";
import {
  addBurst,
  ContaminationRules,
  ContaminationTiles,
  healContamination,
  healingSpeedup,
} from "./contamination";
import { repairFallout } from "./fallout";

// The contamination of the land (J7c).

const RULES: ContaminationRules = {
  halfLifeYears: 6,
  maxSpeedup: 2,
  infrastructurePointsForMax: 2,
  aidPctGdpForMax: 2,
  repopulationMax: 0.3,
  repopulationHalfLifeYears: 5,
  minLevel: 0.01,
};
const YEAR = 365.25;

describe("addBurst", () => {
  it("compounds the contamination and the dead of a tile hit twice", () => {
    const once = addBurst(
      [],
      [{ tile: 5, deaths: 10, contamination: 0.5, deathShare: 0.2 }],
    );
    const twice = addBurst(once, [
      { tile: 5, deaths: 10, contamination: 0.5, deathShare: 0.5 },
      { tile: 2, deaths: 0, contamination: 0.1, deathShare: 0 },
    ]);
    expect(twice.map((e) => e.tile)).toEqual([2, 5]);
    expect(twice[1].level).toBeCloseTo(0.75, 12);
    expect(twice[1].dead).toBeCloseTo(0.6, 12);
  });
});

describe("healContamination", () => {
  it("halves in six years, twice as fast with the spending and the aid at their full", () => {
    const land = [{ tile: 1, level: 1, dead: 0 }];
    const slow = healContamination(land, 6 * YEAR, RULES, () => 1);
    expect(slow[0].level).toBeCloseTo(0.5, 10);
    const full = healingSpeedup(RULES, 2, 2);
    expect(full).toBe(2);
    const fast = healContamination(land, 6 * YEAR, RULES, () => full);
    expect(fast[0].level).toBeCloseTo(0.25, 10);
    // Half the way with one of the two.
    expect(healingSpeedup(RULES, 2, 0)).toBe(1.5);
    expect(healingSpeedup(RULES, -1, 0)).toBe(1);
  });

  it("lets the people come back only once the land is under 0.3", () => {
    const land = [
      { tile: 1, level: 0.9, dead: 0.5 },
      { tile: 2, level: 0.2, dead: 0.5 },
    ];
    const year = healContamination(land, YEAR, RULES, () => 1);
    expect(year[0].dead).toBe(0.5);
    expect(year[1].dead).toBeCloseTo(0.5 * Math.pow(0.5, 1 / 5), 10);
  });

  it("drops a tile healed with its people back", () => {
    const land = [{ tile: 1, level: 0.011, dead: 0.011 }];
    expect(healContamination(land, 2 * YEAR, RULES, () => 1)).toEqual([]);
  });
});

describe("ContaminationTiles", () => {
  it("takes the dead off the people of the tiles and weighs each nation's land by its people", () => {
    const people = new PeopleTiles(4, {
      people: Float32Array.from([100, 300, 0, 600]),
      cities: [],
    });
    const owners = ["A", "A", null, "B"];
    people.prime((t) => owners[t]);
    const tiles = new ContaminationTiles();
    tiles.set(
      [
        { tile: 1, level: 0.5, dead: 0.5 },
        { tile: 3, level: 1, dead: 0 },
      ],
      people,
      (t) => owners[t],
    );
    expect(people.holdings().get("A")).toBe(250);
    expect(people.peopleAt(1)).toBe(150);
    const shares = tiles.sharesOf(
      (t) => owners[t],
      (t) => people.peopleAt(t),
      (n) => people.holdings().get(n) ?? 0,
    );
    expect(shares.get("A")).toBeCloseTo((0.5 * 150) / 250, 12);
    expect(shares.get("B")).toBe(1);
    expect(tiles.meanOf([0, 1, 2, 3])).toBeCloseTo(0.375, 12);
    // Healed: the people come back to their count.
    tiles.set([], people, (t) => owners[t]);
    expect(people.holdings().get("A")).toBe(400);
  });
});

describe("repairFallout (saves of the J5 to the J7b)", () => {
  // 5 x 3: A holds the left, B the right; a burst released the middle
  // column. A detonated strike hit A.
  const A = 1;
  const B = 2;
  const F = TILE_FALLOUT_BIT;
  // prettier-ignore
  const tiles = Uint16Array.from([
    A, A, F, B, B,
    A, A, F, B, B,
    A, A, F, B, B,
  ]);
  const strike = {
    id: 1,
    date: "2030-01-01",
    by: "B",
    target: "A",
    aim: "capital" as const,
    weapon: "hydrogen" as const,
    status: "detonated" as const,
    hits: { A: 3 },
    tile: null,
    deaths: {},
  };

  it("gives the released land back to the nation the burst hit, contaminated as healed since", () => {
    const repaired = repairFallout({
      tiles,
      width: 5,
      height: 3,
      nations: ["A", "B"],
      strikes: [strike],
      date: "2036-01-01",
      halfLifeYears: 6,
    })!;
    expect(repaired.repaired).toBe(3);
    expect([2, 7, 12].map((t) => repaired.tiles[t])).toEqual([A, A, A]);
    expect(repaired.entries.map((e) => e.tile)).toEqual([2, 7, 12]);
    expect(repaired.entries[0].level).toBeCloseTo(0.5, 2);
    // The save itself is left alone.
    expect(tiles[2]).toBe(F);
  });

  it("without a strike that names it, to the neighbour that borders it most; nothing to do without fallout", () => {
    // prettier-ignore
    const lopsided = Uint16Array.from([
      A, F, B, B, B,
      A, F, B, B, B,
      B, F, B, B, B,
    ]);
    const repaired = repairFallout({
      tiles: lopsided,
      width: 5,
      height: 3,
      nations: ["A", "B"],
      strikes: [],
      date: "2036-01-01",
      halfLifeYears: 6,
    })!;
    expect([1, 6, 11].map((t) => repaired.tiles[t])).toEqual([B, B, B]);
    expect(repaired.entries[0].level).toBe(1);
    expect(
      repairFallout({
        tiles: Uint16Array.from([A, B]),
        width: 2,
        height: 1,
        nations: ["A", "B"],
        strikes: [],
        date: "2036-01-01",
        halfLifeYears: 6,
      }),
    ).toBeNull();
  });
});
