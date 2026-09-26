import { loadVeritableConfig } from "../../data/loadConfig";
import { VeritableConfig } from "../../data/schemas/config";
import { NationData } from "../../data/schemas/nation";
import { NationPolitics } from "../../data/schemas/save";
import { decodeSave, encodeSave } from "../../save/serialize";
import { Rng } from "../rng";
import { MemoryWorld } from "../testing/MemoryWorld";
import {
  testNation,
  TestNationOptions,
  testScenario,
} from "../testing/nations";
import { testBloc, testLeaders, testSimData } from "../testing/simData";
import { DAYS_PER_MONTH } from "../time";
import { SimEvent } from "../VeritableSim";
import { VeritableSimImpl } from "../VeritableSimImpl";
import { coupBaseOf } from "./coups";
import {
  holdElection,
  incumbencyFatigue,
  projectShares,
  runoffOf,
} from "./elections";
import { affinity, insideWindow } from "./ideology";
import { ageAt, yearlyDeathProbability } from "./leaders";

const DAY = 1440;

function quietConfig(): VeritableConfig {
  const config = structuredClone(loadVeritableConfig());
  config.economy.growth.noiseMonthlySd = 0;
  config.economy.rowSupplyNoise.monthlySd = 0;
  config.politics.aiShock.sd = 0;
  return config;
}

interface Setup {
  nations: Record<string, TestNationOptions>;
  config?: VeritableConfig;
  leaders?: Parameters<typeof testLeaders>[1];
  seed?: number;
}

function campaign(setup: Setup) {
  const ids = Object.keys(setup.nations);
  const sheets = new Map<string, NationData>(
    ids.map((id) => [id, testNation(id, setup.nations[id])]),
  );
  const sim = new VeritableSimImpl({
    config: setup.config ?? quietConfig(),
    world: new MemoryWorld(4, 4),
    data: testSimData(ids, {
      leaders: Object.fromEntries(
        ids.map((id) => [id, testLeaders(id, setup.leaders)]),
      ),
    }),
    nationData: (id) => sheets.get(id),
  });
  sim.init(testScenario(ids), setup.seed ?? 7);
  const events: SimEvent[] = [];
  const months = (n: number) => {
    for (let d = 0; d < 31 * n; d++) {
      events.push(...sim.advance(DAY).filter((e) => e.type !== "day-started"));
    }
  };
  return { sim, events, months, sheets };
}

// AAA plays (parliamentary, election due 2028-01-01: last 2024-01-01 + 48).
const two: Setup = { nations: { AAA: {}, BBB: {} } };

describe("the political state of the first day", () => {
  it("has a regime, a legitimacy at its base, a leader, parties, a government and a next election", () => {
    const { sim } = campaign(two);
    const p = live(sim, "AAA");
    expect(p.regime).toBe("parliamentary");
    expect(p.legitimacy).toBe(0.8);
    expect(p.capital).toBe(30);
    expect(p.leader.id).toBe("aaa-pm");
    expect(p.leader.name).toEqual({ kind: "key", key: "leader.aaa.pm.parody" });
    expect(p.parties.map((x) => x.id)).toEqual(["aaa-left", "aaa-right"]);
    // A coalition regime: the left (55 %) governs alone.
    expect(p.government.parties).toEqual(["aaa-left"]);
    expect(p.nextElection).toBe("2028-01-01");
    expect(p.laws).toEqual([]);
    // Stability counts the legitimacy of the regime.
    expect(p.stability).toBeCloseTo(0.25 + 0.2 + 0.15 + 0.15 * 0.8, 9);
  });

  it("the fictional name switch changes the key of a real leader", () => {
    const config = quietConfig();
    config.leaderNames = "fictional";
    const { sim } = campaign({ ...two, config });
    expect(sim.read().politics.AAA.leader.name).toEqual({
      kind: "key",
      key: "leader.aaa.pm.fictional",
    });
  });
});

describe("elections", () => {
  it("affinity falls with the ideological distance and rises with charisma", () => {
    const g = { economic: 0, authority: 0, sovereignty: 0 };
    expect(affinity(g, g, 0, 0.9)).toBe(1);
    expect(affinity(g, { ...g, economic: 0.9 }, 0, 0.9)).toBeCloseTo(
      Math.exp(-1),
      9,
    );
    expect(affinity(g, g, 0.5, 0.9)).toBe(1.5);
  });

  it("the projection sums to one and an unhappy electorate drops the incumbent", () => {
    const { sim } = campaign(two);
    const p = live(sim, "AAA");
    const happy = projectShares(quietCtx(sim), p, undefined);
    const total = Object.values(happy).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 9);
    for (const g of Object.keys(p.groups!)) p.groups![g] = 0.1;
    const unhappy = projectShares(quietCtx(sim), p, undefined);
    expect(unhappy["aaa-left"]).toBeLessThan(happy["aaa-left"]);
  });

  it("a due election is held, forms a government and journals it; a victory earns capital", () => {
    const { sim, months, events } = campaign(two);
    months(25); // 2028-02
    const p = live(sim, "AAA");
    expect(p.lastElection).not.toBeNull();
    expect(p.lastElection!.date).toBe("2028-01-01");
    expect(p.nextElection).toBe("2032-01-01");
    expect(events.map((e) => e.type)).toContain("election-held");
    expect(events.map((e) => e.type)).toContain("government-formed");
    const journal = sim.read().journal.map((j) => j.kind);
    expect(journal).toContain("election-held");
    // Both nations voted (the AI one on its proxy opinion).
    expect(sim.read().politics.BBB.lastElection).not.toBeNull();
  });

  it("propaganda and fraud move shares to the incumbent; fraud with a free press is caught most of the time", () => {
    const { sim } = campaign(two);
    const ctx = quietCtx(sim);
    const p = live(sim, "AAA");
    const base = projectShares(ctx, p, undefined)["aaa-left"];
    sim.apply({ type: "set-lever", propagandaPctGdp: 0.02 });
    const propaganda = projectShares(ctx, p, undefined)["aaa-left"];
    expect(propaganda).toBeGreaterThan(base + 0.05);
    sim.apply({ type: "set-lever", propagandaPctGdp: 0, fraud: 0.2 });
    const fraud = projectShares(ctx, p, undefined)["aaa-left"];
    expect(fraud).toBeCloseTo(base + 0.2, 6);

    // Delivery test: 20 % of fraud with a free press (0.9) is detected in
    // more than 60 % of the elections.
    let detected = 0;
    const runs = 1000;
    for (let i = 0; i < runs; i++) {
      const trial = structuredClone(p);
      trial.levers.fraud = 0.2;
      const outcome = holdElection(
        ctx,
        new Rng(1000 + i),
        "AAA",
        trial,
        undefined,
        "2028-01-01",
      );
      if (outcome.events.some((e) => e.type === "fraud-detected")) detected++;
    }
    expect(detected / runs).toBeGreaterThan(0.6);
    expect(detected / runs).toBeLessThan(0.9);

    // A detected fraud costs legitimacy, stability and the democracies.
    const trial = structuredClone(p);
    trial.levers.fraud = 0.3;
    trial.pressFreedom = 1;
    const outcome = holdElection(
      ctx,
      new Rng(3),
      "AAA",
      trial,
      undefined,
      "2028-01-01",
    );
    expect(outcome.events.map((e) => e.type)).toContain("fraud-detected");
    expect(trial.legitimacy).toBeCloseTo(0.8 - 0.3, 9);
    expect(trial.fraudCoupUntil).toBe("2029-01-01");
    expect(outcome.democracyRelations).toBe(-30);
  });

  it("an alternation brings a new leader, resets the capital and repeals the laws outside the new window", () => {
    const { sim, months, events } = campaign({
      ...two,
      // The incumbent left governs alone with a dull leader: unhappy groups
      // and a charismatic opposition bring the right to power.
      leaders: { incumbentSupport: 0.55, charisma: 0 },
    });
    // The left government passes a left law before the election.
    live(sim, "AAA").capital = 100;
    sim.apply({ type: "enact-law", law: "wealth-tax" });
    expect(sim.read().politics.AAA.laws.map((l) => l.id)).toEqual([
      "wealth-tax",
    ]);
    // J7: the vote of the first day gives back the last election (55 % for
    // the left): only angry groups, kept angry up to the vote, turn it.
    for (let m = 0; m < 25; m++) {
      for (const g of Object.keys(live(sim, "AAA").groups!)) {
        live(sim, "AAA").groups![g] = 0.1;
      }
      months(1);
    }
    const p = live(sim, "AAA");
    expect(p.lastElection!.alternation).toBe(true);
    expect(p.government.parties[0]).toBe("aaa-right");
    expect(p.leader.id).toBe("aaa-opposition");
    expect(p.alternations).toBe(1);
    // The wealth tax (window: economic <= -0.1) is outside the right's window.
    expect(events.map((e) => e.type)).toContain("law-repeal-announced");
    expect(p.repealing.map((r) => r.id)).toEqual(["wealth-tax"]);
    months(13);
    expect(sim.read().politics.AAA.laws).toEqual([]);
    expect(sim.read().journal.map((j) => j.kind)).toContain("law-repealed");
  });
});

describe("the vote of the J7", () => {
  it("fits the attachment of each party so that the first day gives back the last election", () => {
    const { sim } = campaign({
      nations: { AAA: {}, BBB: {} },
      leaders: { incumbentSupport: 0.3, charisma: 0.9 },
    });
    // The charismatic left would take most of the vote by ideology alone.
    const projection = sim.read().electionProjection!;
    expect(projection["aaa-left"]).toBeCloseTo(0.3, 3);
    expect(projection["aaa-right"]).toBeCloseTo(0.7, 3);
  });

  it("a runoff: the first of the first round loses to the second, whom the third party's voters join", () => {
    const { sim, sheets } = campaign({ nations: { AAA: {}, BBB: {} } });
    const ctx = quietCtx(sim);
    const p = live(sim, "AAA");
    const party = (
      id: string,
      support: number,
      ideology: { economic: number; authority: number; sovereignty: number },
    ) => ({ ...p.parties[0], id, support, base: 1, ideology });
    p.regime = "semi-presidential";
    p.parties = [
      party("extreme", 0.4, {
        economic: 0.1,
        authority: 0.9,
        sovereignty: 0.9,
      }),
      party("centre", 0.35, {
        economic: 0.3,
        authority: -0.1,
        sovereignty: -0.5,
      }),
      party("left", 0.25, {
        economic: -0.4,
        authority: -0.3,
        sovereignty: -0.4,
      }),
    ];
    p.government = {
      parties: ["centre"],
      since: "2026-01-01",
      ideology: p.parties[1].ideology,
    };
    const sheet = sheets.get("AAA")!;
    const shares = { extreme: 0.4, centre: 0.35, left: 0.25 };
    expect(runoffOf(ctx, p, sheet, shares)).toBeNull();
    sheet.politics.runoff = true;
    const runoff = runoffOf(ctx, p, sheet, shares)!;
    expect(runoff.a).toBe("extreme");
    expect(runoff.b).toBe("centre");
    expect(runoff.winner).toBe("centre");
    expect(runoff.share).toBeGreaterThan(0.5);
  });

  it("the cost of governing: the longer in power, the fewer votes; a re-elected party keeps its years", () => {
    const { sim } = campaign({ nations: { AAA: {}, BBB: {} } });
    const ctx = quietCtx(sim);
    const p = live(sim, "AAA");
    const now = projectShares(ctx, p, undefined, "2026-01-01")["aaa-left"];
    const later = projectShares(ctx, p, undefined, "2034-01-01")["aaa-left"];
    expect(later).toBeLessThan(now);
    expect(incumbencyFatigue(ctx, p, "2034-01-01")).toBeCloseTo(
      1 - 8 * ctx.config.politics.elections.incumbencyFatiguePerYear,
      2,
    );
    expect(incumbencyFatigue(ctx, p, "2076-01-01")).toBe(
      ctx.config.politics.elections.incumbencyFatigueFloor,
    );
  });
});

describe("laws, capital and sliders", () => {
  it("a law costs capital, is refused outside the window, by the regime, or without capital", () => {
    const { sim } = campaign(two);
    const p = live(sim, "AAA");
    p.capital = 100;
    sim.apply({ type: "enact-law", law: "housing-programme" });
    expect(p.laws.map((l) => l.id)).toEqual(["housing-programme"]);
    expect(p.capital).toBe(80);
    // Once: social spending target up; while: youth offset.
    expect(sim.read().economies.AAA.spendingTargets.social).toBeCloseTo(
      0.18 + 0.005,
      9,
    );
    // The left government (economic -0.4): a corporate tax cut (>= 0) is
    // outside its window.
    sim.apply({ type: "enact-law", law: "corporate-tax-cut" });
    expect(p.laws.length).toBe(1);
    expect(sim.read().journal[sim.read().journal.length - 1]).toMatchObject({
      kind: "law-refused",
      params: { law: "corporate-tax-cut", reason: "window" },
    });
    // Term limits: not for a parliamentary regime.
    sim.apply({ type: "enact-law", law: "term-limits-removal" });
    expect(
      sim.read().journal[sim.read().journal.length - 1].params.reason,
    ).toBe("regime");
    p.capital = 5;
    sim.apply({ type: "enact-law", law: "renewable-subsidies" });
    expect(
      sim.read().journal[sim.read().journal.length - 1].params.reason,
    ).toBe("capital");
    // Repeal by the player costs the reversal.
    p.capital = 100;
    sim.apply({ type: "repeal-law", law: "housing-programme" });
    expect(p.laws).toEqual([]);
    expect(p.capital).toBe(85);
  });

  it("laws in force shift the satisfaction targets of the groups", () => {
    const withLaw = campaign(two);
    const without = campaign(two);
    live(withLaw.sim, "AAA").capital = 100;
    withLaw.sim.apply({ type: "enact-law", law: "tuition-free-university" });
    withLaw.months(6);
    without.months(6);
    expect(withLaw.sim.read().politics.AAA.groups!.youth).toBeGreaterThan(
      without.sim.read().politics.AAA.groups!.youth + 0.03,
    );
  });

  it("capital regenerates with charisma and opinion up to the cap", () => {
    const { sim, months } = campaign(two);
    const p = live(sim, "AAA");
    p.capital = 0;
    months(1);
    // 3 x (0.5 + 0.5) x (0.5 + opinion ~0.5) = 3.
    expect(p.capital).toBeCloseTo(3, 1);
    p.capital = 99;
    months(2);
    expect(p.capital).toBe(100);
  });

  it("sliders reach their target progressively", () => {
    const { sim, months } = campaign(two);
    const e = sim.read().economies.AAA;
    const before = e.taxes.vat;
    sim.apply({ type: "set-tax", tax: "vat", rate: before + 0.06 });
    expect(e.taxes.vat).toBe(before);
    months(1);
    // J7: the player's nation is updated every day; after 31 days its last
    // update covers 30.5 days: 1 - (5/6)^(30.5 / 30.4375) of the gap.
    const covered = 30.5 / DAYS_PER_MONTH;
    expect(e.taxes.vat).toBeCloseTo(
      before + 0.06 * (1 - Math.pow(5 / 6, covered)),
      9,
    );
    months(12);
    expect(e.taxes.vat).toBeGreaterThan(before + 0.05);
  });

  it("a constitutional reform needs legitimacy and changes the regime", () => {
    const { sim } = campaign(two);
    const p = live(sim, "AAA");
    p.capital = 100;
    p.legitimacy = 0.5;
    sim.apply({ type: "enact-law", law: "constitutional-reform-presidential" });
    expect(p.regime).toBe("parliamentary");
    expect(
      sim.read().journal[sim.read().journal.length - 1].params.reason,
    ).toBe("legitimacy");
    p.legitimacy = 0.8;
    sim.apply({ type: "enact-law", law: "constitutional-reform-presidential" });
    expect(p.regime).toBe("presidential");
    expect(sim.read().journal.map((j) => j.kind)).toContain("regime-changed");
  });
});

describe("coups, revolutions and the AI", () => {
  it("an electoral autocracy without a coup attempt since 1990 has the coup base of a parliamentary democracy while its regime of the first day lasts (J7)", () => {
    const { sim, sheets } = campaign({
      nations: {
        AAA: {},
        BBB: { regime: "electoral-authoritarian" },
        CCC: { regime: "electoral-authoritarian" },
      },
    });
    const history = (attemptSince1990: boolean) => ({
      attemptSince1990,
      source: "estimate",
      asOf: "2026-01-01",
    });
    sheets.get("BBB")!.coupHistory = history(false);
    sheets.get("CCC")!.coupHistory = history(true);
    const ctx = quietCtx(sim);
    const base = (id: string) => coupBaseOf(ctx, id, live(sim, id));
    const of = (regime: Parameters<typeof ctx.regime>[0]) =>
      ctx.regime(regime).coupBase;
    expect(base("BBB")).toBe(of("parliamentary"));
    expect(base("CCC")).toBe(of("electoral-authoritarian"));
    expect(base("AAA")).toBe(of("parliamentary"));
    // A regime born in the campaign carries its own risk.
    const bbb = live(sim, "BBB");
    bbb.regimeBefore = "electoral-authoritarian";
    bbb.regime = "junta";
    expect(base("BBB")).toBe(of("junta"));
  });

  it("a low-legitimacy, unstable state with angry soldiers falls to a coup, keeps its player, and is suspended by its bloc", () => {
    const config = quietConfig();
    config.politics.coups.failureShare = 0;
    const blocs = [
      testBloc({
        id: "club",
        members: [
          { nation: "AAA", status: "full" },
          { nation: "BBB", status: "full" },
        ],
        tradeBonus: 1.5,
        suspendsOnCoup: true,
      }),
    ];
    const ids = ["AAA", "BBB"];
    const sheets = new Map(
      ids.map((id) => [id, testNation(id, { blocs: ["club"] })]),
    );
    const sim = new VeritableSimImpl({
      config,
      world: new MemoryWorld(4, 4),
      data: testSimData(ids, { blocs }),
      nationData: (id) => sheets.get(id),
    });
    sim.init(testScenario(ids), 5);
    const p = live(sim, "AAA");
    p.legitimacy = 0;
    p.stability = 0;
    p.groups!.military = 0;
    // coupBase 0.02 -> p = 0.02 x 4 x (1 - 0)^2 x (1 + 2 x 1) x (1 - 0)
    //                     x (1 + 0) = 0.24 a month
    p.regime = "failed-state";
    p.regimeSince = "2020-01-01";
    // J7: the soldiers stay angry and the state illegitimate month after
    // month (the daily update of the player's nation brings them back
    // towards their targets): about 0.14 a month.
    let coup = false;
    for (let m = 0; m < 36 && !coup; m++) {
      p.legitimacy = 0;
      p.groups!.military = 0;
      for (let d = 0; d < 31; d++) sim.advance(DAY);
      coup = sim.read().politics.AAA.coups > 0;
    }
    expect(coup).toBe(true);
    const after = sim.read().politics.AAA;
    expect(after.regime).toBe("junta");
    expect(after.leader.role).toBe("military-chief");
    expect(after.leader.name.kind).toBe("literal");
    expect(after.legitimacy).toBe(0.4);
    expect(after.suspendedFrom).toEqual(["club"]);
    expect(sim.read().playerNation).toBe("AAA");
    expect(sim.read().journal.map((j) => j.kind)).toContain("coup-succeeded");
    expect(sim.read().journal.map((j) => j.kind)).toContain("bloc-suspended");
    // The nation's groups are still there: the player goes on.
    expect(after.groups).not.toBeNull();
  });

  it("no coup in the twelve months after a regime change; a junta hands power back after a while", () => {
    const config = quietConfig();
    config.politics.coups.failureShare = 0;
    config.politics.coups.juntaTransitionMonths = 12;
    config.politics.coups.juntaTransitionMonthlyProbability = 1;
    const { sim, months } = campaign({ ...two, config });
    const p = live(sim, "AAA");
    p.legitimacy = 0;
    p.stability = 0;
    p.groups!.military = 0;
    p.regime = "junta";
    p.regimeBefore = "presidential";
    p.regimeSince = "2026-01-01";
    months(11);
    // Consolidation: twelve months without any attempt, whatever the odds.
    expect(p.coups).toBe(0);
    expect(p.coupRisk).toBe(0);
    months(1);
    // Then the junta (started 2026-01) hands power back to civilians: the
    // democratic regime it overthrew.
    expect(sim.read().journal.map((j) => j.kind)).toContain(
      "civilian-transition",
    );
    expect(p.regime).toBe("presidential");
    expect(p.nextElection).not.toBeNull();
  });

  it("the J5 coup formula: no grace at the start of the campaign, and a stable democracy with content soldiers hardly ever falls", () => {
    const config = quietConfig();
    const { sim, months } = campaign({ ...two, config });
    const p = live(sim, "AAA");
    // A regime that was there on the first day has no consolidation.
    p.regime = "junta";
    p.regimeBefore = null;
    p.regimeSince = "2026-01-01";
    p.legitimacy = 0.4;
    p.stability = 0.5;
    p.groups!.military = 0.5;
    months(1);
    // 0.005 x 4 x 0.5^2 x (1 + 2 x (1 - s)) x (1 - 0.4) x (1 + 0), with the
    // stability of the month (the weekly step moves it).
    const s = p.stability;
    expect(p.coupRisk).toBeCloseTo(
      0.005 * 4 * 0.25 * (1 + 2 * (1 - s)) * 0.6,
      6,
    );
    // Parliamentary, stability 0.8, legitimacy 0.8, soldiers at 0.6: about
    // one chance in a hundred thousand a month.
    p.regime = "parliamentary";
    p.legitimacy = 0.8;
    p.stability = 0.8;
    p.groups!.military = 0.6;
    months(1);
    expect(p.coupRisk).toBeLessThan(1e-4);
  });

  it("three angry groups and a long instability bring a revolution and elections in six months", () => {
    const config = quietConfig();
    config.politics.revolution.monthlyProbability = 1;
    // The weekly step pulls the groups back towards their targets and
    // recomputes the stability: loosen the thresholds so that the anger
    // set below is still there at the month.
    config.politics.revolution.angryBelow = 0.4;
    config.politics.revolution.stabilityBelow = 1;
    config.politics.revolution.lowStabilityMonths = 1;
    const { sim, months } = campaign({ ...two, config });
    const p = live(sim, "AAA");
    for (let m = 0; m < 3; m++) {
      p.groups!.youth = 0.1;
      p.groups!.workers = 0.1;
      p.groups!.minorities = 0.1;
      months(1);
    }
    const after = sim.read().politics.AAA;
    expect(after.revolutions).toBeGreaterThanOrEqual(1);
    // 0.5 at the revolution, then +0.01 a month, day after day (J7).
    expect(after.legitimacy).toBeGreaterThanOrEqual(0.5);
    expect(after.legitimacy).toBeLessThan(0.52);
    expect(sim.read().journal.map((j) => j.kind)).toContain("revolution");
    expect(after.nextElection).not.toBeNull();
  });

  it("the leader ages and a dead leader is replaced by the party", () => {
    expect(ageAt("1970-06-15", "2026-06-14")).toBe(55);
    expect(ageAt("1970-06-15", "2026-06-15")).toBe(56);
    // J5 mortality: 0.001 x e^(0.085 x (age - 30)), about 7 % a year at 80.
    const leaders = quietConfig().politics.leaders;
    expect(yearlyDeathProbability(leaders, 30)).toBeCloseTo(0.001, 6);
    expect(yearlyDeathProbability(leaders, 80)).toBeGreaterThan(0.065);
    expect(yearlyDeathProbability(leaders, 80)).toBeLessThan(0.075);
    const { sim, months } = campaign(two);
    const p = live(sim, "AAA");
    p.leader.born = "1850-01-01"; // far beyond any age: certain death
    let died = false;
    for (let m = 0; m < 120 && !died; m++) {
      months(1);
      died = sim.read().journal.some((j) => j.kind === "leader-died");
    }
    expect(died).toBe(true);
    const after = sim.read().politics.AAA;
    expect(after.leader.id).not.toBe("aaa-pm");
    expect(after.leader.party).toBe("aaa-left");
    expect(after.leader.name.kind).toBe("literal");
    expect(sim.read().journal.map((j) => j.kind)).toContain("leader-succeeded");
  });

  it("AI nations take random opinion shocks in proportion to the fragility of their regime", () => {
    const config = quietConfig();
    config.politics.aiShock.sd = 0.1;
    const fragile = campaign({
      nations: { AAA: {}, BBB: { regime: "junta" } },
      config,
    });
    const solid = campaign({ nations: { AAA: {}, BBB: {} }, config });
    fragile.months(24);
    solid.months(24);
    // Same seed, same draws: the junta (legitimacy 0.4, coupBase 0.03)
    // moves more than the parliamentary state (0.8, 0.001).
    const f = fragile.sim.read().politics.BBB.opinion;
    const s = solid.sim.read().politics.BBB.opinion;
    expect(Math.abs(f - 0.5)).toBeGreaterThan(Math.abs(s - 0.5));
  });
});

describe("objectives, notes and the save", () => {
  it("pins up to five objectives, tracks progress, completes and rewards", () => {
    const { sim, months } = campaign(two);
    sim.apply({ type: "pin-objective", objective: "double-gdp" });
    sim.apply({ type: "pin-objective", objective: "legitimate-state" });
    expect(sim.read().objectives.map((o) => o.id)).toEqual([
      "double-gdp",
      "legitimate-state",
    ]);
    expect(() =>
      sim.apply({ type: "pin-objective", objective: "no-such-objective" }),
    ).toThrow(/unknown objective/);
    for (const id of ["join-eu", "stable-five-years", "ten-years-peace"]) {
      sim.apply({ type: "pin-objective", objective: id });
    }
    expect(() =>
      sim.apply({ type: "pin-objective", objective: "debt-below-sixty" }),
    ).toThrow(/five/);
    sim.apply({ type: "unpin-objective", objective: "join-eu" });
    expect(sim.read().objectives.map((o) => o.id)).not.toContain("join-eu");
    const p = live(sim, "AAA");
    p.legitimacy = 0.95;
    const capital = p.capital;
    months(1);
    const done = sim
      .read()
      .objectives.find((o) => o.id === "legitimate-state")!;
    expect(done.done).toBe(true);
    expect(sim.read().politics.AAA.capital).toBeGreaterThan(capital + 15);
    expect(sim.read().journal.map((j) => j.kind)).toContain(
      "objective-completed",
    );
    // Progress of the GDP objective is a fraction of the way to x2.
    const gdp = sim.read().objectives.find((o) => o.id === "double-gdp")!;
    expect(gdp.progress).toBeGreaterThanOrEqual(0);
    expect(gdp.progress).toBeLessThan(0.1);
  });

  it("notes go to the journal and the save", () => {
    const { sim } = campaign(two);
    sim.apply({ type: "add-note", text: "Ne pas oublier la Bretagne." });
    expect(sim.read().notes).toEqual([
      { date: "2026-01-01", text: "Ne pas oublier la Bretagne." },
    ]);
    expect(sim.read().journal[sim.read().journal.length - 1]).toMatchObject({
      kind: "note",
      params: { text: "Ne pas oublier la Bretagne." },
    });
  });

  it("the political state round-trips through the save file and continues identically", () => {
    const { sim, months } = campaign(two);
    live(sim, "AAA").capital = 100;
    sim.apply({ type: "enact-law", law: "housing-programme" });
    sim.apply({
      type: "set-lever",
      propagandaPctGdp: 0.01,
      clientelism: "youth",
    });
    sim.apply({ type: "pin-objective", objective: "double-gdp" });
    sim.apply({ type: "add-note", text: "note" });
    months(26); // past the election of 2028
    const bytes = encodeSave(sim.snapshot());
    const restored = new VeritableSimImpl({
      config: quietConfig(),
      world: new MemoryWorld(4, 4),
      data: testSimData(["AAA", "BBB"]),
      nationData: (id) => testNation(id),
    });
    restored.restore(decodeSave(bytes));
    expect(encodeSave(restored.snapshot())).toEqual(bytes);
    for (let d = 0; d < 31 * 3; d++) {
      sim.advance(DAY);
      restored.advance(DAY);
    }
    expect(encodeSave(restored.snapshot())).toEqual(encodeSave(sim.snapshot()));
    expect(restored.read().politics.AAA.lastElection).not.toBeNull();
    expect(restored.read().objectives.length).toBe(1);
  });
});

// The live, mutable political state of a nation (the view is read-only by
// type only: the simulation returns its own objects).
function live(sim: VeritableSimImpl, id: string): NationPolitics {
  return sim.read().politics[id] as NationPolitics;
}

// The context of a running simulation (a private field, read for the pure
// helpers).
function quietCtx(sim: VeritableSimImpl) {
  return (sim as unknown as { ctx: Parameters<typeof projectShares>[0] }).ctx;
}

it("laws' windows are boxes on the three axes", () => {
  const window = {
    economic: [-1, 0.2] as [number, number],
    authority: [-1, 1] as [number, number],
    sovereignty: [-1, 1] as [number, number],
  };
  expect(
    insideWindow(window, { economic: 0, authority: 0.9, sovereignty: -0.9 }),
  ).toBe(true);
  expect(
    insideWindow(window, { economic: 0.3, authority: 0, sovereignty: 0 }),
  ).toBe(false);
});
