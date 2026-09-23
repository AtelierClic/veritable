import { loadVeritableConfig } from "../../data/loadConfig";
import { Bloc } from "../../data/schemas/bloc";
import { VeritableConfig } from "../../data/schemas/config";
import { NationData } from "../../data/schemas/nation";
import { Scenario } from "../../data/schemas/scenario";
import { MemoryWorld } from "../testing/MemoryWorld";
import {
  testNation,
  TestNationOptions,
  testScenario,
} from "../testing/nations";
import { testSimData } from "../testing/simData";
import { SimEvent } from "../VeritableSim";
import { VeritableSimImpl } from "../VeritableSimImpl";
import { relation } from "./diplomacy";

const DAY = 1440;

function quietConfig(): VeritableConfig {
  const config = structuredClone(loadVeritableConfig());
  config.economy.growth.noiseMonthlySd = 0;
  config.economy.rowSupplyNoise.monthlySd = 0;
  return config;
}

interface Setup {
  nations: Record<string, TestNationOptions & { personnel?: number }>;
  scenario?: Partial<Scenario>;
  autopilot?: boolean;
  config?: VeritableConfig;
  blocsData?: Bloc[];
}

function campaign(setup: Setup) {
  const ids = Object.keys(setup.nations);
  const sheets = new Map<string, NationData>(
    ids.map((id) => {
      const sheet = testNation(id, setup.nations[id]);
      const personnel = setup.nations[id].personnel;
      if (personnel !== undefined) sheet.military.activePersonnel = personnel;
      return [id, sheet];
    }),
  );
  const scenario = { ...testScenario(ids), ...setup.scenario };
  const sim = new VeritableSimImpl({
    config: setup.config ?? quietConfig(),
    world: new MemoryWorld(4, 4),
    data: testSimData(ids, { blocs: setup.blocsData }),
    nationData: (id) => sheets.get(id),
    scenario,
    autopilot: setup.autopilot,
  });
  sim.init(scenario, 11);
  const events: SimEvent[] = [];
  const months = (n: number) => {
    for (let d = 0; d < 31 * n; d++) {
      events.push(...sim.advance(DAY).filter((e) => e.type !== "day-started"));
    }
  };
  return { sim, events, months, sheets };
}

// AAA plays; it shares two blocs with BBB, one with CCC; DDD is alone.
// Equal armies: nobody weighs more than a quarter of the world.
const world: Setup = {
  nations: {
    AAA: { blocs: ["club", "pact"], personnel: 100_000 },
    BBB: { blocs: ["club", "pact"], personnel: 100_000 },
    CCC: { blocs: ["club"], personnel: 100_000 },
    DDD: { blocs: [], personnel: 100_000 },
  },
};

describe("relations", () => {
  it("start at +30 per common bloc, capped at 60, and drift towards the affinity (blocs and ideology)", () => {
    const { sim, months } = campaign(world);
    const d = sim.read().diplomacy;
    expect(relation(d, "AAA", "BBB")).toBe(60);
    expect(relation(d, "AAA", "CCC")).toBe(30);
    expect(relation(d, "AAA", "DDD")).toBe(0);
    expect(relation(d, "BBB", "AAA")).toBe(60); // symmetric
    months(12);
    // Same governments everywhere (test data): affinity = 40 x common blocs
    // + 20. AAA-CCC (one bloc): 60, reached from 30 at +2 a month.
    expect(relation(sim.read().diplomacy, "AAA", "CCC")).toBe(54);
    // AAA-BBB (two blocs): 100, from 60.
    expect(relation(sim.read().diplomacy, "AAA", "BBB")).toBe(84);
    // AAA-DDD (no bloc): 20, from 0.
    expect(relation(sim.read().diplomacy, "AAA", "DDD")).toBe(20);
  });

  it("a war of the scenario starts at -100; the world has priced it in, only its victim sanctions", () => {
    const { sim, months } = campaign({
      ...world,
      scenario: {
        wars: [
          {
            id: "old-war",
            belligerents: [["DDD"], ["CCC"]],
            since: "2022-02-24",
            intensity: 0.8,
            fronts: [],
          },
        ],
      },
    });
    const d = sim.read().diplomacy;
    expect(d.wars.map((w) => [w.id, w.aggressors, w.defenders])).toEqual([
      ["old-war", ["DDD"], ["CCC"]],
    ]);
    expect(d.wars[0].declaredInCampaign).toBe(false);
    expect(relation(d, "CCC", "DDD")).toBe(-100);
    months(3);
    // No cost for a war of the scenario: only the drift to the affinity.
    expect(relation(sim.read().diplomacy, "AAA", "DDD")).toBe(6);
    expect(sim.read().diplomacy.sanctions).toEqual([
      { by: "CCC", against: "DDD", since: "2026-02-01" },
    ]);
  });
});

describe("declaring war", () => {
  it("needs a casus belli that holds; none is always available at a higher cost", () => {
    const { sim } = campaign(world);
    expect(sim.read().casusBelli.BBB).toEqual(["none"]);
    expect(() =>
      sim.apply({
        type: "declare-war",
        target: "BBB",
        casusBelli: "humanitarian",
      }),
    ).toThrow(/does not hold/);
    expect(() =>
      sim.apply({ type: "declare-war", target: "AAA", casusBelli: "none" }),
    ).toThrow(/itself/);
  });

  it("contested territory: the target controls a region the declarer claims", () => {
    const { sim } = campaign({
      ...world,
      scenario: {
        contested: [
          {
            region: "marches",
            controller: "BBB",
            claimants: ["AAA"],
            recognizedBy: [],
          },
        ],
      },
    });
    expect(sim.read().casusBelli.BBB).toEqual(["contested-territory", "none"]);
    expect(sim.read().casusBelli.CCC).toEqual(["none"]);
  });

  it("with a casus belli the cost is paid once; defenders pay nothing; after the peace relations heal by two a month", () => {
    const { sim, months } = campaign({
      ...world,
      scenario: {
        contested: [
          {
            region: "marches",
            controller: "BBB",
            claimants: ["AAA"],
            recognizedBy: [],
          },
        ],
      },
    });
    sim.apply({
      type: "declare-war",
      target: "BBB",
      casusBelli: "contested-territory",
    });
    let d = sim.read().diplomacy;
    // 5 x (1 + 0.25): once.
    expect(relation(d, "AAA", "CCC")).toBeCloseTo(30 - 6.25, 6);
    expect(relation(d, "AAA", "DDD")).toBeCloseTo(-6.25, 6);
    // The defender's relations with the others are untouched.
    expect(relation(d, "BBB", "CCC")).toBe(30);
    months(2);
    d = sim.read().diplomacy;
    // No monthly cost with a casus belli: only the drift towards the
    // affinity (+2 a month when below it, -0.5 when above).
    expect(relation(d, "AAA", "CCC")).toBeCloseTo(30 - 6.25 + 4, 6);
    expect(relation(d, "AAA", "DDD")).toBeCloseTo(-6.25 + 4, 6);
    expect(relation(d, "BBB", "CCC")).toBe(34);
    // Peace: the enemies start healing from -100 by two a month.
    const war = d.wars[0];
    sim.apply({
      type: "propose-peace",
      war: war.id,
      to: "BBB",
      terms: {
        kind: "ceasefire",
        reparationsPctGdp: 0,
        reparationYears: 0,
        maxDivisions: null,
      },
    });
    // BBB (AI) is neither exhausted nor retreating: it refuses; check the
    // healing rule on DDD's relations instead (+2 a month up to the
    // affinity of 20).
    months(3);
    expect(relation(sim.read().diplomacy, "AAA", "DDD")).toBeCloseTo(
      -6.25 + 10,
      6,
    );
  });

  it("costs relations with everyone at the declaration and every month, more without casus belli, more when powerful", () => {
    const { sim, events, months } = campaign(world);
    sim.apply({ type: "declare-war", target: "DDD", casusBelli: "none" });
    const d = sim.read().diplomacy;
    expect(d.wars).toHaveLength(1);
    expect(d.wars[0]).toMatchObject({
      aggressors: ["AAA"],
      defenders: ["DDD"],
      casusBelli: null,
      declaredInCampaign: true,
    });
    expect(relation(d, "AAA", "DDD")).toBe(-100);
    // 15 x (1 + share of AAA in the total power), share = 0.25 here.
    const hit = 60 - relation(d, "AAA", "BBB");
    expect(hit).toBeCloseTo(18.75, 6);
    expect(sim.read().journal[sim.read().journal.length - 1]).toMatchObject({
      kind: "war-declared",
      nation: "AAA",
      params: { target: "DDD", casusBelli: "none", war: "war-1" },
    });
    // The youth and the business of the aggressor turn against the war.
    const groups = sim.read().politics.AAA.groups!;
    expect(groups.youth).toBeCloseTo(0.4, 9);
    expect(groups.business).toBeCloseTo(0.4, 9);
    // Every month of war costs the same again; the event of a command comes
    // out with the next advance.
    months(1);
    // (Minus the drift back towards the affinity, at most +2.)
    expect(60 - relation(sim.read().diplomacy, "AAA", "BBB")).toBeGreaterThan(
      2 * hit - 2.5,
    );
    expect(events.filter((e) => e.type === "war-declared")).toHaveLength(1);
  });
});

describe("international reaction", () => {
  it("the victim and the bloc-mates of the victim sanction the aggressor, both ways, food and pharma exempt", () => {
    const { sim, events, months } = campaign(world);
    sim.apply({ type: "declare-war", target: "CCC", casusBelli: "none" });
    months(2);
    // The victim sanctions at once; nobody else yet (BBB is still at +22).
    expect(sim.read().diplomacy.sanctions.map((s) => s.by)).toEqual(["CCC"]);
    months(5);
    const sanctions = sim.read().diplomacy.sanctions;
    // BBB shares a bloc with CCC; DDD shares none and AAA is not that heavy.
    expect(sanctions.map((s) => s.by).sort()).toEqual(["BBB", "CCC"]);
    expect(events.filter((e) => e.type === "sanctions-imposed")).toHaveLength(
      2,
    );
    const embargoes = sim.read().market.embargoes;
    expect(
      embargoes.some(
        (e) => e.from === "AAA" && e.to === "BBB" && e.good === "oil",
      ),
    ).toBe(true);
    expect(
      embargoes.some(
        (e) => e.from === "BBB" && e.to === "AAA" && e.good === "oil",
      ),
    ).toBe(true);
    expect(
      embargoes.some((e) => e.good === "food" || e.good === "pharma"),
    ).toBe(false);
    expect(sim.read().journal.some((j) => j.kind === "sanctions-imposed")).toBe(
      true,
    );
  });

  it("everyone sanctions an aggressor that weighs more than a quarter of the world", () => {
    const { sim, months } = campaign({
      nations: {
        AAA: { personnel: 900_000 },
        BBB: { personnel: 100_000 },
        CCC: { personnel: 100_000 },
        DDD: { personnel: 100_000 },
      },
    });
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    months(4);
    expect(
      sim
        .read()
        .diplomacy.sanctions.map((s) => s.by)
        .sort(),
    ).toEqual(["BBB", "CCC", "DDD"]);
  });

  it("the full members of a bloc entity align once half of them sanction", () => {
    const { sim, months } = campaign({
      nations: {
        AAA: { personnel: 150_000 },
        BBB: { blocs: ["club"], personnel: 100_000 },
        CCC: { blocs: ["club"], personnel: 100_000 },
        DDD: { blocs: ["far"], personnel: 100_000 },
        EEE: { blocs: ["far"], personnel: 100_000 },
      },
      blocsData: [
        {
          id: "club",
          name: "bloc.club",
          layer: 1,
          members: [
            { nation: "CCC", status: "full" },
            { nation: "DDD", status: "full" },
          ],
        },
      ],
    });
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    months(8);
    const by = sim
      .read()
      .diplomacy.sanctions.map((s) => s.by)
      .sort();
    // BBB is the victim; CCC sanctions as a bloc-mate of BBB; DDD follows CCC
    // inside the "club" entity; EEE has no reason.
    expect(by).toEqual(["BBB", "CCC", "DDD"]);
  });

  it("a coalition forms against an aggressor without casus belli that outweighs its victim", () => {
    const { sim, events, months } = campaign({
      nations: {
        AAA: { personnel: 600_000 },
        BBB: { personnel: 100_000 },
        CCC: { personnel: 100_000 },
        DDD: { personnel: 100_000 },
      },
    });
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    months(18);
    const joined = events.filter((e) => e.type === "war-joined");
    expect(joined.length).toBeGreaterThan(0);
    const war = sim.read().diplomacy.wars[0];
    expect(war.defenders.length).toBeGreaterThan(1);
    for (const d of war.defenders) {
      expect(relation(sim.read().diplomacy, "AAA", d)).toBe(-100);
    }
    expect(sim.read().journal.some((j) => j.kind === "war-joined")).toBe(true);
  });

  it("no coalition with a casus belli, however strong the aggressor", () => {
    const { sim, events, months } = campaign({
      nations: {
        AAA: { personnel: 600_000 },
        BBB: { personnel: 100_000 },
        CCC: { personnel: 100_000 },
        DDD: { personnel: 100_000 },
      },
      scenario: {
        contested: [
          {
            region: "marches",
            controller: "BBB",
            claimants: ["AAA"],
            recognizedBy: [],
          },
        ],
      },
    });
    sim.apply({
      type: "declare-war",
      target: "BBB",
      casusBelli: "contested-territory",
    });
    months(18);
    expect(events.filter((e) => e.type === "war-joined")).toEqual([]);
    expect(sim.read().diplomacy.wars[0].defenders).toEqual(["BBB"]);
  });

  it("the player can sanction and lift sanctions by command", () => {
    const { sim } = campaign(world);
    sim.apply({ type: "set-sanctions", against: "DDD", active: true });
    expect(sim.read().diplomacy.sanctions).toEqual([
      { by: "AAA", against: "DDD", since: "2026-01-01" },
    ]);
    expect(sim.read().market.embargoes.length).toBeGreaterThan(10);
    sim.apply({ type: "set-sanctions", against: "DDD", active: false });
    expect(sim.read().diplomacy.sanctions).toEqual([]);
    expect(sim.read().market.embargoes).toEqual([]);
  });
});
