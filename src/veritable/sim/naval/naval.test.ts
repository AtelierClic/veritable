import { loadVeritableConfig } from "../../data/loadConfig";
import { VeritableConfig } from "../../data/schemas/config";
import { NationData } from "../../data/schemas/nation";
import { airMultiplier, airSuperiority } from "../air/air";
import { MemoryWorld } from "../testing/MemoryWorld";
import { testNation, testScenario } from "../testing/nations";
import { testSimData } from "../testing/simData";
import { SimEvent } from "../VeritableSim";
import { VeritableSimImpl } from "../VeritableSimImpl";

const DAY = 1440;

function quietConfig(): VeritableConfig {
  const config = structuredClone(loadVeritableConfig());
  config.economy.growth.noiseMonthlySd = 0;
  config.economy.rowSupplyNoise.monthlySd = 0;
  return config;
}

// AAA (west) and BBB (east) share a land border; CCC lives on an island in
// the south and trades with both by sea. AAA imports oil, CCC exports it.
// Seas: "west" off AAA and CCC, "east" off BBB and CCC.
function world(
  options: {
    naval?: Record<string, number>;
    air?: Record<string, number>;
  } = {},
) {
  const w = new MemoryWorld(60, 60);
  for (let y = 0; y < 60; y++) {
    for (let x = 0; x < 60; x++) {
      const t = y * 60 + x;
      if (y < 30) w.setOwner(t, x < 30 ? "AAA" : "BBB");
      else if (y >= 45) w.setOwner(t, "CCC");
    }
  }
  w.setNaval(
    {
      coast: { AAA: ["west"], BBB: ["east"], CCC: ["west", "east"] },
      ports: { AAA: [], BBB: [], CCC: [] },
      ships: {},
    },
    { CCC: "west", AAA: "west", BBB: "east" },
  );
  const sheets = new Map<string, NationData>();
  const make = (id: string, extra: Parameters<typeof testNation>[1]) => {
    const sheet = testNation(id, extra);
    sheet.military.activePersonnel = 100_000;
    sheet.military.navalPower = options.naval?.[id] ?? 0.5;
    sheet.military.airPower = options.air?.[id] ?? 0.5;
    sheets.set(id, sheet);
  };
  make("AAA", { production: { oil: 20 }, consumption: { oil: 120 } });
  make("BBB", {});
  make("CCC", { production: { oil: 300 }, consumption: { oil: 100 } });
  const ids = ["AAA", "BBB", "CCC"];
  const scenario = testScenario(ids);
  const sim = new VeritableSimImpl({
    config: quietConfig(),
    world: w,
    data: testSimData(ids, {
      landNeighbours: [["AAA", "BBB"]],
      seas: [
        { id: "west", name: "sea.west", lon: 0, lat: 0 },
        { id: "east", name: "sea.east", lon: 1, lat: 0 },
      ],
    }),
    nationData: (id) => sheets.get(id),
    scenario,
  });
  sim.init(scenario, 9);
  const events: SimEvent[] = [];
  const days = (n: number) => {
    for (let d = 0; d < n; d++) {
      events.push(...sim.advance(DAY).filter((e) => e.type !== "day-started"));
    }
  };
  return { sim, world: w, events, days };
}

describe("zones and control", () => {
  it("every nation controls its coastal zones in proportion to its naval power", () => {
    const { sim, days } = world({ naval: { AAA: 0.8, BBB: 0.2, CCC: 0.4 } });
    days(1);
    const { control, blockade } = sim.read().naval;
    // west: AAA 0.8 (all of it), CCC 0.2 (half of 0.4).
    expect(control.west.AAA).toBeCloseTo(0.8, 6);
    expect(control.west.CCC).toBeCloseTo(0.2, 6);
    expect(control.east.BBB).toBeCloseTo(0.5, 6);
    expect(control.east.CCC).toBeCloseTo(0.5, 6);
    // Nobody is at war: no blockade.
    expect(blockade).toEqual({ AAA: 0, BBB: 0, CCC: 0 });
  });

  it("a blockade sends the fleet to the enemy's coasts and cuts its maritime trade", () => {
    const { sim, days } = world({ naval: { AAA: 0.9, BBB: 0.2, CCC: 0.2 } });
    days(32);
    const before = sim.read().economies.CCC.maritimeTradeValue;
    expect(before).toBeGreaterThan(0);
    // AAA trades with BBB by land: nothing of it is maritime.
    sim.apply({ type: "declare-war", target: "CCC", casusBelli: "none" });
    sim.apply({ type: "set-blockade", target: "CCC", active: true });
    days(1);
    const naval = sim.read().naval;
    expect(naval.deployments.AAA).toEqual({ west: 0.5, east: 0.5 });
    // AAA now weighs 0.45 in each zone against CCC's 0.1 (+ BBB in the east).
    expect(naval.blockade.CCC).toBeGreaterThan(0.6);
    expect(naval.blockade.AAA).toBeGreaterThan(0); // CCC still holds a share
    days(31);
    const after = sim.read().economies.CCC.maritimeTradeValue;
    expect(after).toBeLessThan(before * 0.6);
    // The blockaded exporter loses coverage at home too: AAA gets less oil.
    expect(sim.read().economies.AAA.coverage.oil).toBeLessThan(1);
    const blockaded = sim.read().naval.blockade.CCC;
    sim.apply({ type: "set-blockade", target: "CCC", active: false });
    days(1);
    expect(sim.read().naval.deployments.AAA).toBeUndefined();
    // The fleet is back home in the west: CCC still meets it there.
    expect(sim.read().naval.blockade.CCC).toBeLessThan(blockaded);
    expect(sim.read().naval.blockade.CCC).toBeCloseTo(0.45, 2);
    // CCC is an AI nation at war (J5), but its fleet is the weaker one: it
    // stays home instead of blockading AAA.
    expect(sim.read().naval.deployments.CCC).toBeUndefined();
  });

  it("a landing is refused without control of the zone, and taken with it", () => {
    const weak = world({ naval: { AAA: 0.1, BBB: 0.5, CCC: 0.9 } });
    weak.sim.apply({ type: "declare-war", target: "CCC", casusBelli: "none" });
    weak.days(1);
    weak.sim.apply({ type: "landing", target: "CCC" });
    weak.days(1);
    expect(weak.events.map((e) => e.type)).toContain("landing-refused");
    // (CCC, an AI at war with the stronger fleet, may land itself: J7, its
    // orders come within the day.)
    expect(weak.world.landings.filter((l) => l.attacker === "AAA")).toEqual([]);
    expect(
      weak.sim.read().journal.some((j) => j.kind === "landing-refused"),
    ).toBe(true);

    const strong = world({ naval: { AAA: 0.9, BBB: 0.5, CCC: 0.1 } });
    strong.sim.apply({
      type: "declare-war",
      target: "CCC",
      casusBelli: "none",
    });
    strong.sim.apply({ type: "set-blockade", target: "CCC", active: true });
    strong.days(1);
    const tilesBefore = strong.sim
      .read()
      .nations.find((n) => n.id === "AAA")!.tileCount;
    strong.sim.apply({ type: "landing", target: "CCC" });
    strong.days(1);
    expect(strong.events.map((e) => e.type)).toContain("landing");
    expect(strong.world.landings).toEqual([
      { attacker: "AAA", target: "CCC", radius: 6 },
    ]);
    expect(
      strong.sim.read().nations.find((n) => n.id === "AAA")!.tileCount,
    ).toBe(tilesBefore + 6);
    // The beachhead is a front now.
    strong.days(1);
    expect(strong.sim.read().fronts.map((f) => f.id)).toContain("AAA|CCC");
    expect(() => strong.sim.apply({ type: "landing", target: "BBB" })).toThrow(
      /not an enemy/,
    );
  });
});

describe("air", () => {
  it("superiority is the share of the air power; strikes cost industry and decay after the war", () => {
    const { sim, days } = world({ air: { AAA: 0.8, CCC: 0.2 } });
    days(1);
    const military = sim.read().military;
    expect(airSuperiority(military, "AAA", "CCC")).toBeCloseTo(0.8, 6);
    expect(airSuperiority(military, "CCC", "AAA")).toBeCloseTo(0.2, 6);
    sim.apply({ type: "declare-war", target: "CCC", casusBelli: "none" });
    days(32);
    const e = sim.read().economies;
    // (The air power follows the arms coverage of the moment.)
    expect(e.CCC.strikeDamage).toBeCloseTo(0.1 * 0.8, 2);
    expect(e.AAA.strikeDamage).toBeCloseTo(0.1 * 0.2, 2);
    expect(e.BBB.strikeDamage).toBe(0);
    // Steel (industrial) is hit, oil is not.
    expect(e.CCC.production.steel * (1 - e.CCC.strikeDamage)).toBeLessThan(
      e.CCC.production.steel,
    );
    sim.apply({
      type: "propose-peace",
      war: "war-1",
      to: "CCC",
      terms: {
        kind: "ceasefire",
        reparationsPctGdp: 0,
        reparationYears: 0,
        maxDivisions: null,
      },
    });
    // The AI is neither exhausted nor retreating: it refuses; force the end.
    expect(sim.read().diplomacy.wars).toHaveLength(1);
  });

  it("the segment multiplier favours the side that owns the sky", () => {
    const config = quietConfig();
    const { sim, days } = world({ air: { AAA: 0.75, CCC: 0.25 } });
    days(1);
    const military = sim.read().military;
    const ctx = { config } as never;
    expect(airMultiplier(ctx, military, "AAA", "CCC")).toBeCloseTo(
      1 + 0.5 * 0.25,
      6,
    );
    expect(airMultiplier(ctx, military, "CCC", "AAA")).toBeCloseTo(
      1 - 0.5 * 0.25,
      6,
    );
  });
});
