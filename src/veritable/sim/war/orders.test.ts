import { loadVeritableConfig } from "../../data/loadConfig";
import { Bloc } from "../../data/schemas/bloc";
import { NationData } from "../../data/schemas/nation";
import { DiplomacyState } from "../../data/schemas/save";
import { Scenario } from "../../data/schemas/scenario";
import { airSuperiority } from "../air/air";
import { declarationRelationsCost, setRelation } from "../diplomacy/diplomacy";
import { MemoryWorld } from "../testing/MemoryWorld";
import { testNation, testScenario } from "../testing/nations";
import { testBloc, testSimData } from "../testing/simData";
import { VeritableSimImpl } from "../VeritableSimImpl";
import { captureAlong, frontTiles } from "./geometry";

// The orders of the action menu of the map (J7b), which the screens give
// too: the preview of a declaration of war, an air strike, the fleet in a
// sea zone, the point a breakthrough goes towards.

const TICK = 72;
const DAY = 1440;

// AAA (the player) west, BBB east, a land border between them; CCC shares
// a union with BBB and guarantees it; the sea "north" off both.
const BLOCS: Bloc[] = [
  testBloc({
    id: "union",
    type: "economic-union",
    members: [
      { nation: "BBB", status: "full" },
      { nation: "CCC", status: "full" },
    ],
  }),
];

function campaign(
  options: {
    air?: Record<string, number>;
    width?: number;
    wars?: Scenario["wars"];
    // AAA's last election long past, suspended by a war at home.
    electionDue?: boolean;
  } = {},
) {
  const width = options.width ?? 60;
  const height = 40;
  const config = structuredClone(loadVeritableConfig());
  config.economy.growth.noiseMonthlySd = 0;
  config.economy.rowSupplyNoise.monthlySd = 0;
  config.politics.aiShock.sd = 0;
  config.politics.coups.militaryScale = 0;
  config.war.segmentTiles = 40;
  config.logistics.base = 1000;
  const world = new MemoryWorld(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      world.setOwner(y * width + x, x < width / 2 ? "AAA" : "BBB");
    }
  }
  world.setClaims(new Map());
  world.setNaval(
    {
      coast: { AAA: ["north"], BBB: ["north"], CCC: [] },
      ports: { AAA: [], BBB: [], CCC: [] },
      ships: {},
    },
    { AAA: "north", BBB: "north" },
  );
  const ids = ["AAA", "BBB", "CCC"];
  const sheets = new Map<string, NationData>(
    ids.map((id) => {
      const sheet = testNation(
        id,
        options.electionDue === true && id === "AAA"
          ? { lastElection: "2019-04-21", electionsSuspendedAtWarAtHome: true }
          : {},
      );
      sheet.military.activePersonnel = id === "AAA" ? 300_000 : 100_000;
      sheet.military.airPower = options.air?.[id] ?? 0.5;
      sheet.military.navalPower = 0.5;
      return [id, sheet];
    }),
  );
  const scenario = { ...testScenario(ids), wars: options.wars ?? [] };
  const sim = new VeritableSimImpl({
    config,
    world,
    data: {
      ...testSimData(ids, {
        blocs: BLOCS,
        landNeighbours: [["AAA", "BBB"]],
        seas: [
          { id: "north", name: "sea.north", lon: 0, lat: 0 },
          { id: "south", name: "sea.south", lon: 0, lat: 1 },
        ],
      }),
      guarantees: [
        { guarantor: "CCC", protected: "BBB", probability: 0.5, note: "" },
      ],
    },
    nationData: (id) => sheets.get(id),
    scenario,
  });
  sim.init(scenario, 5);
  const diplomacy = (sim as unknown as { diplomacy: DiplomacyState }).diplomacy;
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) sim.advance(TICK);
  };
  const days = (n: number) => {
    for (let i = 0; i < n; i++) sim.advance(DAY);
  };
  return { sim, world, config, diplomacy, ticks, days, width };
}

describe("the preview of a declaration of war (J7b)", () => {
  it("is what the AI weighs: sanctions expected, the coalition bound to the target, the cost in relations", () => {
    const { sim, diplomacy } = campaign();
    setRelation(diplomacy, "AAA", "CCC", -20);
    const preview = sim.warPreview("BBB", "none");
    // The target sanctions; CCC, in a bloc with it, falls under the mark.
    expect(preview.sanctioners).toEqual(["BBB", "CCC"]);
    expect(preview.sanctionsShare).toBeGreaterThan(0);
    expect(preview.sanctionsShare).toBeLessThanOrEqual(1);
    // CCC guarantees BBB.
    expect(preview.coalition).toEqual([{ nation: "CCC", probability: 0.5 }]);
    const military = sim.read().military;
    const cost = declarationRelationsCost(
      (
        sim as unknown as {
          ctx: Parameters<typeof declarationRelationsCost>[0];
        }
      ).ctx,
      military,
      "AAA",
      "none",
    );
    expect(preview.relationsCost).toBeCloseTo(cost, 9);
    expect(preview.relationsCost).toBeGreaterThan(0);
    // Without casus belli, every month of the war too; with one, once.
    expect(preview.monthlyRelationsCost).toBe(preview.relationsCost);
    expect(sim.warPreview("BBB", "grievance").monthlyRelationsCost).toBe(0);
    // A friend of the player does not sanction it for a justified war.
    setRelation(diplomacy, "AAA", "CCC", 60);
    expect(sim.warPreview("BBB", "grievance").sanctioners).toEqual(["BBB"]);
    // Nothing changes by previewing.
    expect(sim.read().diplomacy.wars).toHaveLength(0);
  });
});

describe("air strikes ordered by the player (J7b)", () => {
  it("hit the enemy at once in proportion to air superiority, once every cooldownDays, and go to the journal", () => {
    const { sim, config, days } = campaign({ air: { AAA: 0.75, BBB: 0.25 } });
    expect(() => sim.apply({ type: "air-strike", target: "BBB" })).toThrow(
      /not an enemy/,
    );
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    days(1);
    const before = sim.read();
    const damage = before.economies.BBB.strikeDamage;
    const a = airSuperiority(before.military, "AAA", "BBB");
    sim.apply({ type: "air-strike", target: "BBB" });
    const after = sim.read();
    expect(after.economies.BBB.strikeDamage).toBeCloseTo(
      Math.min(1, damage + config.air.targetedShare * a),
      12,
    );
    expect(after.military.nations.AAA.airStrikes.BBB).toBe(before.date);
    const entry = after.journal.find((j) => j.kind === "air-strike");
    expect(entry?.nation).toBe("AAA");
    expect(entry?.params.target).toBe("BBB");
    expect(entry?.link).toMatch(/^war:/);
    // Not again before the cooldown.
    expect(() => sim.apply({ type: "air-strike", target: "BBB" })).toThrow(
      /next strike/,
    );
    days(config.air.cooldownDays - 1);
    expect(() => sim.apply({ type: "air-strike", target: "BBB" })).toThrow(
      /next strike/,
    );
    days(1);
    sim.apply({ type: "air-strike", target: "BBB" });
    expect(sim.read().military.nations.AAA.airStrikes.BBB).toBe(
      sim.read().date,
    );
  });
});

describe("the fleet of the player (J7b)", () => {
  it("goes to one sea zone, and home again", () => {
    const { sim, days } = campaign();
    days(1);
    expect(sim.read().naval.control.north.AAA).toBeGreaterThan(0);
    sim.apply({ type: "set-fleet", zone: "south" });
    let naval = sim.read().naval;
    expect(naval.deployments.AAA).toEqual({ south: 1 });
    // The control follows at once.
    expect(naval.control.south.AAA).toBeCloseTo(1, 9);
    expect(naval.control.north.AAA ?? 0).toBe(0);
    sim.apply({ type: "set-fleet", zone: null });
    naval = sim.read().naval;
    expect(naval.deployments.AAA).toBeUndefined();
    expect(naval.control.north.AAA).toBeGreaterThan(0);
    expect(() => sim.apply({ type: "set-fleet", zone: "nowhere" })).toThrow(
      /unknown sea zone/,
    );
  });
});

describe("the objective of a breakthrough (J7b)", () => {
  it("the tiles nearest the objective go first", () => {
    const owners = new Map<number, number>();
    const g = {
      width: 6,
      height: 6,
      ownerAt: (t: number) => owners.get(t) ?? (t % 6 < 3 ? 1 : 2),
      terrainAt: () => "plains" as const,
    };
    const line = frontTiles(
      g,
      Array.from({ length: 36 }, (_, i) => i),
      1,
      2,
    );
    // Towards the bottom right corner: the corner of the first column of
    // BBB, then straight on to the objective.
    const taken = captureAlong(g, line, 1, 2, 3, (t) => owners.set(t, 1), 35);
    expect(taken).toEqual([33, 34, 35]);
    // Without an objective, the J3 order.
    owners.clear();
    const plain = captureAlong(g, line, 1, 2, 3, (t) => owners.set(t, 1));
    expect(plain.every((t) => t % 6 === 3)).toBe(true);
  });

  it("a segment breaking through goes towards its objective; the order survives a save", () => {
    const run = (objective: boolean) => {
      const c = campaign();
      const { sim, ticks, days, width } = c;
      sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
      ticks(1);
      for (const d of sim.read().military.nations.AAA.divisions) {
        sim.apply({
          type: "assign-division",
          division: d.id,
          front: "AAA|BBB",
          segment: null,
        });
        sim.apply({ type: "set-posture", division: d.id, posture: "defend" });
      }
      days(32);
      const target = 38 * width + 50; // deep in the south of BBB
      for (const d of sim.read().military.nations.AAA.divisions) {
        sim.apply({
          type: "set-posture",
          division: d.id,
          posture: "breakthrough",
        });
      }
      if (objective) {
        for (const segment of sim.read().fronts[0].segments) {
          sim.apply({
            type: "set-objective",
            front: "AAA|BBB",
            segment: segment.index,
            tile: target,
          });
        }
      }
      ticks(60);
      const taken: number[] = [];
      for (let t = 0; t < width * 40; t++) {
        if (t % width >= width / 2 && c.world.ownerOf(t) === "AAA") {
          taken.push(t);
        }
      }
      const meanRow =
        taken.reduce((s, t) => s + Math.floor(t / width), 0) /
        Math.max(1, taken.length);
      return { sim, taken, meanRow };
    };
    const toward = run(true);
    const plain = run(false);
    expect(toward.taken.length).toBeGreaterThan(0);
    expect(plain.taken.length).toBeGreaterThan(0);
    expect(toward.meanRow).toBeGreaterThan(plain.meanRow + 3);
    const objectives = toward.sim.read().military.nations.AAA.objectives;
    expect(Object.keys(objectives).length).toBeGreaterThan(0);
    const snapshot = toward.sim.snapshot();
    expect(snapshot.military.nations.AAA.objectives).toEqual(objectives);
    // Removed on order.
    const key = Object.keys(objectives)[0];
    const [front, segment] = key.split("#");
    toward.sim.apply({
      type: "set-objective",
      front,
      segment: Number(segment),
      tile: null,
    });
    expect(
      toward.sim.read().military.nations.AAA.objectives[key],
    ).toBeUndefined();
  });
});

describe("the army of the player at war on the first day (J7b)", () => {
  const war: Scenario["wars"][number] = {
    id: "old-war",
    belligerents: [["BBB"], ["AAA"]],
    since: "2022-02-24",
    intensity: 0.8,
    fronts: [],
  };

  it("stands on its fronts, defending, once the fronts are known; once only", () => {
    const { sim, ticks } = campaign({ wars: [war] });
    const army = () => sim.read().military.nations.AAA.divisions;
    expect(army().length).toBeGreaterThan(0);
    expect(army().every((d) => d.front === null)).toBe(true);
    ticks(3);
    expect(
      army().every(
        (d) =>
          d.front === "AAA|BBB" && d.segment !== null && d.posture === "defend",
      ),
    ).toBe(true);
    // The player's orders stand: back in reserve, they stay there.
    for (const d of army()) {
      sim.apply({
        type: "assign-division",
        division: d.id,
        front: null,
        segment: null,
      });
    }
    ticks(40);
    expect(army().every((d) => d.front === null)).toBe(true);
  });

  it("its elections are suspended from the first tick, before the fronts are computed", () => {
    const { sim, ticks } = campaign({ wars: [war], electionDue: true });
    ticks(1);
    const kinds = sim.read().journal.map((j) => j.kind);
    expect(kinds).toContain("elections-suspended");
    expect(kinds).not.toContain("election-held");
    ticks(40);
    expect(sim.read().journal.map((j) => j.kind)).not.toContain(
      "election-held",
    );
  });

  it("a player at peace keeps its army in reserve", () => {
    const { sim, ticks } = campaign();
    ticks(40);
    expect(
      sim.read().military.nations.AAA.divisions.every((d) => d.front === null),
    ).toBe(true);
  });
});
