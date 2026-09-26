import { loadVeritableConfig } from "../../data/loadConfig";
import { VeritableConfig } from "../../data/schemas/config";
import { NationData } from "../../data/schemas/nation";
import { encodeSave } from "../../save/serialize";
import { MemoryWorld } from "../testing/MemoryWorld";
import { testNation, testScenario } from "../testing/nations";
import { testSimData } from "../testing/simData";
import { SimEvent } from "../VeritableSim";
import { VeritableSimImpl } from "../VeritableSimImpl";
import { stepWarLedgers } from "./fronts";
import { captureAlong, frontTiles, segmentFront } from "./geometry";

const TICK = 72;
const DAY = 1440;

function quietConfig(): VeritableConfig {
  const config = structuredClone(loadVeritableConfig());
  config.economy.growth.noiseMonthlySd = 0;
  config.economy.rowSupplyNoise.monthlySd = 0;
  return config;
}

interface Options {
  personnel?: Record<string, number>;
  autopilot?: boolean;
  // Slower lines, for wars that must last months in a small world.
  slow?: boolean;
  width?: number;
  height?: number;
}

// AAA holds the west half, BBB the east half; the front is the column pair
// in the middle, cut into segments of 40 tiles.
function twoNations(options: Options = {}) {
  const width = options.width ?? 60;
  const height = options.height ?? 40;
  const world = new MemoryWorld(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      world.setOwner(y * width + x, x < width / 2 ? "AAA" : "BBB");
    }
  }
  // Claims (J6): these owners are the first day.
  world.setClaims(new Map());
  const sheets = new Map<string, NationData>();
  for (const id of ["AAA", "BBB"]) {
    const sheet = testNation(id);
    sheet.military.activePersonnel = options.personnel?.[id] ?? 150_000;
    sheets.set(id, sheet);
  }
  const config = quietConfig();
  config.war.segmentTiles = 40;
  // These tests are about the fronts, not the logistics (logistics.test.ts).
  config.logistics.base = 1000;
  if (options.slow) {
    config.war.v0 = 0.05;
    config.war.vMax = 0.5;
  }
  const scenario = testScenario(["AAA", "BBB"]);
  const sim = new VeritableSimImpl({
    config,
    world,
    data: testSimData(["AAA", "BBB"]),
    nationData: (id) => sheets.get(id),
    scenario,
    autopilot: options.autopilot,
  });
  sim.init(scenario, 5);
  const events: SimEvent[] = [];
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) {
      events.push(...sim.advance(TICK).filter((e) => e.type !== "day-started"));
    }
  };
  const days = (n: number) => {
    for (let d = 0; d < n; d++) {
      events.push(...sim.advance(DAY).filter((e) => e.type !== "day-started"));
    }
  };
  const tiles = (id: string) =>
    sim.read().nations.find((n) => n.id === id)!.tileCount;
  const half = (width * height) / 2;
  return { sim, world, events, ticks, days, tiles, config, half, sheets };
}

// Every division of the player on the front, in the given posture.
function sendAll(
  sim: VeritableSimImpl,
  posture: "defend" | "attack" | "breakthrough",
) {
  for (const d of sim.read().military.nations.AAA.divisions) {
    sim.apply({
      type: "assign-division",
      division: d.id,
      front: "AAA|BBB",
      segment: null,
    });
    sim.apply({ type: "set-posture", division: d.id, posture });
  }
}

// War declared, both sides on the front for a month (the AI mans its side
// at the month), then the player attacks.
function openWar(
  c: ReturnType<typeof twoNations>,
  posture: "attack" | "breakthrough" = "attack",
) {
  c.sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
  c.ticks(1); // the geometry appears with the first tick
  sendAll(c.sim, "defend");
  c.days(32);
  sendAll(c.sim, posture);
}

describe("front geometry", () => {
  const grid = (
    width: number,
    height: number,
    owner: (x: number, y: number) => number,
  ) => ({
    width,
    height,
    ownerAt: (t: number) => owner(t % width, Math.floor(t / width)),
    terrainAt: (t: number) =>
      t % width === 4 ? ("mountain" as const) : ("plains" as const),
  });

  it("the front is the tiles of both sides that face each other", () => {
    const g = grid(10, 3, (x) => (x < 5 ? 1 : 2));
    const all = Array.from({ length: 30 }, (_, i) => i);
    const line = frontTiles(g, all, 1, 2);
    expect(line).toEqual([4, 5, 14, 15, 24, 25]);
  });

  it("cuts a line into segments of about the given size, along the line", () => {
    const g = grid(10, 20, (x) => (x < 5 ? 1 : 2));
    const all = Array.from({ length: 200 }, (_, i) => i);
    const line = frontTiles(g, all, 1, 2); // 40 tiles
    const segments = segmentFront(g, line, 10);
    expect(segments).toHaveLength(4);
    expect(segments.map((s) => s.tiles.length)).toEqual([10, 10, 10, 10]);
    // Along the line: every segment is a contiguous stretch of rows.
    for (const s of segments) {
      const rows = s.tiles.map((t) => Math.floor(t / 10));
      expect(Math.max(...rows) - Math.min(...rows)).toBeLessThanOrEqual(5);
    }
    expect(segments[0].terrain.mountain).toBeCloseTo(0.5, 9);
    expect(segments[0].owned).toEqual({ 1: 5, 2: 5 });
  });

  it("captures the tiles with the most winner neighbours first, then their neighbours", () => {
    const owners = new Map<number, number>();
    const g = {
      width: 6,
      height: 3,
      ownerAt: (t: number) => owners.get(t) ?? (t % 6 < 3 ? 1 : 2),
      terrainAt: () => "plains" as const,
    };
    const line = frontTiles(
      g,
      Array.from({ length: 18 }, (_, i) => i),
      1,
      2,
    );
    const taken = captureAlong(g, line, 1, 2, 4, (t) => owners.set(t, 1));
    expect(taken).toHaveLength(4);
    // The first column of BBB (x = 3) goes first.
    expect(taken.slice(0, 3).every((t) => t % 6 === 3)).toBe(true);
    expect(taken[3] % 6).toBe(4);
  });
});

describe("fronts and resolution", () => {
  it("a war without orders is static: fronts exist, nobody moves, nobody dies", () => {
    const { sim, ticks, tiles } = twoNations();
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    // J7: the defender's AI decides within the day (its update comes
    // forward); until then nobody has orders.
    ticks(19);
    const view = sim.read();
    expect(view.fronts).toHaveLength(1);
    expect(view.fronts[0].id).toBe("AAA|BBB");
    expect(view.fronts[0].segments).toHaveLength(2);
    expect(tiles("AAA")).toBe(1200);
    expect(view.military.nations.AAA.losses).toBe(0);
  });

  it("an attack that outweighs the defence takes tiles, costs both sides men and equipment, and scores", () => {
    const c = twoNations({ personnel: { AAA: 300_000, BBB: 60_000 } });
    const { sim, ticks, tiles, world } = c;
    openWar(c);
    ticks(40); // two game days
    const view = sim.read();
    const segment = view.fronts[0].segments[0];
    expect(segment.sides.AAA.attacking).toBe(true);
    expect(segment.sides.BBB.divisions).toBeGreaterThan(0);
    expect(segment.ratio).toBeGreaterThan(1.2);
    expect(tiles("AAA")).toBeGreaterThan(1200);
    expect(tiles("BBB")).toBe(2400 - tiles("AAA"));
    const war = view.diplomacy.wars[0];
    expect(war.tilesTaken.AAA).toBe(tiles("AAA") - 1200);
    expect(war.score.AAA).toBeGreaterThan(war.score.BBB);
    expect(view.military.nations.AAA.losses).toBeGreaterThan(0);
    expect(view.military.nations.BBB.losses).toBeGreaterThan(
      view.military.nations.AAA.losses,
    );
    const front = view.military.nations.AAA.divisions[0];
    expect(front.men).toBeLessThan(15000);
    expect(front.equipment).toBeLessThan(1);
    // Taken tiles are tagged contested; the rest is not.
    const taken = [...Array(2400).keys()].filter(
      (t) => world.ownerOf(t) === "AAA" && t % 60 >= 30,
    );
    expect(taken.length).toBe(tiles("AAA") - 1200);
    expect(taken.every((t) => world.isContested(t))).toBe(true);
    expect(world.isContested(0)).toBe(false);
  });

  it("terrain and structures multiply the defence: mountains and a fortified line hold better", () => {
    // J7: the defender mobilises from the first day of the war (weekly
    // updates at war), no longer on the 1st of the month: a stronger
    // attacker than at the J6.
    const plain = twoNations({ personnel: { AAA: 260_000, BBB: 100_000 } });
    const rough = twoNations({ personnel: { AAA: 260_000, BBB: 100_000 } });
    for (let y = 0; y < 40; y++) {
      rough.world.setTerrain(y * 60 + 30, "mountain");
    }
    rough.world.setStructure(35, 5); // a defence post near the top rows
    for (const c of [plain, rough]) {
      openWar(c);
      c.ticks(60);
    }
    expect(rough.tiles("AAA")).toBeLessThan(plain.tiles("AAA"));
    expect(rough.tiles("AAA")).toBeGreaterThan(1200);
    const [top] = rough.sim.read().fronts[0].segments;
    expect(top.terrain.mountain).toBeGreaterThan(0.3);
  });

  it("breakthrough moves faster and bleeds more", () => {
    const steady = twoNations({ personnel: { AAA: 300_000, BBB: 100_000 } });
    const bold = twoNations({ personnel: { AAA: 300_000, BBB: 100_000 } });
    openWar(steady, "attack");
    openWar(bold, "breakthrough");
    steady.ticks(40);
    bold.ticks(40);
    expect(bold.tiles("AAA")).toBeGreaterThan(steady.tiles("AAA"));
    expect(bold.sim.read().military.nations.AAA.losses).toBeGreaterThan(
      steady.sim.read().military.nations.AAA.losses,
    );
  });

  it("the defending AI mans the front, mobilises, and attacks a segment where it outweighs the enemy", () => {
    const { sim, days } = twoNations({
      personnel: { AAA: 30_000, BBB: 140_000 },
    });
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    // J7: the nation attacked decides within the day (its update comes
    // forward), no longer on the 1st of the month.
    days(2);
    expect(sim.read().schedule.nations.BBB.last).toBeGreaterThan(0);
    const bbb = sim.read().military.nations.BBB;
    expect(bbb.divisions.every((d) => d.front === "AAA|BBB")).toBe(true);
    expect(bbb.divisions.some((d) => d.posture === "attack")).toBe(true);
    expect(bbb.conscription).toBe("partial");
    days(10);
    expect(
      sim.read().nations.find((n) => n.id === "BBB")!.tileCount,
    ).toBeGreaterThan(1200);
  });

  it("losses, exhaustion and retreat: the loser's youth and workers suffer, the war weighs on opinion", () => {
    const c = twoNations({
      personnel: { AAA: 400_000, BBB: 100_000 },
      slow: true,
      width: 200,
      height: 100,
    });
    const { sim, days } = c;
    openWar(c);
    const youthBefore = sim.read().politics.AAA.groups!.youth;
    days(62);
    const view = sim.read();
    expect(view.military.nations.BBB.exhaustion).toBeGreaterThan(0.02);
    expect(view.military.nations.AAA.exhaustion).toBeGreaterThan(0);
    expect(view.diplomacy.wars[0].retreatMonths.BBB).toBeGreaterThanOrEqual(1);
    expect(view.diplomacy.wars[0].retreatMonths.AAA).toBe(0);
    expect(view.politics.AAA.groups!.youth).toBeLessThan(youthBefore);
  });
});

describe("peace", () => {
  const bigWar = () =>
    twoNations({
      personnel: { AAA: 400_000, BBB: 100_000 },
      slow: true,
      width: 200,
      height: 100,
    });

  it("the AI accepts a ceasefire when it is retreating; the war ends and the divisions go home", () => {
    const c = bigWar();
    const { sim, days, events } = c;
    openWar(c);
    days(31 * 7);
    expect(
      sim.read().diplomacy.wars[0].retreatMonths.BBB,
    ).toBeGreaterThanOrEqual(6);
    sim.apply({
      type: "propose-peace",
      war: "war-1",
      to: "BBB",
      terms: {
        kind: "ceasefire",
        reparationsPctGdp: 0,
        reparationYears: 0,
        maxDivisions: null,
      },
    });
    days(1);
    expect(sim.read().diplomacy.wars).toEqual([]);
    expect(events.map((e) => e.type)).toContain("peace-signed");
    expect(
      sim
        .read()
        .journal.some(
          (j) => j.kind === "peace-signed" && j.params.terms === "ceasefire",
        ),
    ).toBe(true);
    days(1);
    expect(
      sim.read().military.nations.AAA.divisions.every((d) => d.front === null),
    ).toBe(true);
    expect(sim.read().fronts).toEqual([]);
  });

  it("a cession the war score cannot pay for is refused; an affordable one is signed with reparations and a cap", () => {
    const c = bigWar();
    const { sim, days } = c;
    openWar(c);
    days(31 * 7);
    const greedy = {
      kind: "cession" as const,
      reparationsPctGdp: 0.05,
      reparationYears: 50,
      maxDivisions: 0,
    };
    sim.apply({
      type: "propose-peace",
      war: "war-1",
      to: "BBB",
      terms: greedy,
    });
    expect(sim.read().diplomacy.wars).toHaveLength(1);
    expect(sim.read().journal.some((j) => j.kind === "peace-refused")).toBe(
      true,
    );
    const fair = {
      kind: "cession" as const,
      reparationsPctGdp: 0.01,
      reparationYears: 2,
      maxDivisions: 2,
    };
    sim.apply({ type: "propose-peace", war: "war-1", to: "BBB", terms: fair });
    const d = sim.read().diplomacy;
    expect(d.wars).toEqual([]);
    // J6: the cession settles the land BBB gave up: BBB claims nothing AAA
    // holds any more; the winner's claims are untouched.
    const { world } = c;
    expect(world.claimHolders("homeland:BBB").get("AAA") ?? 0).toBe(0);
    let taken = 0;
    for (let tile = 0; tile < 200 * 100; tile++) {
      if (tile % 200 >= 100 && world.ownerOf(tile) === "AAA") {
        taken++;
        expect(world.isSettled(tile)).toBe(true);
      }
    }
    expect(taken).toBeGreaterThan(0);
    expect(d.claims).toEqual([]);
    expect(d.reparations).toEqual([
      {
        from: "BBB",
        to: "AAA",
        pctGdp: 0.01,
        until: expect.stringMatching(/^\d{4}/),
      },
    ]);
    expect(d.demilitarized).toEqual([{ nation: "BBB", maxDivisions: 2 }]);
    expect(
      sim.read().military.nations.BBB.divisions.length,
    ).toBeLessThanOrEqual(2);
    // Reparations flow in the next budget.
    const before = sim.read().economies.AAA.revenue;
    days(31);
    expect(sim.read().economies.AAA.revenue).toBeGreaterThan(before);
    // Both remember the war (J6).
    expect(d.warMemory.AAA).toBeGreaterThan(0);
    expect(d.warMemory.BBB).toBeGreaterThan(0);
  });

  it("annexation: every tile goes to the winner, the loser survives in exile", () => {
    const c = bigWar();
    const { sim, days, tiles, events, half } = c;
    openWar(c);
    days(31 * 7);
    // Annexation costs 100 score points: give the offer what it needs.
    const war = sim.read().diplomacy.wars[0];
    (war.score as Record<string, number>).AAA = 1000;
    sim.apply({
      type: "propose-peace",
      war: "war-1",
      to: "BBB",
      terms: {
        kind: "annexation",
        reparationsPctGdp: 0,
        reparationYears: 0,
        maxDivisions: null,
      },
    });
    days(1);
    expect(tiles("AAA")).toBe(2 * half);
    expect(tiles("BBB")).toBe(0);
    const bbb = sim.read().nations.find((n) => n.id === "BBB")!;
    expect(bbb.status).toBe("exiled");
    expect(events.map((e) => e.type)).toContain("annexation");
    expect(sim.read().diplomacy.wars).toEqual([]);
  });

  it("an AI that is retreating offers a ceasefire to the player, who answers by command", () => {
    const c = bigWar();
    const { sim, days, events } = c;
    openWar(c);
    days(31 * 8);
    const offered = events.filter((e) => e.type === "peace-offered");
    expect(offered.length).toBeGreaterThan(0);
    const war = sim.read().diplomacy.wars[0];
    expect(war.offers.length).toBeGreaterThan(0);
    expect(war.offers[0]).toMatchObject({ from: "BBB", to: "AAA" });
    sim.apply({ type: "answer-peace", offer: war.offers[0].id, accept: false });
    expect(sim.read().diplomacy.wars[0].offers).toEqual([]);
    expect(sim.read().journal.some((j) => j.kind === "peace-refused")).toBe(
      true,
    );
    days(31);
    const again = sim.read().diplomacy.wars[0].offers;
    expect(again.length).toBeGreaterThan(0);
    sim.apply({ type: "answer-peace", offer: again[0].id, accept: true });
    expect(sim.read().diplomacy.wars).toEqual([]);
  });
});

describe("the months of a war (J7)", () => {
  it("a war closes its month on its anniversary and gives the tiles each side gained in it", () => {
    const war = {
      id: "w",
      aggressors: ["AAA"],
      defenders: ["BBB"],
      casusBelli: null,
      since: "2026-01-10",
      declaredInCampaign: true,
      ledgerOn: "2026-02-10",
      score: {},
      retreatMonths: {},
      tilesTaken: {},
      monthlyTiles: { AAA: 40, BBB: -40 },
      offers: [],
      losses: { AAA: 1000, BBB: 2500 },
      claims: [],
    };
    const diplomacy = { wars: [war] } as unknown as Parameters<
      typeof stepWarLedgers
    >[0];
    expect(stepWarLedgers(diplomacy, "2026-02-09")).toEqual([]);
    const [month] = stepWarLedgers(diplomacy, "2026-02-10");
    expect(month.tiles).toEqual({ AAA: 40, BBB: -40 });
    expect(war.monthlyTiles).toEqual({ AAA: 0, BBB: 0 });
    expect(war.retreatMonths).toEqual({ AAA: 0, BBB: 1 });
    expect(war.ledgerOn).toBe("2026-03-10");
  });
});

describe("saves", () => {
  it("a war in progress survives a snapshot and a restore byte for byte", () => {
    const c = twoNations({ personnel: { AAA: 300_000, BBB: 100_000 } });
    const { sim, ticks, sheets } = c;
    openWar(c);
    ticks(30);
    const saved = sim.snapshot();
    const world2 = new MemoryWorld(60, 40);
    const config = quietConfig();
    config.war.segmentTiles = 40;
    config.logistics.base = 1000;
    const sim2 = new VeritableSimImpl({
      config,
      world: world2,
      data: testSimData(["AAA", "BBB"]),
      nationData: (id) => sheets.get(id),
      scenario: testScenario(["AAA", "BBB"]),
    });
    sim2.restore(saved);
    expect(encodeSave(sim2.snapshot())).toEqual(encodeSave(saved));
    // Played on by whole days, both read the same fronts off the same tiles
    // at every day start: identical. (Within a day the saved campaign keeps
    // the segments it read at the day start while the reloaded one reads
    // them again, so tick-level play can differ until the next day.)
    for (let i = 0; i < 3; i++) {
      sim.advance(DAY);
      sim2.advance(DAY);
    }
    expect(encodeSave(sim2.snapshot())).toEqual(encodeSave(sim.snapshot()));
  });
});
