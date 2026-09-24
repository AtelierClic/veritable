import { loadVeritableConfig } from "../data/loadConfig";
import { Bloc } from "../data/schemas/bloc";
import { VeritableConfig } from "../data/schemas/config";
import { NationData } from "../data/schemas/nation";
import {
  AiState,
  DiplomacyState,
  EconomyState,
  MilitaryState,
  PoliticsState,
} from "../data/schemas/save";
import { relation, setRelation } from "../sim/diplomacy/diplomacy";
import { MemoryWorld } from "../sim/testing/MemoryWorld";
import {
  testNation,
  TestNationOptions,
  testScenario,
} from "../sim/testing/nations";
import { testBloc, testSimData } from "../sim/testing/simData";
import { VeritableSimImpl } from "../sim/VeritableSimImpl";
import { AiEnv, appraiseWar } from "./nations";

const DAY = 1440;

function quietConfig(): VeritableConfig {
  const config = structuredClone(loadVeritableConfig());
  config.economy.growth.noiseMonthlySd = 0;
  config.economy.rowSupplyNoise.monthlySd = 0;
  config.politics.aiShock.sd = 0;
  config.politics.coups.militaryScale = 0;
  config.politics.leaders.deathBase = 0;
  return config;
}

// AAA plays; BBB, CCC, DDD are AI nations. BBB and CCC share a land border.
function campaign(
  options: Record<string, TestNationOptions> = {},
  config: VeritableConfig = quietConfig(),
  ids = ["AAA", "BBB", "CCC", "DDD"],
  blocs: Bloc[] = [],
) {
  const sheets = new Map<string, NationData>(
    ids.map((id) => [id, testNation(id, options[id] ?? {})]),
  );
  const sim = new VeritableSimImpl({
    config,
    world: new MemoryWorld(4, 4),
    data: testSimData(ids, { landNeighbours: [["BBB", "CCC"]], blocs }),
    nationData: (id) => sheets.get(id),
  });
  sim.init(testScenario(ids), 21);
  const internals = sim as unknown as {
    ai: AiState;
    diplomacy: DiplomacyState;
    economy: EconomyState;
    military: MilitaryState;
    politics: PoliticsState;
  };
  const days = (n: number) => {
    for (let d = 0; d < n; d++) sim.advance(DAY);
  };
  return { sim, internals, days, config };
}

describe("the staggered review of the nation AI", () => {
  it("every nation nobody plays comes up about once a month in peace, once a week at war; the player never", () => {
    const { sim, internals, days } = campaign();
    days(40);
    const ai = sim.read().ai;
    expect(ai.nations.AAA.nextReview).toBe("2026-01-01"); // never reviewed
    for (const id of ["BBB", "CCC", "DDD"]) {
      // Reviewed: the next review is a month after the last one.
      expect(ai.nations[id].nextReview > "2026-02-01").toBe(true);
    }
    // War between BBB and CCC: their period shortens to a week.
    internals.diplomacy.wars.push({
      id: "war-x",
      aggressors: ["BBB"],
      defenders: ["CCC"],
      casusBelli: null,
      since: sim.read().date,
      declaredInCampaign: true,
      score: { BBB: 0, CCC: 0 },
      retreatMonths: { BBB: 0, CCC: 0 },
      tilesTaken: { BBB: 0, CCC: 0 },
      monthlyTiles: { BBB: 0, CCC: 0 },
      offers: [],
    } as unknown as DiplomacyState["wars"][number]);
    days(40);
    const next = sim.read().ai.nations.BBB.nextReview;
    const today = sim.read().date;
    const gap = (Date.parse(next) - Date.parse(today)) / (24 * 3600 * 1000);
    expect(gap).toBeLessThanOrEqual(7);
  });
});

describe("defence by the threat", () => {
  it("a nation at war raises its defence goal by the war boost weighted by its security agenda; the budget follows", () => {
    const { sim, internals, days, config } = campaign({
      BBB: {
        aiAgenda: [
          { goal: "security", weight: 0.5 },
          { goal: "growth", weight: 0.5 },
        ],
      },
    });
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    days(90);
    const economy = internals.economy.nations.BBB;
    const cfg = config.ai.nations.defense;
    const goal = Math.min(
      cfg.maxShare,
      economy.spending0.defense * (1 + cfg.warBoost * (0.5 + 0.5)),
    );
    expect(sim.read().ai.nations.BBB.defenseGoal).toBeCloseTo(goal, 12);
    expect(economy.spending.defense).toBeGreaterThan(
      economy.spending0.defense * 1.3,
    );
  });
});

describe("war declarations of the AI", () => {
  function strong(config = quietConfig()) {
    config.ai.nations.war.declareProbability = 1;
    config.ai.nations.war.minMonthsBetweenWars = 0;
    return config;
  }

  it("a very aggressive leader, hostile, 1.5 times the power of a land neighbour, a war that pays: it declares", () => {
    const { sim, internals, days } = campaign(
      {
        BBB: {
          activePersonnel: 1_000_000,
          aiAgenda: [
            { goal: "regional-influence", weight: 0.8 },
            { goal: "growth", weight: 0.2 },
          ],
          tradeOpenness: 0.05,
        },
        CCC: { activePersonnel: 50_000 },
      },
      strong(),
    );
    internals.politics.nations.BBB.leader.traits.aggressiveness = 0.95;
    setRelation(internals.diplomacy, "BBB", "CCC", -30);
    days(45);
    const wars = sim.read().diplomacy.wars;
    expect(wars).toHaveLength(1);
    expect(wars[0]).toMatchObject({
      aggressors: ["BBB"],
      defenders: ["CCC"],
      casusBelli: null,
    });
    expect(sim.read().journal.map((j) => j.kind)).toContain("war-declared");
  });

  it("no war on a nation it is on better terms with than -10 (J5)", () => {
    const { sim, internals, days } = campaign(
      {
        BBB: {
          activePersonnel: 1_000_000,
          aiAgenda: [
            { goal: "regional-influence", weight: 0.8 },
            { goal: "growth", weight: 0.2 },
          ],
          tradeOpenness: 0.05,
        },
        CCC: { activePersonnel: 50_000 },
      },
      strong(),
    );
    internals.politics.nations.BBB.leader.traits.aggressiveness = 0.95;
    setRelation(internals.diplomacy, "BBB", "CCC", 0);
    days(45);
    expect(sim.read().diplomacy.wars).toEqual([]);
  });

  it("no war without a casus belli for a leader at 0.8 or less, none without 1.5 times the power, none on a nuclear power, none beyond its land borders", () => {
    const calm = campaign(
      {
        BBB: { activePersonnel: 1_000_000, tradeOpenness: 0.05 },
        CCC: { activePersonnel: 50_000 },
      },
      strong(),
    );
    calm.internals.politics.nations.BBB.leader.traits.aggressiveness = 0.8;
    calm.days(90);
    expect(calm.sim.read().diplomacy.wars).toEqual([]);

    const weak = campaign(
      {
        BBB: { activePersonnel: 150_000, tradeOpenness: 0.05 },
        CCC: { activePersonnel: 100_000 },
      },
      strong(),
    );
    weak.internals.politics.nations.BBB.leader.traits.aggressiveness = 0.95;
    weak.days(90);
    expect(weak.sim.read().diplomacy.wars).toEqual([]);

    const nuclear = campaign(
      {
        BBB: { activePersonnel: 1_000_000, tradeOpenness: 0.05 },
        CCC: {
          activePersonnel: 50_000,
          nuclear: { warheads: 10, doctrine: "no-first-use" },
        },
      },
      strong(),
    );
    nuclear.internals.politics.nations.BBB.leader.traits.aggressiveness = 0.95;
    nuclear.days(90);
    expect(nuclear.sim.read().diplomacy.wars).toEqual([]);

    // DDD is nobody's land neighbour.
    const far = campaign(
      {
        DDD: { activePersonnel: 1_000_000, tradeOpenness: 0.05 },
        CCC: { activePersonnel: 50_000 },
      },
      strong(),
    );
    far.internals.politics.nations.DDD.leader.traits.aggressiveness = 0.95;
    far.days(90);
    expect(
      far.sim.read().diplomacy.wars.filter((w) => w.aggressors[0] === "DDD"),
    ).toEqual([]);
  });
});

describe("the sanctions a war would bring (J6c)", () => {
  it("come only from the partners of the target that would turn hostile to the aggressor, a common forum or not", () => {
    // DDD shares a forum with CCC, the target of BBB.
    const forum = testBloc({
      id: "club",
      type: "forum",
      members: [
        { nation: "CCC", status: "full" },
        { nation: "DDD", status: "full" },
      ],
    });
    const { sim, internals } = campaign(
      {
        BBB: { activePersonnel: 1_000_000, tradeOpenness: 0.5 },
        CCC: { activePersonnel: 50_000 },
      },
      quietConfig(),
      ["AAA", "BBB", "CCC", "DDD"],
      [forum],
    );
    const d = internals.diplomacy;
    setRelation(d, "BBB", "CCC", -30);
    d.grievances.push({ by: "BBB", against: "CCC", until: "2027-06-01" });
    const env = () =>
      (sim as unknown as { aiEnv(date: string): AiEnv }).aiEnv("2026-01-01");
    setRelation(d, "DDD", "BBB", 50);
    const friendly = appraiseWar(env(), "BBB", "CCC")!;
    setRelation(d, "DDD", "BBB", -35);
    const hostile = appraiseWar(env(), "BBB", "CCC")!;
    expect(friendly.casusBelli).toBe("grievance");
    expect(hostile.cost).toBeGreaterThan(friendly.cost);
  });
});

describe("the cost of a war by its size (J6c)", () => {
  it("exhaustion and reputation fall as the gap in power grows", () => {
    const appraise = (target: number) => {
      const { sim, internals } = campaign(
        {
          BBB: { activePersonnel: 1_000_000, tradeOpenness: 0.05 },
          CCC: { activePersonnel: target },
        },
        quietConfig(),
      );
      setRelation(internals.diplomacy, "BBB", "CCC", -30);
      internals.diplomacy.grievances.push({
        by: "BBB",
        against: "CCC",
        until: "2027-06-01",
      });
      const env = (sim as unknown as { aiEnv(date: string): AiEnv }).aiEnv(
        "2026-01-01",
      );
      return appraiseWar(env, "BBB", "CCC")!;
    };
    const equalish = appraise(600_000);
    const weak = appraise(60_000);
    expect(weak.powerRatio).toBeGreaterThan(equalish.powerRatio);
    // Same trade and sanctions: before the J6c both cost the same.
    expect(weak.cost).toBeLessThan(equalish.cost * 0.6);
  });
});

describe("a claim weakened by failed wars (J6c)", () => {
  it("its weight multiplies the motive of the casus belli: a quarter of the weight, a quarter of the motive", () => {
    const ids = ["AAA", "BBB", "CCC", "DDD"];
    const sheets = new Map<string, NationData>(
      ids.map((id) => [
        id,
        testNation(
          id,
          id === "BBB"
            ? { activePersonnel: 1_000_000, tradeOpenness: 0.05 }
            : id === "CCC"
              ? { activePersonnel: 50_000 }
              : {},
        ),
      ]),
    );
    const scenario = {
      ...testScenario(ids),
      contested: [
        {
          region: "marches",
          controller: "CCC",
          claimants: ["BBB"],
          recognizedBy: [],
        },
      ],
    };
    const world = new MemoryWorld(4, 4);
    ids.forEach((id, row) => {
      for (let x = 0; x < 4; x++) world.setOwner(row * 4 + x, id);
    });
    world.setClaims(new Map([["marches", Uint32Array.from([8, 9])]]));
    const sim = new VeritableSimImpl({
      config: quietConfig(),
      world,
      data: testSimData(ids, { landNeighbours: [["BBB", "CCC"]] }),
      nationData: (id) => sheets.get(id),
      scenario,
    });
    sim.init(scenario, 21);
    const internals = sim as unknown as {
      diplomacy: DiplomacyState;
      politics: PoliticsState;
      aiEnv(date: string): AiEnv;
    };
    setRelation(internals.diplomacy, "BBB", "CCC", -30);
    const claim = internals.diplomacy.claims.find(
      (c) => c.region === "marches" && c.claimant === "BBB",
    )!;
    const full = appraiseWar(internals.aiEnv("2026-01-01"), "BBB", "CCC")!;
    expect(full.casusBelli).toBe("contested-territory");
    claim.weight = 0.25;
    const weak = appraiseWar(internals.aiEnv("2026-01-01"), "BBB", "CCC")!;
    expect(weak.gain / full.gain).toBeCloseTo(0.25, 10);
    // Given up after its third failure: no casus belli left, no war on it.
    claim.failures = quietConfig().diplomacy.claims.abandonAfterFailures;
    internals.politics.nations.BBB.leader.traits.aggressiveness = 0.5;
    expect(appraiseWar(internals.aiEnv("2026-01-01"), "BBB", "CCC")).toBeNull();
  });
});

describe("arms flows", () => {
  it("a nation at peace sends arms to a friend at war with a foe; its budget pays, the friend re-equips", () => {
    const { sim, internals, days } = campaign();
    // The player (AAA) fights BBB; DDD likes AAA and hates BBB.
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    setRelation(internals.diplomacy, "DDD", "AAA", 60);
    setRelation(internals.diplomacy, "DDD", "BBB", -60);
    for (const d of internals.military.nations.AAA.divisions) {
      d.equipment = 0.2;
    }
    days(40);
    const view = sim.read();
    expect(view.ai.armsAid).toContainEqual(
      expect.objectContaining({ from: "DDD", to: "AAA" }),
    );
    expect(view.journal.map((j) => j.kind)).toContain("arms-aid-started");
    expect(relation(internals.diplomacy, "DDD", "AAA")).toBeGreaterThan(40);
  });
});
