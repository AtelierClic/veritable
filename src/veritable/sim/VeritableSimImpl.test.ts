import { loadVeritableConfig } from "../data/loadConfig";
import { MemoryWorld } from "./testing/MemoryWorld";
import { testNation, testScenario } from "./testing/nations";
import { testSimData } from "./testing/simData";
import { VeritableSimImpl } from "./VeritableSimImpl";

const scenario = testScenario(["alpha", "beta"]);

function newGame() {
  const world = new MemoryWorld(8, 4);
  for (let t = 0; t < 16; t++) world.setOwner(t, "alpha");
  for (let t = 16; t < 28; t++) world.setOwner(t, "beta");
  world.setFallout(30, true);
  const sim = new VeritableSimImpl({
    nationData: testNation,
    data: testSimData(["alpha", "beta", "gamma"]),
    config: loadVeritableConfig(),
    world,
  });
  sim.init(scenario, 42);
  return { world, sim };
}

describe("VeritableSimImpl", () => {
  it("refuses to run before init", () => {
    const sim = new VeritableSimImpl({
      nationData: testNation,
      data: testSimData(["alpha", "beta", "gamma"]),
      config: loadVeritableConfig(),
      world: new MemoryWorld(1, 1),
    });
    expect(() => sim.read()).toThrow();
  });

  it("starts on the scenario date with nations bound to their tiles", () => {
    const { sim } = newGame();
    const view = sim.read();
    expect(view.date).toBe("2026-01-01");
    expect(view.playerNation).toBe("alpha");
    expect(view.nations.map((n) => [n.id, n.tileCount])).toEqual([
      ["alpha", 16],
      ["beta", 12],
    ]);
  });

  it("advances the calendar from game minutes only", () => {
    const { sim } = newGame();
    sim.advance(1439);
    expect(sim.read().date).toBe("2026-01-01");
    sim.advance(1);
    expect(sim.read().date).toBe("2026-01-02");
    sim.advance(1440 * 364);
    expect(sim.read().date).toBe("2027-01-01");
  });

  it("a nation with zero tiles survives, in exile, and can come back", () => {
    const { sim, world } = newGame();
    world.transferAll("beta", "alpha");

    const events = sim.advance(72);
    expect(events).toEqual([
      {
        type: "nation-status-changed",
        date: "2026-01-01",
        nation: "beta",
        from: "active",
        to: "exiled",
      },
    ]);

    // Ten years later it is still there.
    for (let month = 0; month < 120; month++) sim.advance(43_200);
    const beta = sim.read().nations.find((n) => n.id === "beta")!;
    expect(beta.tileCount).toBe(0);
    expect(beta.status).toBe("exiled");
    expect(sim.read().nations).toHaveLength(2);

    world.setOwner(0, "beta");
    expect(sim.advance(72)).toMatchObject([{ nation: "beta", to: "active" }]);
    expect(sim.read().journal.map((j) => j.kind)).toEqual([
      "campaign-started",
      "nation-status",
      "nation-status",
    ]);
  });

  it("the player's own nation survives zero tiles too", () => {
    const { sim, world } = newGame();
    world.transferAll("alpha", null);
    sim.advance(72);
    const view = sim.read();
    expect(view.playerNation).toBe("alpha");
    expect(view.nations[0].status).toBe("exiled");
  });

  it("applies and validates player commands", () => {
    const { sim } = newGame();
    sim.apply({ type: "set-speed", speed: 5 });
    expect(sim.read().speed).toBe(5);
    expect(() => sim.apply({ type: "set-speed", speed: 3 } as never)).toThrow();
  });

  it("snapshot -> restore -> snapshot is identical, in a fresh world", () => {
    const { sim, world } = newGame();
    sim.advance(100_000);
    world.transferAll("beta", "alpha");
    sim.advance(72);
    sim.apply({ type: "set-speed", speed: 2 });
    const saved = sim.snapshot();

    const world2 = new MemoryWorld(8, 4);
    const sim2 = new VeritableSimImpl({
      nationData: testNation,
      data: testSimData(["alpha", "beta", "gamma"]),
      config: loadVeritableConfig(),
      world: world2,
    });
    sim2.restore(saved);
    expect(sim2.snapshot()).toEqual(saved);
    expect(sim2.read()).toEqual(sim.read());

    // Both continue identically.
    world.setOwner(5, "beta");
    world2.setOwner(5, "beta");
    expect(sim2.advance(5000)).toEqual(sim.advance(5000));
    expect(sim2.snapshot()).toEqual(sim.snapshot());
  });

  it("a snapshot is detached from the live state", () => {
    const { sim } = newGame();
    const saved = sim.snapshot();
    sim.advance(1440 * 40);
    expect(saved.calendar.date).toBe("2026-01-01");
  });

  it("refuses a save of another schema version", () => {
    const { sim } = newGame();
    const saved = { ...sim.snapshot(), schemaVersion: 4 };
    expect(() => sim.restore(saved as never)).toThrow(/migrated/);
  });
});
