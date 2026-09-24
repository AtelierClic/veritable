import { loadVeritableConfig } from "../../data/loadConfig";
import { Bloc } from "../../data/schemas/bloc";
import { VeritableConfig } from "../../data/schemas/config";
import { NationData } from "../../data/schemas/nation";
import {
  BlocsState,
  DiplomacyState,
  EconomyState,
  PoliticsState,
} from "../../data/schemas/save";
import { Scenario } from "../../data/schemas/scenario";
import { defenseGuarantors } from "../blocs/blocs";
import { EconomyContext, SimData } from "../economy/context";
import { internalConflictMalus } from "../politics/politics";
import { MemoryWorld } from "../testing/MemoryWorld";
import { testNation, testScenario } from "../testing/nations";
import { testBloc, testSimData } from "../testing/simData";
import { VeritableSimImpl } from "../VeritableSimImpl";
import {
  affinityOf,
  allies,
  imposeSanctions,
  isSanctioning,
  relation,
  setRelation,
} from "./diplomacy";

// The world of 2026 (J6b): relations of the first day from the scenario's
// file, an affinity that weighs blocs by their type and falls with sanctions
// and with a war against an ally, bilateral guarantees, the sanctions of the
// first day, and internal conflicts that cut stability.

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

// AAA (the player) and BBB share an alliance, AAA and CCC a forum; DDD is
// alone.
const BLOCS: Bloc[] = [
  testBloc({
    id: "alliance",
    type: "military-alliance",
    members: [
      { nation: "AAA", status: "full" },
      { nation: "BBB", status: "full" },
    ],
  }),
  testBloc({
    id: "club",
    type: "forum",
    members: [
      { nation: "AAA", status: "full" },
      { nation: "CCC", status: "full" },
    ],
  }),
];

function campaign(
  scenarioExtra: Partial<Scenario> = {},
  data: Partial<SimData> = {},
) {
  const ids = ["AAA", "BBB", "CCC", "DDD"];
  const sheets = new Map<string, NationData>(
    ids.map((id) => [id, testNation(id, {})]),
  );
  const scenario = { ...testScenario(ids), ...scenarioExtra };
  const sim = new VeritableSimImpl({
    config: quietConfig(),
    world: new MemoryWorld(4, 4),
    data: {
      ...testSimData(ids, { blocs: BLOCS }),
      ...data,
    },
    nationData: (id) => sheets.get(id),
    scenario,
  });
  sim.init(scenario, 11);
  const internals = sim as unknown as {
    ctx: EconomyContext;
    diplomacy: DiplomacyState;
    politics: PoliticsState;
    economy: EconomyState;
    blocs: BlocsState;
  };
  const days = (n: number) => {
    for (let d = 0; d < n; d++) sim.advance(DAY);
  };
  return { sim, internals, days };
}

describe("relations of the first day (J6b)", () => {
  it("come from the scenario's relations file, pair by pair", () => {
    const { internals } = campaign(
      {},
      {
        startRelations: {
          scenario: "test",
          asOf: "2026-01-01",
          source: "test",
          note: "",
          nations: ["AAA", "BBB", "CCC", "DDD"],
          // AB AC AD BC BD CD
          values: [55, -60, 10, 0, -20, 35],
        },
      },
    );
    const d = internals.diplomacy;
    expect(relation(d, "AAA", "BBB")).toBe(55);
    expect(relation(d, "CCC", "AAA")).toBe(-60);
    expect(relation(d, "BBB", "DDD")).toBe(-20);
    expect(relation(d, "CCC", "DDD")).toBe(35);
  });

  it("follow the rule of the J3 without a file", () => {
    const { internals } = campaign();
    // One common bloc: blocRelation.
    expect(relation(internals.diplomacy, "AAA", "BBB")).toBe(
      internals.ctx.config.diplomacy.blocRelation,
    );
    expect(relation(internals.diplomacy, "BBB", "DDD")).toBe(0);
  });
});

describe("the affinity (J6b)", () => {
  it("weighs a common bloc by its type: an alliance 40, a forum 5", () => {
    const { internals } = campaign();
    const { ctx, diplomacy, politics } = internals;
    const cfg = ctx.config.diplomacy;
    // Same test ideology everywhere: the ideology term is the same.
    const base = affinityOf(ctx, diplomacy, politics, "BBB", "DDD");
    expect(affinityOf(ctx, diplomacy, politics, "AAA", "BBB") - base).toBe(
      cfg.affinityByBlocType["military-alliance"],
    );
    expect(affinityOf(ctx, diplomacy, politics, "AAA", "CCC") - base).toBe(
      cfg.affinityByBlocType.forum,
    );
  });

  it("falls by affinitySanctions while either sanctions the other", () => {
    const { internals } = campaign();
    const { ctx, diplomacy, politics, economy } = internals;
    const before = affinityOf(ctx, diplomacy, politics, "CCC", "DDD");
    imposeSanctions(ctx, diplomacy, economy, "DDD", "CCC", "2026-01-01");
    expect(affinityOf(ctx, diplomacy, politics, "CCC", "DDD")).toBe(
      before - ctx.config.diplomacy.affinitySanctions,
    );
  });

  it("falls by affinityAllyAtWar when either fights an ally of the other", () => {
    const { sim, internals } = campaign();
    const { ctx, diplomacy, politics } = internals;
    expect(allies(ctx, "AAA", "BBB")).toBe(true);
    expect(allies(ctx, "AAA", "CCC")).toBe(false); // a forum is no alliance
    const before = affinityOf(ctx, diplomacy, politics, "AAA", "DDD");
    // DDD at war with BBB, AAA's ally.
    sim.apply({ type: "declare-war", target: "DDD", casusBelli: "none" });
    const war = diplomacy.wars[0];
    war.aggressors = ["BBB"];
    expect(affinityOf(ctx, diplomacy, politics, "AAA", "DDD")).toBe(
      before - ctx.config.diplomacy.affinityAllyAtWar,
    );
  });
});

describe("bilateral guarantees (J6b)", () => {
  const guarantees = [
    {
      guarantor: "CCC",
      protected: "DDD",
      probability: 1,
      note: "test",
    },
  ];

  it("count in the defence the AI expects from the target", () => {
    const { internals } = campaign({}, { guarantees });
    const { ctx, blocs, politics } = internals;
    expect(defenseGuarantors(ctx, blocs, politics, "DDD", "AAA")).toEqual([
      { nation: "CCC", probability: 1 },
    ]);
    // Not against the guarantor itself.
    expect(defenseGuarantors(ctx, blocs, politics, "DDD", "CCC")).toEqual([]);
  });

  it("bring an AI guarantor into a war declared on the protected nation", () => {
    const { sim, internals, days } = campaign({}, { guarantees });
    sim.apply({ type: "declare-war", target: "DDD", casusBelli: "none" });
    days(40); // the monthly step of the blocs
    const war = internals.diplomacy.wars[0];
    expect(war.defenders).toContain("CCC");
  });

  it("make the guarantor and the protected nation allies", () => {
    const { internals } = campaign({}, { guarantees });
    expect(allies(internals.ctx, "CCC", "DDD")).toBe(true);
  });
});

describe("sanctions of the first day (J6b)", () => {
  it("full sanctions by a bloc bind its members; per-good ones are embargoes", () => {
    const { internals } = campaign({
      sanctions: [
        { by: "club", against: "DDD", since: "2022-02-28", source: "test" },
        {
          by: "BBB",
          against: "CCC",
          goods: ["arms"],
          since: "2017-09-11",
          source: "test",
        },
      ],
    });
    const { diplomacy, economy, blocs } = internals;
    expect(isSanctioning(diplomacy, "AAA", "DDD")).toBe(true);
    expect(isSanctioning(diplomacy, "CCC", "DDD")).toBe(true);
    expect(isSanctioning(diplomacy, "BBB", "DDD")).toBe(false);
    expect(blocs.blocs.find((b) => b.id === "club")!.sanctions).toEqual([
      "DDD",
    ]);
    expect(diplomacy.sanctions.find((s) => s.by === "AAA")!.since).toBe(
      "2022-02-28",
    );
    // Arms only, both ways, and no full sanction.
    expect(isSanctioning(diplomacy, "BBB", "CCC")).toBe(false);
    const arms = economy.market.embargoes.filter(
      (e) =>
        (e.from === "BBB" && e.to === "CCC") ||
        (e.from === "CCC" && e.to === "BBB"),
    );
    expect(arms.map((e) => e.good)).toEqual(["arms", "arms"]);
  });
});

describe("sanctions of the first day: every form (J6b)", () => {
  it("reach every nation but the exceptions, and each full member of a bloc targeted", () => {
    const { internals } = campaign({
      sanctions: [
        {
          by: "*",
          against: "DDD",
          except: ["BBB"],
          goods: ["arms"],
          since: "2017-01-01",
          source: "test",
        },
        { by: "DDD", against: "club", since: "2020-01-01", source: "test" },
      ],
    });
    const { diplomacy, economy } = internals;
    const armsTo = (n: string) =>
      economy.market.embargoes.some(
        (e) => e.from === n && e.to === "DDD" && e.good === "arms",
      );
    expect(armsTo("AAA")).toBe(true);
    expect(armsTo("CCC")).toBe(true);
    expect(armsTo("BBB")).toBe(false);
    expect(isSanctioning(diplomacy, "DDD", "AAA")).toBe(true);
    expect(isSanctioning(diplomacy, "DDD", "CCC")).toBe(true);
    expect(isSanctioning(diplomacy, "DDD", "BBB")).toBe(false);
  });
});

describe("the lift of the sanctions of the first day (J6b)", () => {
  const FAR = { economic: 1, authority: -1, sovereignty: -1 };
  const OTHER_END = { economic: -1, authority: 1, sovereignty: 1 };

  it("a sanction of policy outlasts healed relations and close governments until the regime of the target changes", () => {
    const { internals, days } = campaign({
      sanctions: [
        { by: "CCC", against: "DDD", since: "2012-01-01", source: "test" },
      ],
    });
    const { diplomacy, politics } = internals;
    expect(diplomacy.sanctions.find((s) => s.by === "CCC")!.policy).toBe(true);
    const month = () => {
      setRelation(diplomacy, "CCC", "DDD", 0); // healed, above the threshold
      days(31);
    };
    politics.nations.CCC.government.ideology = { ...FAR };
    politics.nations.DDD.government.ideology = { ...OTHER_END };
    for (let m = 0; m < 4; m++) month();
    expect(isSanctioning(diplomacy, "CCC", "DDD")).toBe(true);
    // Close governments, the same regime as on the first day: kept.
    politics.nations.DDD.government.ideology = { ...FAR };
    for (let m = 0; m < 3; m++) month();
    expect(isSanctioning(diplomacy, "CCC", "DDD")).toBe(true);
    // A new regime in DDD: lifted at the next monthly step.
    politics.nations.DDD.regime = "presidential";
    month();
    expect(isSanctioning(diplomacy, "CCC", "DDD")).toBe(false);
  });

  it("a sanction against the aggressor of a war of the first day holds while the war lasts", () => {
    const { internals, days } = campaign({
      wars: [
        {
          id: "w",
          belligerents: [["DDD"], ["BBB"]],
          since: "2022-02-24",
          intensity: 0.8,
          fronts: [],
        },
      ],
      sanctions: [
        { by: "CCC", against: "DDD", since: "2022-02-28", source: "test" },
      ],
    });
    const { diplomacy, politics } = internals;
    expect(diplomacy.sanctions.find((s) => s.by === "CCC")!.policy).toBe(true);
    politics.nations.DDD.regime = "presidential";
    for (let m = 0; m < 3; m++) {
      setRelation(diplomacy, "CCC", "DDD", 0);
      days(31);
    }
    expect(isSanctioning(diplomacy, "CCC", "DDD")).toBe(true);
  });

  it("a bloc lifts its sanctions of policy only after a change of regime, never during a war of aggression", () => {
    const union = testBloc({
      id: "union",
      type: "economic-union",
      competencies: ["sanctions"],
      members: [
        { nation: "BBB", status: "full" },
        { nation: "CCC", status: "full" },
      ],
    });
    const run = (war: boolean, newRegime: boolean) => {
      const { internals, days } = campaign(
        {
          wars: war
            ? [
                {
                  id: "w",
                  belligerents: [["DDD"], ["AAA"]],
                  since: "2022-02-24",
                  intensity: 0.8,
                  fronts: [],
                },
              ]
            : [],
          sanctions: [
            {
              by: "union",
              against: "DDD",
              since: "2022-02-28",
              source: "test",
            },
          ],
        },
        { blocs: [...BLOCS, union] },
      );
      if (newRegime) internals.politics.nations.DDD.regime = "presidential";
      for (let month = 0; month < 4; month++) {
        for (const n of ["BBB", "CCC"]) {
          setRelation(internals.diplomacy, n, "DDD", 0);
        }
        days(31);
      }
      return internals.blocs.blocs.find((b) => b.id === "union")!.sanctions;
    };
    // The governments of the test nations are identical: after a change of
    // regime in DDD the leader proposes the lift, and it passes.
    expect(run(false, false)).toEqual(["DDD"]);
    expect(run(false, true)).toEqual([]);
    expect(run(true, true)).toEqual(["DDD"]);
  });
});

describe("internal conflicts (J6b)", () => {
  it("cut stability by intensity x stabilityMalus, halving every halfLifeYears", () => {
    const { internals } = campaign();
    const cfg = internals.ctx.config.politics.internalConflict;
    const conflicts = [{ nation: "BBB", intensity: 0.8 }];
    expect(internalConflictMalus(internals.ctx, conflicts, "BBB", 0)).toBe(
      0.8 * cfg.stabilityMalus,
    );
    expect(
      internalConflictMalus(internals.ctx, conflicts, "BBB", cfg.halfLifeYears),
    ).toBeCloseTo(0.4 * cfg.stabilityMalus, 12);
    expect(internalConflictMalus(internals.ctx, conflicts, "CCC", 0)).toBe(0);
  });

  it("leave a nation at war with itself less stable than its twin", () => {
    const internalConflicts = [
      { nation: "BBB", intensity: 1, since: "2021-02-01", note: "test" },
    ];
    const { internals, days } = campaign({}, { internalConflicts });
    days(60);
    const p = internals.politics.nations;
    // BBB and DDD are the same test nation but for the conflict (DDD has no
    // bloc: compare with a campaign without the conflict instead).
    const twin = campaign();
    twin.days(60);
    expect(p.BBB.stability).toBeLessThan(
      twin.internals.politics.nations.BBB.stability - 0.1,
    );
  });
});
