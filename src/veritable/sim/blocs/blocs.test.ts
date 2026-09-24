import fs from "fs";
import path from "path";
import { loadVeritableConfig } from "../../data/loadConfig";
import { Bloc, BlocSchema } from "../../data/schemas/bloc";
import { VeritableConfig } from "../../data/schemas/config";
import { NationData } from "../../data/schemas/nation";
import { decodeSave, encodeSave } from "../../save/serialize";
import { declareWar, relation } from "../diplomacy/diplomacy";
import { MemoryWorld } from "../testing/MemoryWorld";
import {
  testNation,
  TestNationOptions,
  testScenario,
} from "../testing/nations";
import { testBloc, testSimData } from "../testing/simData";
import { SimEvent } from "../VeritableSim";
import { VeritableSimImpl } from "../VeritableSimImpl";
import { BlocEnv, propose, tally } from "./blocs";

const DAY = 1440;

function quietConfig(): VeritableConfig {
  const config = structuredClone(loadVeritableConfig());
  config.economy.growth.noiseMonthlySd = 0;
  config.economy.rowSupplyNoise.monthlySd = 0;
  return config;
}

function realBloc(id: string): Bloc {
  const file = path.join(
    __dirname,
    "../../../../data/veritable/blocs",
    `${id}.json`,
  );
  return BlocSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

interface Setup {
  nations: Record<
    string,
    TestNationOptions & { population?: number; personnel?: number }
  >;
  blocs: Bloc[];
  player?: string;
  autopilot?: boolean;
}

// The sim internals the tests reach into to set a scene (a war between two
// AI nations, a government, political capital).
interface Internals {
  blocEnv(date: string): BlocEnv;
  diplomacy: BlocEnv["diplomacy"];
  politics: BlocEnv["politics"];
  military: BlocEnv["military"];
  economy: BlocEnv["economy"];
  ctx: BlocEnv["ctx"];
  scenario: Parameters<typeof declareWar>[4];
  calendar: { date: string };
}

function campaign(setup: Setup) {
  const ids = Object.keys(setup.nations);
  const sheets = new Map<string, NationData>(
    ids.map((id) => {
      const options = setup.nations[id];
      const sheet = testNation(id, options);
      if (options.population !== undefined) {
        sheet.population.value = options.population;
      }
      if (options.personnel !== undefined) {
        sheet.military.activePersonnel = options.personnel;
      }
      return [id, sheet];
    }),
  );
  const scenario = {
    ...testScenario(ids),
    playerDefault: setup.player ?? ids[0],
  };
  const sim = new VeritableSimImpl({
    config: quietConfig(),
    world: new MemoryWorld(4, 4),
    data: testSimData(ids, { blocs: setup.blocs }),
    nationData: (id) => sheets.get(id),
    scenario,
    autopilot: setup.autopilot,
  });
  sim.init(scenario, 7);
  const events: SimEvent[] = [];
  const days = (n: number) => {
    for (let d = 0; d < n; d++) {
      events.push(...sim.advance(DAY).filter((e) => e.type !== "day-started"));
    }
  };
  // To the 1st of the n-th next month (the blocs clock runs on the 1st).
  const months = (n: number) => {
    for (let i = 0; i < n; i++) {
      const month = sim.read().date.slice(0, 7);
      while (sim.read().date.slice(0, 7) === month) days(1);
    }
  };
  const internals = sim as unknown as Internals;
  return { sim, events, days, months, internals };
}

const bloc = (id: string) => (view: ReturnType<VeritableSimImpl["read"]>) =>
  view.blocs.find((b) => b.id === id)!;

describe("votes", () => {
  it("qualified majority: 55 % of the voters and 65 % of their population", () => {
    const { internals } = campaign({
      nations: {
        AAA: { population: 60e6 },
        BBB: { population: 50e6 },
        CCC: { population: 40e6 },
        DDD: { population: 30e6 },
        EEE: { population: 20e6 },
        XXX: {},
      },
      player: "XXX",
      blocs: [
        testBloc({
          id: "union",
          members: ["AAA", "BBB", "CCC", "DDD", "EEE"].map((nation) => ({
            nation,
            status: "full" as const,
          })),
          decisionRules: {
            ...testBloc({ id: "x", members: [] }).decisionRules,
            budget: "qualified-majority",
          },
          qualifiedMajority: { memberShare: 0.55, populationShare: 0.65 },
          budget: { contributionPctGdp: 0.01, shares: {} },
        }),
      ],
    });
    const env = internals.blocEnv("2026-01-15");
    const vote = (yes: string[], abstain: string[] = []) =>
      tally(env, {
        bloc: "union",
        by: "XXX",
        kind: "budget",
        target: null,
        direction: "up",
        cast: Object.fromEntries(
          ["AAA", "BBB", "CCC", "DDD", "EEE"].map((n) => [
            n,
            yes.includes(n) ? "yes" : abstain.includes(n) ? "abstain" : "no",
          ]),
        ),
      });
    // 3/5 of the members, 150 of 200 million: adopted.
    expect(vote(["AAA", "BBB", "CCC"]).adopted).toBe(true);
    // 3/5 of the members but 90 of 200 million: rejected.
    expect(vote(["CCC", "DDD", "EEE"]).adopted).toBe(false);
    // 4/5 of the members, 140 of 200 million (70 %): adopted.
    expect(vote(["BBB", "CCC", "DDD", "EEE"]).adopted).toBe(true);
    // 2/5 of the members, whatever the population: rejected.
    expect(vote(["AAA", "BBB"], ["CCC"]).adopted).toBe(false);
  });

  it("unanimity: one no blocks, an abstention does not", () => {
    const { internals } = campaign({
      nations: { AAA: {}, BBB: {}, CCC: {}, XXX: {} },
      player: "XXX",
      blocs: [
        testBloc({
          id: "club",
          members: ["AAA", "BBB", "CCC"].map((nation) => ({
            nation,
            status: "full" as const,
          })),
        }),
      ],
    });
    const env = internals.blocEnv("2026-01-15");
    const vote = (cast: Record<string, "yes" | "no" | "abstain">) =>
      tally(env, {
        bloc: "club",
        by: "XXX",
        kind: "tech-program",
        target: null,
        direction: null,
        cast,
      }).adopted;
    expect(vote({ AAA: "yes", BBB: "yes", CCC: "no" })).toBe(false);
    expect(vote({ AAA: "yes", BBB: "yes", CCC: "abstain" })).toBe(true);
  });
});

describe("leaders", () => {
  it("the EU presidency rotates every six months among the simulated members in the order of the data: France from July 2026", () => {
    const { sim, months } = campaign({
      nations: { DEU: {}, ESP: {}, FRA: {}, ITA: {}, POL: {}, GBR: {} },
      player: "GBR",
      blocs: [realBloc("eu")],
    });
    const seen: string[] = [];
    for (let i = 0; i < 31; i++) {
      const leader = bloc("eu")(sim.read()).leader!;
      if (seen[seen.length - 1] !== leader) seen.push(leader);
      months(1);
    }
    expect(seen).toEqual(["ITA", "FRA", "POL", "ESP", "DEU", "ITA"]);
    expect(
      sim.read().journal.filter((j) => j.kind === "bloc-presidency").length,
    ).toBe(5);
  });

  it("a hegemon leads by military power and keeps the lead within the margin", () => {
    const { sim } = campaign({
      nations: {
        AAA: { personnel: 100_000 },
        BBB: { personnel: 300_000 },
        CCC: { personnel: 280_000 },
      },
      blocs: [realBloc("nato")].map((b) => ({
        ...b,
        members: [
          { nation: "AAA", status: "full" as const },
          { nation: "BBB", status: "full" as const },
          { nation: "CCC", status: "full" as const },
        ],
      })),
    });
    expect(bloc("nato")(sim.read()).leader).toBe("BBB");
  });
});

describe("measures", () => {
  it("a bloc sanctions an aggressor by a vote of its members, and binds every member", () => {
    const { sim, months } = campaign({
      nations: {
        AAA: { personnel: 150_000 },
        BBB: {},
        CCC: {},
        DDD: {},
        EEE: {},
      },
      blocs: [
        testBloc({
          id: "club",
          competencies: ["sanctions"],
          members: ["CCC", "BBB", "DDD", "EEE"].map((nation) => ({
            nation,
            status: "full" as const,
          })),
        }),
      ],
    });
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    months(10);
    const view = sim.read();
    expect(bloc("club")(view).state.sanctions).toEqual(["AAA"]);
    expect(
      view.diplomacy.sanctions
        .filter((s) => s.against === "AAA")
        .map((s) => s.by)
        .sort(),
    ).toEqual(["BBB", "CCC", "DDD", "EEE"]);
    const decision = view.journal.find(
      (j) => j.kind === "bloc-decision" && j.params.kind === "sanctions",
    );
    expect(decision?.params.result).toBe("adopted");
    expect(decision?.params.target).toBe("AAA");
  });

  it("the player leads: a measure costs capital, one a month, the projected vote is shown, the members vote the next month", () => {
    const { sim, months, internals } = campaign({
      nations: { AAA: {}, BBB: {}, CCC: {}, DDD: {} },
      blocs: [
        testBloc({
          id: "club",
          competencies: ["sanctions"],
          members: ["AAA", "BBB", "CCC"].map((nation) => ({
            nation,
            status: "full" as const,
          })),
          budget: { contributionPctGdp: 0.01, shares: { programs: 1 } },
        }),
      ],
    });
    internals.politics.nations.AAA.capital = 50;
    const club = bloc("club")(sim.read());
    expect(club.leader).toBe("AAA");
    const option = club.options.find(
      (o) => o.kind === "tech-program" && o.target === null,
    )!;
    expect(option.cost).toBe(20);
    expect(Object.keys(option.projection.votes).sort()).toEqual([
      "AAA",
      "BBB",
      "CCC",
    ]);
    expect(club.options.some((o) => o.kind === "sanctions")).toBe(true);
    sim.apply({
      type: "bloc-propose",
      bloc: "club",
      kind: "tech-program",
      target: null,
      direction: null,
    });
    expect(sim.read().politics.AAA.capital).toBeCloseTo(30);
    expect(() =>
      sim.apply({
        type: "bloc-propose",
        bloc: "club",
        kind: "sanctions",
        target: "DDD",
        direction: null,
      }),
    ).toThrow(/one-per-month/);
    const pending = bloc("club")(sim.read()).pending;
    expect(pending.length).toBe(1);
    months(1);
    const after = bloc("club")(sim.read());
    expect(after.pending.length).toBe(0);
    expect(after.resolved[0].result).toBe(
      option.projection.adopted ? "adopted" : "rejected",
    );
    if (option.projection.adopted) expect(after.state.programs.length).toBe(1);
  });

  it("a member votes on the proposals of the leader; its vote counts", () => {
    const { sim, months, internals } = campaign({
      nations: { AAA: {}, BBB: {}, CCC: {}, DDD: {} },
      player: "CCC",
      blocs: [
        testBloc({
          id: "club",
          members: ["AAA", "BBB", "CCC"].map((nation) => ({
            nation,
            status: "full" as const,
          })),
          budget: { contributionPctGdp: 0.01, shares: { programs: 1 } },
        }),
      ],
    });
    // The AI leader AAA puts a programme to the vote.
    propose(internals.blocEnv(sim.read().date), {
      bloc: "club",
      by: "AAA",
      kind: "tech-program",
      target: null,
      direction: null,
    });
    const p = bloc("club")(sim.read()).pending[0].proposal;
    sim.apply({ type: "bloc-vote", proposal: p.id, vote: "no" });
    expect(bloc("club")(sim.read()).pending[0].projection.votes.CCC).toBe("no");
    months(1);
    expect(bloc("club")(sim.read()).resolved[0].result).toBe("rejected");
  });
});

describe("collective defence", () => {
  const pact = (members: string[]) =>
    testBloc({
      id: "pact",
      members: members.map((nation) => ({ nation, status: "full" as const })),
      collectiveDefense: {
        joinProbability: 1,
        sovereignJoinProbability: 0,
        sovereigntyAbove: 0.7,
      },
    });

  it("a member attacked by a non-member: the others enter the war within the month, a sovereignist government does not", () => {
    const { sim, months, internals } = campaign({
      nations: { EEE: {}, AAA: {}, BBB: {}, CCC: {}, DDD: {} },
      player: "EEE",
      blocs: [pact(["AAA", "BBB", "CCC", "DDD"])],
    });
    internals.politics.nations.DDD.government.ideology.sovereignty = 0.9;
    internals.politics.nations.CCC.government.ideology.sovereignty = 0;
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    months(1);
    const war = sim.read().diplomacy.wars[0];
    expect([...war.defenders].sort()).toEqual(["AAA", "BBB", "CCC"]);
    expect(sim.read().journal.some((j) => j.kind === "bloc-article5")).toBe(
      true,
    );
  });

  it("no call when the aggressor is a member too", () => {
    const { sim, months } = campaign({
      nations: { AAA: {}, BBB: {}, CCC: {} },
      blocs: [pact(["AAA", "BBB", "CCC"])],
    });
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    months(1);
    expect(sim.read().diplomacy.wars[0].defenders).toEqual(["BBB"]);
  });

  it("the player is called: it honours the call, or loses relations with the members", () => {
    const setup = {
      nations: { AAA: {}, BBB: {}, CCC: {}, EEE: {} },
      player: "AAA",
      blocs: [pact(["AAA", "BBB", "CCC"])],
    };
    for (const honour of [true, false]) {
      const { sim, months, internals } = campaign(setup);
      declareWar(
        internals.ctx,
        internals.diplomacy,
        internals.politics,
        internals.military,
        internals.scenario,
        "EEE",
        "BBB",
        "none",
        sim.read().date,
      );
      months(1);
      const calls = bloc("pact")(sim.read()).calls;
      expect(calls.length).toBe(1);
      const before = relation(sim.read().diplomacy, "AAA", "CCC");
      if (honour) {
        sim.apply({ type: "bloc-honor", bloc: "pact", war: calls[0].war });
        expect(sim.read().diplomacy.wars[0].defenders).toContain("AAA");
      } else {
        months(1);
        expect(bloc("pact")(sim.read()).calls.length).toBe(0);
        expect(
          sim.read().journal.some((j) => j.kind === "bloc-article5-refused"),
        ).toBe(true);
        expect(relation(sim.read().diplomacy, "AAA", "CCC")).toBeLessThan(
          before - 10,
        );
      }
    }
  });
});

describe("budget", () => {
  it("contributions in % of GDP; structural funds to the members under 90 % of the GDP per head, in proportion to the gap; the rest back to the payers; the net pays the next budget", () => {
    const blocs = [
      testBloc({
        id: "union",
        members: ["AAA", "BBB", "CCC"].map((nation) => ({
          nation,
          status: "full" as const,
        })),
        budget: {
          contributionPctGdp: 0.01,
          structuralFundsBelowGdpPerCapitaShare: 0.9,
          shares: { structural: 0.5, candidates: 0.5 },
        },
      }),
    ];
    const nations = {
      XXX: {},
      AAA: { gdp: 1e12 },
      BBB: { gdp: 2e12 },
      CCC: { gdp: 0.5e12 },
    };
    const { sim, months } = campaign({ nations, blocs, player: "XXX" });
    months(1);
    const s = bloc("union")(sim.read()).state;
    expect(s.contributions.BBB).toBeGreaterThan(0);
    const pool =
      s.contributions.AAA + s.contributions.BBB + s.contributions.CCC;
    const received = s.received.AAA + s.received.BBB + s.received.CCC;
    expect(received).toBeCloseTo(pool, 0);
    // GDP per head: AAA 100 k$, BBB 200 k$, CCC 50 k$; threshold 0.9 x 116.7
    // k$ = 105 k$: CCC lacks 55 k$ a head, AAA 5 k$, BBB nothing.
    const structural = pool * 0.5;
    const refund = (share: number) => (pool - structural) * share;
    const cShare = s.contributions.CCC / pool;
    expect(s.received.CCC).toBeCloseTo(
      (structural * 55) / 60 + refund(cShare),
      -6,
    );
    expect(s.received.BBB).toBeCloseTo(refund(s.contributions.BBB / pool), -6);
    expect(s.received.CCC - s.contributions.CCC).toBeGreaterThan(0);
    expect(s.received.BBB - s.contributions.BBB).toBeLessThan(0);
    // The transfer reaches the budget of the next month: CCC borrows less
    // than without the bloc.
    months(2);
    const alone = campaign({ nations, blocs: [], player: "XXX" });
    alone.months(3);
    expect(sim.read().economies.CCC.debt).toBeLessThan(
      alone.sim.read().economies.CCC.debt,
    );
    expect(sim.read().economies.BBB.debt).toBeGreaterThan(
      alone.sim.read().economies.BBB.debt,
    );
  });
});

describe("accession and exit", () => {
  const club = (overrides: Partial<Bloc> = {}) =>
    testBloc({
      id: "club",
      members: ["AAA", "BBB", "CCC"].map((nation) => ({
        nation,
        status: "full" as const,
      })),
      accession: { minRelations: -100, monthsMin: 24, monthsMax: 24 },
      ...overrides,
    });

  it("an application, the opening vote, an annual vote, the final vote: a full member", () => {
    const { sim, months } = campaign({
      nations: { DDD: {}, AAA: {}, BBB: {}, CCC: {} },
      player: "DDD",
      blocs: [club()],
    });
    const criteria = bloc("club")(sim.read()).criteria!;
    expect(criteria.ok).toBe(true);
    sim.apply({ type: "bloc-apply", bloc: "club" });
    months(2);
    const opened = bloc("club")(sim.read()).state.accessions;
    expect(opened.map((a) => a.nation)).toEqual(["DDD"]);
    expect(bloc("club")(sim.read()).playerStatus).toBe("candidate");
    months(26);
    const view = sim.read();
    expect(bloc("club")(view).playerStatus).toBe("full");
    expect(view.journal.some((j) => j.kind === "bloc-joined")).toBe(true);
    expect(
      view.journal.filter(
        (j) => j.kind === "bloc-decision" && j.params.kind === "accession",
      ).length,
    ).toBe(3);
  });

  it("criteria that fail during the process freeze it", () => {
    const { sim, months, internals } = campaign({
      nations: { DDD: { debtToGdp: 0.5 }, AAA: {}, BBB: {}, CCC: {} },
      player: "DDD",
      blocs: [
        club({
          accession: {
            minRelations: -100,
            maxDebtToGdp: 0.6,
            monthsMin: 24,
            monthsMax: 24,
          },
        }),
      ],
    });
    sim.apply({ type: "bloc-apply", bloc: "club" });
    months(2);
    expect(bloc("club")(sim.read()).state.accessions.length).toBe(1);
    const e = internals.economy.nations.DDD;
    e.debt = e.gdp * 0.9;
    months(12);
    expect(bloc("club")(sim.read()).state.accessions.length).toBe(0);
    const frozen = sim
      .read()
      .journal.find((j) => j.kind === "bloc-accession-frozen");
    expect(frozen?.params.why).toBe("criteria");
  });

  it("a bloc by invitation takes no application", () => {
    const { sim } = campaign({
      nations: { DDD: {}, AAA: {} },
      player: "DDD",
      blocs: [
        testBloc({ id: "g", members: [{ nation: "AAA", status: "full" }] }),
      ],
    });
    expect(bloc("g")(sim.read()).criteria).toBeNull();
    expect(() => sim.apply({ type: "bloc-apply", bloc: "g" })).toThrow(
      /invitation/,
    );
  });

  it("an exit takes effect after the delay and costs its share of GDP", () => {
    const blocs = [club({ exit: { delayMonths: 3, tradeCostPctGdp: 0.02 } })];
    const nations = { AAA: {}, BBB: {}, CCC: {} };
    const leaving = campaign({ nations, blocs });
    const staying = campaign({ nations, blocs });
    leaving.sim.apply({ type: "bloc-leave", bloc: "club" });
    leaving.months(4);
    staying.months(4);
    const view = leaving.sim.read();
    expect(bloc("club")(view).playerStatus).toBeNull();
    expect(view.journal.some((j) => j.kind === "bloc-left")).toBe(true);
    expect(
      view.economies.AAA.gdp / staying.sim.read().economies.AAA.gdp,
    ).toBeCloseTo(0.98, 2);
  });
});

describe("save", () => {
  it("the bloc state round-trips byte for byte", () => {
    const { sim, months } = campaign({
      nations: { AAA: { personnel: 150_000 }, BBB: {}, CCC: {}, DDD: {} },
      blocs: [
        testBloc({
          id: "club",
          competencies: ["sanctions"],
          members: ["CCC", "BBB", "DDD"].map((nation) => ({
            nation,
            status: "full" as const,
          })),
          budget: { contributionPctGdp: 0.01, shares: { programs: 1 } },
        }),
      ],
    });
    sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
    months(6);
    const bytes = encodeSave(sim.snapshot());
    expect(sim.snapshot().blocs.proposals.length).toBeGreaterThan(0);
    const restored = new VeritableSimImpl({
      config: quietConfig(),
      world: new MemoryWorld(4, 4),
      data: testSimData(["AAA", "BBB", "CCC", "DDD"], {
        blocs: [
          testBloc({
            id: "club",
            competencies: ["sanctions"],
            members: ["CCC", "BBB", "DDD"].map((nation) => ({
              nation,
              status: "full" as const,
            })),
            budget: { contributionPctGdp: 0.01, shares: { programs: 1 } },
          }),
        ],
      }),
      nationData: (id) => {
        const sheet = testNation(id);
        if (id === "AAA") sheet.military.activePersonnel = 150_000;
        return sheet;
      },
    });
    restored.restore(decodeSave(bytes));
    expect(encodeSave(restored.snapshot())).toEqual(bytes);
  });
});
