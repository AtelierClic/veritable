import { loadVeritableConfig } from "../../data/loadConfig";
import { VeritableConfig } from "../../data/schemas/config";
import { NationData } from "../../data/schemas/nation";
import { War } from "../../data/schemas/save";
import { buildContext } from "../economy/context";
import { MemoryWorld } from "../testing/MemoryWorld";
import { testNation, testScenario } from "../testing/nations";
import { testSimData } from "../testing/simData";
import { SimEvent } from "../VeritableSim";
import { VeritableSimImpl } from "../VeritableSimImpl";
import { homelandRegion } from "../war/claimTiles";
import { recordWarOutcome } from "./claims";
import {
  decayWarMemory,
  initDiplomacy,
  rememberWar,
  warMemoryOf,
} from "./diplomacy";

const DAY = 1440;
const W = 40;
const H = 20;

function quietConfig(): VeritableConfig {
  const config = structuredClone(loadVeritableConfig());
  config.economy.growth.noiseMonthlySd = 0;
  config.economy.rowSupplyNoise.monthlySd = 0;
  return config;
}

// AAA holds the west half, BBB the east half. AAA claims "strip", the four
// columns of BBB along the border; BBB is played by nobody (autopilot off:
// AAA is the player and declares by command).
function claimWorld() {
  const world = new MemoryWorld(W, H);
  const strip: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const tile = y * W + x;
      world.setOwner(tile, x < W / 2 ? "AAA" : "BBB");
      if (x >= W / 2 && x < W / 2 + 4) strip.push(tile);
    }
  }
  world.setClaims(new Map([["strip", Uint32Array.from(strip)]]));
  const sheets = new Map<string, NationData>(
    ["AAA", "BBB"].map((id) => [id, testNation(id)]),
  );
  const scenario = {
    ...testScenario(["AAA", "BBB"]),
    contested: [
      {
        region: "strip",
        controller: "BBB",
        claimants: ["AAA"],
        recognizedBy: [],
      },
    ],
  };
  const config = quietConfig();
  const sim = new VeritableSimImpl({
    config,
    world,
    data: testSimData(["AAA", "BBB"]),
    nationData: (id) => sheets.get(id),
    scenario,
  });
  sim.init(scenario, 3);
  const events: SimEvent[] = [];
  const days = (n: number) => {
    for (let d = 0; d < n; d++) {
      events.push(...sim.advance(DAY).filter((e) => e.type !== "day-started"));
    }
  };
  return { sim, world, strip, events, days, config };
}

// The claim rules alone, on a context and a diplomacy without a world.
function unit() {
  const config = quietConfig();
  const sheets = ["AAA", "BBB"].map((id) => testNation(id));
  const ctx = buildContext(config, testSimData(["AAA", "BBB"]), sheets);
  const scenario = {
    ...testScenario(["AAA", "BBB"]),
    contested: [
      {
        region: "strip",
        controller: "BBB",
        claimants: ["AAA"],
        recognizedBy: [],
      },
    ],
  };
  const state = initDiplomacy(ctx, scenario);
  const war: War = {
    id: "war-1",
    aggressors: ["AAA"],
    defenders: ["BBB"],
    casusBelli: "contested-territory",
    since: "2026-01-01",
    declaredInCampaign: true,
    score: { AAA: 0, BBB: 0 },
    retreatMonths: { AAA: 0, BBB: 0 },
    tilesTaken: { AAA: 0, BBB: 0 },
    monthlyTiles: { AAA: 0, BBB: 0 },
    offers: [],
    losses: { AAA: 20_000, BBB: 5_000 },
    claims: ["strip"],
  };
  return { ctx, state, war, config };
}

describe("claims", () => {
  it("a territorial casus belli holds while the target holds claimed tiles, read on the map", () => {
    const { sim, world, strip } = claimWorld();
    expect(sim.read().casusBelli.BBB).toContain("contested-territory");
    expect(world.claimHolders("strip").get("BBB")).toBe(strip.length);
    // AAA takes the whole strip: nothing left to claim from BBB.
    for (const tile of strip) world.setOwner(tile, "AAA");
    expect(world.claimHolders("strip").get("BBB") ?? 0).toBe(0);
    sim.apply({ type: "set-speed", speed: 1 });
    expect(sim.read().casusBelli.BBB).not.toContain("contested-territory");
  });

  it("a war declared on a claim is fought on it", () => {
    const { sim } = claimWorld();
    sim.apply({
      type: "declare-war",
      target: "BBB",
      casusBelli: "contested-territory",
    });
    const war = sim.read().diplomacy.wars[0];
    expect(war.claims).toEqual(["strip"]);
    expect(war.losses).toEqual({ AAA: 0, BBB: 0 });
  });

  it("every second white or lost war on a claim halves its weight, the third gives it up (J6c); a won one leaves it", () => {
    // White: a ceasefire without net gain of land (here none taken).
    const { ctx, state, war } = unit();
    expect(recordWarOutcome(ctx, state, war, null)).toEqual([]);
    const claim = () => state.claims.find((c) => c.region === "strip")!;
    expect(claim()).toMatchObject({ failures: 1, weight: 1 });
    expect(recordWarOutcome(ctx, state, war, "BBB")).toEqual([
      { claimant: "AAA", region: "strip", weight: 0.5 },
    ]);
    expect(claim()).toMatchObject({ failures: 2, weight: 0.5 });
    expect(recordWarOutcome(ctx, state, war, "AAA")).toEqual([]);
    expect(claim()).toMatchObject({ failures: 2, weight: 0.5 });
    expect(recordWarOutcome(ctx, state, war, null)).toEqual([
      { claimant: "AAA", region: "strip", weight: 0 },
    ]);
    expect(claim()).toMatchObject({ failures: 3, weight: 0 });
    expect(recordWarOutcome(ctx, state, war, null)).toEqual([]);
    expect(claim()).toMatchObject({ failures: 4, weight: 0 });
    // A ceasefire after taking more land than it lost is no failure.
    war.tilesTaken = { AAA: 300, BBB: 20 };
    recordWarOutcome(ctx, state, war, null);
    expect(claim()).toMatchObject({ failures: 4, weight: 0 });
  });

  it("war memory: losses over population plus years of war, halving every eight years", () => {
    const { ctx, state, war, config } = unit();
    rememberWar(ctx, state, war, "2028-01-01");
    const m = config.ai.nations.war.memory;
    const population = ctx.sheet("AAA").population.value;
    const expected = (m.lossesWeight * 20_000) / population + m.yearsWeight * 2;
    expect(warMemoryOf(state, "AAA")).toBeCloseTo(expected, 9);
    for (let month = 0; month < 12 * m.halfLifeYears; month++) {
      decayWarMemory(ctx, state);
    }
    expect(warMemoryOf(state, "AAA")).toBeCloseTo(expected / 2, 9);
    for (let month = 0; month < 12 * 200; month++) decayWarMemory(ctx, state);
    expect(state.warMemory).toEqual({});
  });

  it("a nation claims its homeland wherever another holds it, until a treaty settles it", () => {
    const { world } = claimWorld();
    // AAA takes three tiles of BBB's first-day land.
    for (const tile of [W / 2 + 10, W + W / 2 + 10, 2 * W + W / 2 + 10]) {
      world.setOwner(tile, "AAA");
    }
    expect(world.claimHolders(homelandRegion("BBB")).get("AAA")).toBe(3);
    expect(world.settleClaims("AAA", "BBB", [])).toBe(3);
    expect(world.claimHolders(homelandRegion("BBB")).get("AAA") ?? 0).toBe(0);
    // The settled tiles survive a save.
    const { world: saved, grid } = world.capture(["AAA", "BBB"]);
    const copy = new MemoryWorld(W, H);
    copy.setClaims(new Map());
    copy.restore(["AAA", "BBB"], saved, grid);
    expect(copy.isSettled(W / 2 + 10)).toBe(true);
    expect(copy.isSettled(W / 2 + 11)).toBe(false);
  });
});
