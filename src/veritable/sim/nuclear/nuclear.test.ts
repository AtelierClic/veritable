import { loadVeritableConfig } from "../../data/loadConfig";
import { VeritableConfig } from "../../data/schemas/config";
import { NationData } from "../../data/schemas/nation";
import {
  DiplomacyState,
  PeaceOffer,
  PoliticsState,
  War,
} from "../../data/schemas/save";
import { decodeSave, encodeSave } from "../../save/serialize";
import { relation } from "../diplomacy/diplomacy";
import { MemoryWorld } from "../testing/MemoryWorld";
import {
  testNation,
  TestNationOptions,
  testScenario,
} from "../testing/nations";
import { testSimData } from "../testing/simData";
import { VeritableSimImpl } from "../VeritableSimImpl";
import { proposePeace } from "../war/peace";

const DAY = 1440;

function quietConfig(): VeritableConfig {
  const config = structuredClone(loadVeritableConfig());
  config.economy.growth.noiseMonthlySd = 0;
  config.economy.rowSupplyNoise.monthlySd = 0;
  config.politics.aiShock.sd = 0;
  // No coups or deaths to muddle the draws.
  config.politics.coups.militaryScale = 0;
  config.politics.leaders.deathBase = 0;
  // J7: the AI of a nation at war gives its orders within the day; these
  // tests are about the nuclear rules, the fronts do not move.
  config.war.v0 = 0;
  return config;
}

// A 4 x 4 world: AAA (the player) holds the first row, BBB the two middle
// rows, CCC the last one; capitals at tiles 1, 5 and 13. `apart`: the second
// row is nobody's (no front between AAA and BBB), BBB's capital at 9.
function campaign(
  options: Record<string, TestNationOptions>,
  config: VeritableConfig = quietConfig(),
  apart = false,
) {
  const ids = ["AAA", "BBB", "CCC"];
  const sheets = new Map<string, NationData>(
    ids.map((id) => [id, testNation(id, options[id] ?? {})]),
  );
  const world = new MemoryWorld(4, 4);
  for (let t = 0; t < 16; t++) {
    world.setOwner(
      t,
      t < 4 ? "AAA" : apart && t < 8 ? null : t < 12 ? "BBB" : "CCC",
    );
  }
  world.capitals.set("AAA", 1);
  world.capitals.set("BBB", apart ? 9 : 5);
  world.capitals.set("CCC", 13);
  const sim = new VeritableSimImpl({
    config,
    world,
    // J6c: CCC borders BBB (a coalition takes nations able to fight).
    data: testSimData(ids, { landNeighbours: [["BBB", "CCC"]] }),
    nationData: (id) => sheets.get(id),
  });
  sim.init(testScenario(ids), 11);
  const internals = sim as unknown as {
    politics: PoliticsState;
    diplomacy: DiplomacyState;
    sign(war: War, offer: PeaceOffer, date: string): void;
  };
  const days = (n: number) => {
    for (let d = 0; d < n; d++) sim.advance(DAY);
  };
  const aggressive = (id: string, value: number) => {
    internals.politics.nations[id].leader.traits.aggressiveness = value;
  };
  return { sim, world, internals, days, aggressive, config };
}

const nuclearBBB: Record<string, TestNationOptions> = {
  BBB: { nuclear: { warheads: 10, doctrine: "first-use-possible" } },
};

describe("threat level of a nuclear nation", () => {
  it("0 at peace, 1 at war, 2 when its capital is near a front or land was taken, 3 when its capital falls", () => {
    const { sim, world, internals, days } = campaign(nuclearBBB);
    days(1);
    expect(sim.read().nuclear.nations.BBB.threat).toBe(0);
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    days(1);
    expect(sim.read().nuclear.nations.BBB.threat).toBe(1);
    world.frontDistances.set("BBB", 10);
    days(1);
    expect(sim.read().nuclear.nations.BBB.threat).toBe(2);
    world.frontDistances.delete("BBB");
    internals.diplomacy.wars[0].tilesTaken.AAA = 3;
    days(1);
    expect(sim.read().nuclear.nations.BBB.threat).toBe(2);
    world.setOwner(5, "AAA"); // the capital
    days(1);
    expect(sim.read().nuclear.nations.BBB.threat).toBe(3);
  });

  it("3 when it lost more than half of its first-day land", () => {
    const { sim, world, days } = campaign(nuclearBBB);
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    for (const t of [4, 6, 7, 8, 9]) world.setOwner(t, "AAA");
    // Tile counts are refreshed at the end of each advance.
    days(2);
    expect(sim.read().nuclear.nations.BBB.threat).toBe(3);
  });
});

describe("the daily probability of a shot", () => {
  it("is base[doctrine][level] x (0.5 + aggressiveness) x deterrence", () => {
    const config = quietConfig();
    config.nuclear.base["first-use-possible"] = [0, 0.001, 0.01, 0.1];
    const { sim, days, aggressive } = campaign(nuclearBBB, config);
    aggressive("BBB", 0.3);
    days(1);
    expect(sim.read().nuclearRisk.BBB).toBe(0); // at peace
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    days(1);
    expect(sim.read().nuclearRisk.BBB).toBeCloseTo(0.001 * 0.8, 12);
  });

  it("is divided by ten when the target belongs to a collective-defence bloc with a nuclear member", () => {
    const config = quietConfig();
    config.nuclear.base["first-use-possible"] = [0, 0.001, 0.01, 0.1];
    const { sim, days, aggressive } = campaign(
      {
        AAA: { blocs: ["nato"] },
        BBB: { nuclear: { warheads: 10, doctrine: "first-use-possible" } },
        CCC: {
          blocs: ["nato"],
          nuclear: { warheads: 5, doctrine: "no-first-use" },
        },
      },
      config,
    );
    aggressive("BBB", 0.5);
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    days(1);
    expect(sim.read().nuclearRisk.BBB).toBeCloseTo(0.001 * 1 * 0.1, 12);
  });

  it("is nil at level 1 for a no-first-use doctrine: a hundred days of war, no shot", () => {
    const config = quietConfig();
    config.nuclear.base["no-first-use"] = [0, 0, 1, 1];
    const { sim, world, days, aggressive } = campaign(
      { BBB: { nuclear: { warheads: 10, doctrine: "no-first-use" } } },
      config,
    );
    aggressive("BBB", 1);
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    days(100);
    expect(world.launched).toEqual([]);
    expect(sim.read().nuclear.nations.BBB.warheads).toBe(10);
  });

  it("is nil for a nation that lost all its land (no vector), even at level 3 (J6)", () => {
    const config = quietConfig();
    config.nuclear.base["first-use-possible"] = [0, 1, 1, 1];
    const { sim, world, days, aggressive } = campaign(nuclearBBB, config);
    aggressive("BBB", 0.9);
    for (let t = 4; t < 12; t++) world.setOwner(t, "AAA");
    days(1);
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    days(3);
    expect(sim.read().nuclear.nations.BBB.threat).toBe(3);
    expect(sim.read().nuclearRisk.BBB).toBe(0);
    expect(world.launched).toEqual([]);
  });
});

describe("a shot and its consequences", () => {
  // AAA and BBB apart: no front, the first shot goes at the capital.
  function atWar(config = quietConfig()) {
    config.nuclear.base["first-use-possible"] = [0, 1, 1, 1];
    const c = campaign(nuclearBBB, config, true);
    c.aggressive("BBB", 0.9);
    c.sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    return c;
  }

  it("the AI fires at its enemy: every nation at -80 at most with it, sanctions by the AI nations, a pariah", () => {
    const { sim, world, internals, days } = atWar();
    days(1);
    expect(world.launched).toHaveLength(1);
    // No front in this world: straight at the capital, a hydrogen bomb.
    expect(world.launched[0]).toMatchObject({
      by: "BBB",
      target: "AAA",
      aim: { kind: "capital" },
      weapon: "hydrogen",
    });
    const view = sim.read();
    expect(view.nuclear.nations.BBB.warheads).toBe(9);
    expect(view.nuclear.strikes[0]).toMatchObject({
      by: "BBB",
      target: "AAA",
      aim: "capital",
      status: "in-flight",
      date: "2026-01-02",
    });
    expect(relation(internals.diplomacy, "BBB", "CCC")).toBeLessThanOrEqual(
      -80,
    );
    expect(relation(internals.diplomacy, "BBB", "AAA")).toBeLessThanOrEqual(
      -80,
    );
    // CCC (AI) sanctions the shooter; the player's nation decides for itself.
    expect(
      view.diplomacy.sanctions
        .filter((s) => s.against === "BBB")
        .map((s) => s.by),
    ).toEqual(["CCC"]);
    expect(view.diplomacy.pariahs).toEqual(["BBB"]);
    expect(view.journal.map((j) => j.kind)).toContain("nuclear-launch");
  });

  it("a warhead that bursts (J7c): the land keeps its owner; the dead come off the nation hit, its land is contaminated and heals", () => {
    const { sim, world, days, config } = atWar();
    // Tiles of 10 km; a million people in the capital of AAA, half a
    // million in each of its other tiles.
    world.tileKm = 10;
    const people = new Float32Array(16);
    for (let t = 0; t < 4; t++) people[t] = t === 1 ? 1e6 : 5e5;
    for (let t = 8; t < 16; t++) people[t] = 5e5;
    world.setPeople({ people, cities: [] });
    days(1);
    // One warhead only: BBB's arsenal is emptied after its first launch.
    sim.read().nuclear.nations.BBB.warheads = 0;
    // (The view shares the live state: a copy.)
    const before = structuredClone(sim.read().economies.AAA);
    const held = world.peopleHoldings().get("AAA")!;
    // The burst on the next day; its contamination in the nation's update
    // of the day after.
    days(2);
    const after = sim.read();
    const strike = after.nuclear.strikes[0];
    expect(strike).toMatchObject({ status: "detonated", tile: 1 });
    // The owner of the land never changes.
    for (let t = 0; t < 4; t++) expect(world.ownerOf(t)).toBe("AAA");
    // Ground zero is contaminated to 1, the next tiles less.
    expect(world.contaminationAt(1)).toBeGreaterThan(0.99);
    expect(world.contaminationAt(0)).toBeLessThan(world.contaminationAt(1));
    expect(world.contaminationAt(0)).toBeGreaterThan(0);
    // The dead: their share of the people AAA held, off its population.
    const dead = held - world.peopleHoldings().get("AAA")!;
    const share = dead / held;
    // Two thirds of the capital's million (its people within 5.6 km of
    // ground zero, 1 - (d / 7 km)² of them), a few in the next tiles.
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.35);
    expect(strike.deaths.AAA / before.population).toBeCloseTo(share, 6);
    // (Two days of growth of the player's nation between the readings.)
    expect(after.economies.AAA.population / before.population).toBeCloseTo(
      1 - share,
      3,
    );
    // GDP: the dead, then the contaminated share of the land left.
    const contaminated = after.economies.AAA.contamination;
    expect(contaminated).toBeGreaterThan(0.3);
    expect(
      after.economies.AAA.gdp / (before.gdp * (1 - share) * (1 - contaminated)),
    ).toBeCloseTo(1, 2);
    expect(after.journal.map((j) => j.kind)).toContain("nuclear-detonation");
    // A year later the land has healed by 2^(-1/6) (no spending, no aid).
    const level = world.contaminationAt(1);
    days(365);
    expect(world.contaminationAt(1) / level).toBeCloseTo(
      Math.pow(0.5, 1 / config.nuclear.contamination.halfLifeYears),
      2,
    );
    expect(sim.read().economies.AAA.contamination).toBeLessThan(contaminated);
  });

  it("an intercepted warhead changes nothing on the ground; one that cannot leave is still in the arsenal", () => {
    const { sim, world, days } = atWar();
    world.interceptNext = 1;
    days(2);
    expect(sim.read().nuclear.strikes[0].status).toBe("intercepted");
    expect(sim.read().journal.map((j) => j.kind)).toContain(
      "nuclear-intercepted",
    );
    expect(world.ownerOf(1)).toBe("AAA");

    const blocked = atWar();
    blocked.world.nukesBlocked = true;
    blocked.days(5);
    expect(blocked.sim.read().nuclear.nations.BBB.warheads).toBe(10);
    expect(blocked.sim.read().nuclear.strikes).toEqual([]);
  });

  it("a coalition may form against the shooter whatever its power and its side", () => {
    const config = quietConfig();
    config.diplomacy.coalition.monthlyProbability = 1;
    const { sim, days } = atWar(config);
    days(40);
    const war = sim.read().diplomacy.wars[0];
    // BBB is the defender here: CCC joins its aggressors, against it.
    expect(war.defenders).toEqual(["BBB"]);
    expect(war.aggressors).toContain("CCC");
  });
});

describe("the dead hand", () => {
  it("at the annexation of a nuclear nation it may strike the capital of the annexer; the land changes hands the next day", () => {
    const config = quietConfig();
    config.nuclear.deadHand["first-use-possible"] = 1;
    // BBB never fires on its own here.
    config.nuclear.base["first-use-possible"] = [0, 0, 0, 0];
    const { sim, world, internals, days, aggressive } = campaign(
      nuclearBBB,
      config,
    );
    aggressive("BBB", 0.9);
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    days(1);
    expect(sim.read().deadHand.BBB).toBe(1);
    const war = internals.diplomacy.wars[0];
    const offer = proposePeace(
      internals.diplomacy,
      war,
      "AAA",
      "BBB",
      {
        kind: "annexation",
        reparationsPctGdp: 0,
        reparationYears: 0,
        maxDivisions: null,
      },
      sim.read().date,
    );
    internals.sign(war, offer, sim.read().date);
    expect(world.launched).toEqual([
      expect.objectContaining({
        by: "BBB",
        target: "AAA",
        aim: { kind: "capital" },
      }),
    ]);
    expect(sim.read().diplomacy.pendingAnnexations).toHaveLength(1);
    expect(world.ownerOf(5)).toBe("BBB"); // not yet
    expect(sim.read().journal.map((j) => j.kind)).toContain("dead-hand");
    days(1);
    expect(sim.read().diplomacy.pendingAnnexations).toEqual([]);
    expect(world.ownerOf(6)).toBe("AAA");
    expect(sim.read().journal.map((j) => j.kind)).toContain("annexation");
  });
});

describe("the player's warheads and the save", () => {
  it("the player fires only at an enemy, with the confirmation; strikes in flight are lost on a reload", () => {
    const { sim, world, days } = campaign({
      AAA: { nuclear: { warheads: 3, doctrine: "no-first-use" } },
    });
    expect(() =>
      sim.apply({
        type: "nuclear-launch",
        target: "BBB",
        aim: "capital",
        confirmed: true,
      }),
    ).toThrow(/not at war/);
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    sim.apply({
      type: "nuclear-launch",
      target: "BBB",
      aim: "capital",
      confirmed: true,
    });
    expect(world.launched).toHaveLength(1);
    expect(sim.read().nuclear.nations.AAA.warheads).toBe(2);

    const save = decodeSave(encodeSave(sim.snapshot()));
    expect(save.nuclear.strikes[0].status).toBe("in-flight");
    const again = new VeritableSimImpl({
      config: quietConfig(),
      world: new MemoryWorld(4, 4),
      data: testSimData(["AAA", "BBB", "CCC"]),
      nationData: (id) =>
        testNation(
          id,
          id === "AAA"
            ? { nuclear: { warheads: 3, doctrine: "no-first-use" } }
            : {},
        ),
    });
    again.restore(save);
    expect(again.read().nuclear.strikes[0].status).toBe("lost");
    expect(again.read().nuclear.nations.AAA.warheads).toBe(2);
    days(1);
  });
});
