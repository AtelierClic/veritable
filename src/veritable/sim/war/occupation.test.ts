import { loadVeritableConfig } from "../../data/loadConfig";
import { NationData } from "../../data/schemas/nation";
import { DiplomacyState } from "../../data/schemas/save";
import { decodeSave, encodeSave } from "../../save/serialize";
import { MemoryWorld } from "../testing/MemoryWorld";
import { testNation, testScenario } from "../testing/nations";
import { testSimData } from "../testing/simData";
import { VeritableSimImpl } from "../VeritableSimImpl";
import { PeopleTiles } from "./people";

// The people of the tiles (J7b): land that changes hands carries its share
// of the people, the production and the GDP of the nation that loses it;
// in a war the people occupied and the capitals and cities score; urban
// tiles defend better.

const TICK = 72;
const DAY = 1440;
const W = 60;
const H = 40;

// AAA holds the west half, BBB the east half; each tile of BBB holds 100
// people, but its first column on the front holds 1 000, and its tile
// (30, 20) is its capital.
function campaign(options: { people?: boolean; personnel?: number } = {}) {
  const world = new MemoryWorld(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      world.setOwner(y * W + x, x < W / 2 ? "AAA" : "BBB");
    }
  }
  world.setClaims(new Map());
  const capital = 20 * W + 30;
  if (options.people !== false) {
    const people = new Float32Array(W * H);
    for (let t = 0; t < W * H; t++) people[t] = t % W === 30 ? 1000 : 100;
    world.setPeople({ people, cities: [{ tile: capital, capital: true }] });
  }
  const sheets = new Map<string, NationData>();
  for (const id of ["AAA", "BBB"]) {
    const sheet = testNation(id);
    sheet.military.activePersonnel =
      id === "AAA" ? (options.personnel ?? 300_000) : 60_000;
    sheets.set(id, sheet);
  }
  const config = structuredClone(loadVeritableConfig());
  config.economy.growth.noiseMonthlySd = 0;
  config.economy.rowSupplyNoise.monthlySd = 0;
  config.politics.aiShock.sd = 0;
  config.war.segmentTiles = 40;
  config.logistics.base = 1000;
  const scenario = testScenario(["AAA", "BBB"]);
  const sim = new VeritableSimImpl({
    config,
    world,
    data: testSimData(["AAA", "BBB"]),
    nationData: (id) => sheets.get(id),
    scenario,
  });
  sim.init(scenario, 5);
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) sim.advance(TICK);
  };
  const days = (n: number) => {
    for (let i = 0; i < n; i++) sim.advance(DAY);
  };
  const diplomacy = (sim as unknown as { diplomacy: DiplomacyState }).diplomacy;
  return { sim, world, config, ticks, days, capital, diplomacy };
}

function openWar(c: ReturnType<typeof campaign>) {
  c.sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
  c.ticks(1);
  for (const d of c.sim.read().military.nations.AAA.divisions) {
    c.sim.apply({
      type: "assign-division",
      division: d.id,
      front: "AAA|BBB",
      segment: null,
    });
    c.sim.apply({ type: "set-posture", division: d.id, posture: "attack" });
  }
}

describe("the people of the tiles (J7b)", () => {
  it("counts the people each nation holds and what changes hands", () => {
    const people = new Float32Array([5, 0, 7, 1]);
    const tiles = new PeopleTiles(4, {
      people,
      cities: [{ tile: 2, capital: true }],
    });
    const owners = ["A", "A", "B", null];
    tiles.prime((t) => owners[t]);
    expect(tiles.holdings()).toEqual(
      new Map([
        ["A", 5],
        ["B", 7],
      ]),
    );
    tiles.ownerChanged(2, "B", "A");
    tiles.ownerChanged(3, null, "A"); // unowned land: counted, no move
    tiles.ownerChanged(1, "A", "B"); // no people: no move
    expect(tiles.holdings().get("A")).toBe(13);
    expect(tiles.holdings().get("B")).toBe(0);
    expect(tiles.take()).toEqual({
      moves: [{ from: "B", to: "A", people: 7 }],
      cities: [{ tile: 2, from: "B", to: "A", capital: true }],
    });
    expect(tiles.take()).toEqual({ moves: [], cities: [] });
    // A load is no occupation.
    tiles.load();
    tiles.ownerChanged(0, "A", "B");
    expect(tiles.take()).toEqual({ moves: [], cities: [] });
    expect(tiles.isUrban(2, 6)).toBe(true);
    expect(tiles.isUrban(0, 6)).toBe(false);
  });

  it("land taken carries the share of people, production and GDP of its people; the occupier gets half of the production", () => {
    const c = campaign();
    const before = c.sim.read().economies;
    const bbb0 = { ...before.BBB, production: { ...before.BBB.production } };
    const aaa0 = { ...before.AAA, production: { ...before.AAA.production } };
    openWar(c);
    c.ticks(40);
    const held0 = 30 * 40 * 100 + 40 * 900; // BBB: 1 200 tiles, dense column
    const held = c.world.peopleHoldings().get("BBB")!;
    expect(held).toBeLessThan(held0);
    const lost = 1 - held / held0;
    const after = c.sim.read().economies;
    // Populations move together (the growth of the few days aside).
    const moved = bbb0.population - after.BBB.population;
    expect(moved / bbb0.population).toBeGreaterThan(0.9 * lost);
    expect(moved / bbb0.population).toBeLessThan(1.1 * lost);
    expect(after.AAA.population - aaa0.population).toBeGreaterThan(0.9 * moved);
    // Production: the loser loses its share, the occupier gets half.
    const good = Object.keys(bbb0.production).find(
      (g) => bbb0.production[g] > 0,
    )!;
    const lostMade = bbb0.production[good] - after.BBB.production[good];
    expect(lostMade / bbb0.production[good]).toBeGreaterThan(0.9 * lost);
    const gained = after.AAA.production[good] - aaa0.production[good];
    expect(gained / lostMade).toBeGreaterThan(0.45);
    expect(gained / lostMade).toBeLessThan(0.55);
    // The dense column went first: more people than tiles lost.
    const tiles = c.sim.read().nations.find((n) => n.id === "BBB")!.tileCount;
    expect(lost).toBeGreaterThan(1 - tiles / 1200);
    // The war score is the people occupied (contested), not the tiles; the
    // capital, on the front, is taken too.
    const war = c.sim.read().diplomacy.wars[0];
    expect(c.world.ownerOf(c.capital)).toBe("AAA");
    const expected =
      (moved / 1e6) *
        c.config.war.warScore.peopleValue *
        c.config.war.contest.valueShare +
      c.config.war.warScore.capitalValue;
    expect(war.landValue.AAA).toBeGreaterThan(0.95 * expected);
    expect(war.landValue.AAA).toBeLessThan(1.05 * expected);
  });

  it("the capital of the enemy scores its bonus", () => {
    const c = campaign();
    openWar(c);
    const war = () => c.sim.read().diplomacy.wars[0];
    let guard = 0;
    while (c.world.ownerOf(c.capital) === "BBB" && guard++ < 100) c.ticks(20);
    expect(c.world.ownerOf(c.capital)).toBe("AAA");
    const people =
      (war().landValue.AAA - c.config.war.warScore.capitalValue) /
      (c.config.war.warScore.peopleValue * c.config.war.contest.valueShare);
    expect(people).toBeGreaterThan(0);
    expect(war().score.AAA).toBeGreaterThanOrEqual(war().landValue.AAA);
  });

  it("an annexed nation keeps a residue of its economy", () => {
    const c = campaign();
    const gdp0 = c.sim.read().economies.BBB.gdp;
    c.world.transferAll("BBB", "AAA");
    c.ticks(1);
    const bbb = c.sim.read().economies.BBB;
    const residual = c.config.war.transfer.residualShare;
    expect(bbb.gdp / gdp0).toBeGreaterThan(0.5 * residual);
    expect(bbb.gdp / gdp0).toBeLessThan(2 * residual);
    expect(bbb.population).toBeGreaterThan(0);
    expect(Number.isFinite(c.sim.read().economies.AAA.gdp)).toBe(true);
  });

  it("the residue does not shrink loss after loss", () => {
    const c = campaign();
    const gdp0 = c.sim.read().economies.BBB.gdp;
    const residual = c.config.war.transfer.residualShare;
    for (let round = 0; round < 3; round++) {
      c.world.transferAll("BBB", "AAA");
      c.ticks(1);
      // A little land comes back, and is lost again.
      for (let y = 0; y < 5; y++) c.world.setOwner(y * W + 59, "BBB");
      c.ticks(1);
    }
    c.world.transferAll("BBB", "AAA");
    c.ticks(1);
    const gdp = c.sim.read().economies.BBB.gdp;
    expect(gdp / gdp0).toBeGreaterThan(0.9 * residual);
    expect(Number.isFinite(c.sim.read().economies.BBB.population)).toBe(true);
  });

  it("without a population grid nothing moves and the tiles score as before", () => {
    const c = campaign({ people: false });
    const pop0 = c.sim.read().economies.BBB.population;
    openWar(c);
    c.ticks(40);
    const war = c.sim.read().diplomacy.wars[0];
    expect(war.tilesTaken.AAA).toBeGreaterThan(0);
    expect(war.landValue.AAA).toBeCloseTo(
      war.tilesTaken.AAA *
        c.config.war.warScore.tileValue *
        c.config.war.contest.valueShare,
      9,
    );
    // Only the growth of the few days.
    expect(
      Math.abs(c.sim.read().economies.BBB.population / pop0 - 1),
    ).toBeLessThan(0.001);
  });

  it("urban tiles defend better", () => {
    const plain = new MemoryWorld(4, 2);
    const urban = new MemoryWorld(4, 2);
    for (const w of [plain, urban]) {
      for (let t = 0; t < 8; t++) w.setOwner(t, t % 4 < 2 ? "AAA" : "BBB");
    }
    const people = new Float32Array(8).fill(10);
    people[2] = people[6] = 9000; // BBB's front column
    urban.setPeople({ people, cities: [] }, { threshold: 8000, defense: 1.5 });
    const [p] = plain.fronts([["AAA", "BBB"]], 40);
    const [u] = urban.fronts([["AAA", "BBB"]], 40);
    expect(p.segments[0].defense.BBB).toBe(1);
    expect(u.segments[0].defense.BBB).toBeCloseTo(1.5, 9);
    expect(u.segments[0].defense.AAA).toBe(1);
  });

  it("a save made while the land moves loads to the same bytes", () => {
    const c = campaign();
    openWar(c);
    c.ticks(30);
    const snap = c.sim.snapshot();
    const bytes = encodeSave(snap);
    const world2 = new MemoryWorld(W, H);
    const people = new Float32Array(W * H);
    for (let t = 0; t < W * H; t++) people[t] = t % W === 30 ? 1000 : 100;
    world2.setPeople({ people, cities: [] });
    const sheets = new Map<string, NationData>(
      ["AAA", "BBB"].map((id) => [id, testNation(id)]),
    );
    const other = new VeritableSimImpl({
      config: c.config,
      world: world2,
      data: testSimData(["AAA", "BBB"]),
      nationData: (id) => sheets.get(id),
      scenario: testScenario(["AAA", "BBB"]),
    });
    other.restore(decodeSave(bytes));
    expect(encodeSave(other.snapshot())).toEqual(bytes);
    // Nothing waited in the world: the restore moved nobody.
    expect(world2.takeOccupations()).toEqual({ moves: [], cities: [] });
  });
});
