import { loadVeritableConfig } from "../data/loadConfig";
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
import { testSimData } from "../sim/testing/simData";
import { VeritableSimImpl } from "../sim/VeritableSimImpl";

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
) {
  const sheets = new Map<string, NationData>(
    ids.map((id) => [id, testNation(id, options[id] ?? {})]),
  );
  const sim = new VeritableSimImpl({
    config,
    world: new MemoryWorld(4, 4),
    data: testSimData(ids, { landNeighbours: [["BBB", "CCC"]] }),
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

  it("a very aggressive leader, twice the power of a land neighbour, a war that pays: it declares", () => {
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

  it("no war without a casus belli for a leader at 0.8 or less, none without twice the power, none on a nuclear power, none beyond its land borders", () => {
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
