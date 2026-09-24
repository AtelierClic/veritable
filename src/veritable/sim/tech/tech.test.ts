import { loadVeritableConfig } from "../../data/loadConfig";
import { Bloc } from "../../data/schemas/bloc";
import { VeritableConfig } from "../../data/schemas/config";
import { NationData } from "../../data/schemas/nation";
import { TechNode, TechNodeSchema } from "../../data/schemas/tech";
import { decodeSave, encodeSave } from "../../save/serialize";
import { MemoryWorld } from "../testing/MemoryWorld";
import {
  testNation,
  TestNationOptions,
  testScenario,
} from "../testing/nations";
import { testBloc, testSimData } from "../testing/simData";
import { VeritableSimImpl } from "../VeritableSimImpl";
import { developmentIndex } from "./tech";

const DAY = 1440;

function quietConfig(): VeritableConfig {
  const config = structuredClone(loadVeritableConfig());
  config.economy.growth.noiseMonthlySd = 0;
  config.economy.rowSupplyNoise.monthlySd = 0;
  // Round numbers, whatever the calibration: 3 % of R&D = 30 points.
  config.tech.pointsPerRdPoint = 10;
  // Effects at face value.
  config.tech.effectScale = {
    capacity: 1,
    growth: 1,
    military: 1,
    research: 1,
  };
  return config;
}

const node = (n: Partial<TechNode> & Pick<TechNode, "id">): TechNode =>
  TechNodeSchema.parse({
    name: `tech.${n.id}.name`,
    description: `tech.${n.id}.desc`,
    domain: "energy",
    tier: 1,
    cost: 60,
    monthsMin: 1,
    requires: [],
    adoptedAbove: null,
    effects: [{ target: "growth", op: "add", value: 0.001 }],
    ...n,
  });

// AAA (rich, R&D ~ 3 %) and BBB (poor, R&D ~ 0.35 %).
const rich: TestNationOptions = {
  gdp: 3e12,
  spending: { research: 0.0105 },
};
const poor: TestNationOptions = { gdp: 0.1e12, spending: { research: 0.0012 } };

interface Internals {
  ctx: { techModifiers: Map<string, { growth: number; land: number }> };
}

function campaign(options: {
  nodes: TechNode[];
  nations?: Record<string, TestNationOptions>;
  blocs?: Bloc[];
  player?: string;
  config?: VeritableConfig;
}) {
  const nations = options.nations ?? { AAA: rich, BBB: poor };
  const ids = Object.keys(nations);
  const sheets = new Map<string, NationData>(
    ids.map((id) => [id, testNation(id, nations[id])]),
  );
  const scenario = {
    ...testScenario(ids),
    playerDefault: options.player ?? ids[0],
  };
  const deps = {
    config: options.config ?? quietConfig(),
    world: new MemoryWorld(4, 4),
    data: testSimData(ids, { tech: options.nodes, blocs: options.blocs }),
    nationData: (id: string) => sheets.get(id),
    scenario,
  };
  const sim = new VeritableSimImpl(deps);
  sim.init(scenario, 3);
  const months = (n: number) => {
    for (let i = 0; i < n; i++) {
      const month = sim.read().date.slice(0, 7);
      while (sim.read().date.slice(0, 7) === month) sim.advance(DAY);
    }
  };
  return { sim, months, sheets, deps };
}

describe("technology: the first day", () => {
  it("development index: GDP per head and R&D, each capped", () => {
    const config = loadVeritableConfig();
    const ctx = { config } as Parameters<typeof developmentIndex>[0];
    const sheet = testNation("AAA", rich); // 300 k$ a head, R&D 3 %
    expect(developmentIndex(ctx, sheet)).toBeCloseTo(
      0.6 + 0.4 * (0.03 / 0.035),
      3,
    );
  });

  it("a nation has the nodes adopted at its index or by name, with what they require; their effects are not applied again", () => {
    const { sim } = campaign({
      nodes: [
        node({ id: "base" }),
        node({ id: "wide", adoptedAbove: 0.5, requires: ["base"] }),
        node({ id: "named", adoptedBy: ["BBB"] }),
        node({ id: "new" }),
      ],
    });
    const tech = sim.read().tech.nations;
    expect(tech.AAA.done).toEqual(["base", "wide"]);
    expect(tech.BBB.done).toEqual(["named"]);
    expect(tech.AAA.baseline).toEqual(tech.AAA.done);
    const internals = sim as unknown as Internals;
    expect(internals.ctx.techModifiers.get("AAA")?.growth).toBe(0);
  });
});

describe("technology: research", () => {
  it("points from R&D; a node ends at its cost and after its minimum months; capacities once; modifiers in force", () => {
    const { sim, months } = campaign({
      nodes: [
        node({
          id: "grid",
          cost: 400,
          monthsMin: 2,
          effects: [
            { target: "production.electricity", op: "mul", value: 1.1 },
            { target: "growth", op: "add", value: 0.002 },
          ],
        }),
      ],
      player: "BBB",
    });
    const before = sim.read().economies.AAA.production.electricity;
    months(1);
    const view = sim.read();
    // AAA (AI) chose the node the first month; R&D 3 % = 30 points a month.
    expect(view.tech.nations.AAA.projects.map((p) => p.node)).toEqual(["grid"]);
    expect(view.tech.nations.AAA.pointsLastMonth).toBeCloseTo(30, 0);
    months(13);
    const after = sim.read();
    expect(after.tech.nations.AAA.done).toEqual(["grid"]);
    const done = after.journal.find((j) => j.kind === "tech-completed");
    expect(done?.params.node).toBe("grid");
    // 400 points at 30 a month from February 2026: the 14th month.
    expect(done?.date).toBe("2027-03-01");
    const growth = after.economies.AAA.production.electricity / before;
    expect(growth).toBeGreaterThan(1.09);
    const internals = sim as unknown as Internals;
    expect(internals.ctx.techModifiers.get("AAA")?.growth).toBeCloseTo(0.002);
  });

  it("a node costs less the more nations have it", () => {
    const { sim } = campaign({
      nodes: [node({ id: "known", adoptedBy: ["AAA"], cost: 100 })],
      player: "AAA",
    });
    // Half the nations have it: 100 x (1 - 0.5 x 0.5).
    expect(sim.read().techCosts.known).toBeCloseTo(75);
  });

  it("the player researches by command; three projects at most; a refusal says why", () => {
    const nodes = ["a", "b", "c", "d"].map((id) => node({ id }));
    nodes.push(node({ id: "e", requires: ["a"] }));
    nodes.push(node({ id: "f", bloc: "elsewhere" }));
    const { sim } = campaign({ nodes });
    for (const id of ["a", "b", "c"])
      sim.apply({ type: "tech-research", node: id });
    expect(sim.read().tech.nations.AAA.projects.length).toBe(3);
    expect(sim.read().techRefusals.d).toBe("full");
    // J6c: the lasting reason before the full queue.
    expect(sim.read().techRefusals.e).toBe("requires");
    expect(sim.read().techRefusals.f).toBe("bloc");
    expect(() => sim.apply({ type: "tech-research", node: "d" })).toThrow(
      /full/,
    );
    sim.apply({ type: "tech-cancel", node: "c" });
    expect(sim.read().techRefusals.d).toBeNull();
    expect(sim.read().techRefusals.e).toBe("requires");
  });

  it("a branch node: only for the members of the bloc, and it stops counting on leaving", () => {
    const club = testBloc({
      id: "club",
      members: [{ nation: "AAA", status: "full" }],
      exit: { delayMonths: 1, tradeCostPctGdp: 0 },
    });
    const { sim, months } = campaign({
      nodes: [
        node({
          id: "club-shield",
          bloc: "club",
          cost: 30,
          effects: [{ target: "military.land", op: "mul", value: 1.2 }],
        }),
      ],
      blocs: [club],
      player: "AAA",
    });
    expect(sim.read().techRefusals["club-shield"]).toBeNull();
    sim.apply({ type: "tech-research", node: "club-shield" });
    months(3);
    const internals = sim as unknown as Internals;
    expect(sim.read().tech.nations.AAA.done).toContain("club-shield");
    expect(internals.ctx.techModifiers.get("AAA")?.land).toBeCloseTo(1.2);
    sim.apply({ type: "bloc-leave", bloc: "club" });
    months(3);
    expect(internals.ctx.techModifiers.get("AAA")?.land).toBe(1);
  });

  it("a programme of a bloc adds a quarter to its members' points", () => {
    const nodes = [node({ id: "x", cost: 1000 })];
    const blocs = [
      testBloc({
        id: "club",
        members: [{ nation: "AAA", status: "full" }],
        budget: { contributionPctGdp: 0.001, shares: { programs: 1 } },
      }),
    ];
    const plain = campaign({ nodes, blocs, player: "BBB" });
    plain.months(2);
    const withProgram = campaign({ nodes, blocs, player: "BBB" });
    const internals = withProgram.sim as unknown as {
      blocs: {
        blocs: { programs: { id: number; since: string; until: string }[] }[];
      };
    };
    internals.blocs.blocs[0].programs.push({
      id: 1,
      since: "2026-01-01",
      until: "2029-01-01",
    });
    withProgram.months(2);
    expect(
      withProgram.sim.read().tech.nations.AAA.pointsLastMonth /
        plain.sim.read().tech.nations.AAA.pointsLastMonth,
    ).toBeCloseTo(1.25, 2);
  });

  it("the technology state round-trips byte for byte", () => {
    const nodes = [
      node({ id: "a", cost: 500 }),
      node({ id: "b", adoptedAbove: 0.5 }),
    ];
    const { sim, months, deps } = campaign({ nodes, player: "BBB" });
    months(3);
    const bytes = encodeSave(sim.snapshot());
    const again = new VeritableSimImpl(deps);
    again.restore(decodeSave(bytes));
    expect(encodeSave(again.snapshot())).toEqual(bytes);
    expect(again.read().tech.nations.AAA.projects.length).toBe(1);
  });
});
