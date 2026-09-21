import { loadVeritableConfig } from "../../data/loadConfig";
import { Bloc } from "../../data/schemas/bloc";
import { VeritableConfig } from "../../data/schemas/config";
import { NationData } from "../../data/schemas/nation";
import { MemoryWorld } from "../testing/MemoryWorld";
import {
  testNation,
  TestNationOptions,
  testScenario,
} from "../testing/nations";
import { testRow, testSimData } from "../testing/simData";
import { SimEvent } from "../VeritableSim";
import { VeritableSimImpl } from "../VeritableSimImpl";
import { buildContext } from "./context";
import { effectiveProduction } from "./engine";
import { initEconomy } from "./init";

const DAY = 1440;

// Deterministic: no growth noise, no supply shock of the rest of the world.
function quietConfig(): VeritableConfig {
  const config = structuredClone(loadVeritableConfig());
  config.economy.growth.noiseMonthlySd = 0;
  config.economy.rowSupplyNoise.monthlySd = 0;
  return config;
}

interface Setup {
  nations: Record<string, TestNationOptions>;
  row?: Parameters<typeof testRow>;
  blocs?: Bloc[];
  autopilot?: boolean;
  config?: VeritableConfig;
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
      row: testRow(...(setup.row ?? [])),
      blocs: setup.blocs,
    }),
    nationData: (id) => sheets.get(id),
    autopilot: setup.autopilot,
  });
  sim.init(testScenario(ids), 7);
  const events: SimEvent[] = [];
  const months = (n: number) => {
    for (let d = 0; d < 31 * n; d++) {
      events.push(...sim.advance(DAY).filter((e) => e.type !== "day-started"));
    }
  };
  return { sim, events, months };
}

describe("budget", () => {
  it("day one: revenue matches the observed share of GDP, debt pays interest", () => {
    const { sim, months } = campaign({
      nations: { AAA: { gdp: 1.2e12, debtToGdp: 0.5 } },
    });
    months(1);
    const e = sim.read().economies.AAA;
    const p = sim.read().politics.AAA;
    const monthlyGdp = e.gdp / 12;
    expect(e.revenue / monthlyGdp).toBeCloseTo(0.4, 2); // 40 % of GDP
    const config = loadVeritableConfig().budget.interest;
    expect(e.interestRate).toBeCloseTo(
      config.base + config.instabilitySlope * (1 - p.stability),
      2,
    );
    expect(e.interest).toBeGreaterThan(0);
    expect(e.balances).toHaveLength(1);
    expect(e.balances[0]).toBeCloseTo(e.revenue - e.expenditure, 0);
  });

  it("the interest rate rises with debt above 60 % of GDP", () => {
    const low = campaign({ nations: { AAA: { debtToGdp: 0.5 } } });
    const high = campaign({ nations: { AAA: { debtToGdp: 1.4 } } });
    low.months(1);
    high.months(1);
    expect(high.sim.read().economies.AAA.interestRate).toBeGreaterThan(
      low.sim.read().economies.AAA.interestRate + 0.005,
    );
  });

  it("forced austerity: debt above 150 % and rising for a year caps the posts", () => {
    const { sim, events, months } = campaign({
      nations: { AAA: { debtToGdp: 1.55, revenuePctGdp: 0.37 } },
    });
    months(14);
    expect(events.map((e) => e.type)).toContain("austerity-started");
    const e = sim.read().economies.AAA;
    expect(e.austerity).toBe(true);
    const cap = loadVeritableConfig().budget.austerity.spendingCap;
    expect(e.spending.social).toBeCloseTo(e.spending0.social * cap, 9);
    // The player cannot spend past the cap while it lasts.
    sim.apply({ type: "set-spending", post: "social", share: 0.3 });
    expect(sim.read().economies.AAA.spending.social).toBeCloseTo(
      e.spending0.social * cap,
      9,
    );
    expect(sim.read().journal.map((j) => j.kind)).toContain(
      "austerity-started",
    );
  });

  it("default at 200 % of GDP: haircut, no deficit for five years, opinion hit", () => {
    const { sim, events, months } = campaign({
      nations: { AAA: { debtToGdp: 1.98, revenuePctGdp: 0.3 } },
    });
    months(4);
    const at = events.find((e) => e.type === "sovereign-default");
    expect(at).toBeDefined();
    const e = sim.read().economies.AAA;
    expect(e.defaults).toBe(1);
    expect(e.debt / e.gdp).toBeLessThan(1.1); // halved
    expect(e.noDeficitUntil).toBe(
      `${Number(at!.date.slice(0, 4)) + 5}${at!.date.slice(4)}`,
    );
    // From then on nobody lends: spending is cut down to revenue.
    months(3);
    const after = sim.read().economies.AAA;
    expect(after.balances[after.balances.length - 1]).toBeGreaterThanOrEqual(
      -1,
    );
    expect(sim.read().journal.map((j) => j.kind)).toContain(
      "sovereign-default",
    );
  });
});

describe("player commands and the political core", () => {
  const two = { nations: { AAA: {}, BBB: {} } };

  it("eight groups for the player's nation, none for the others", () => {
    const { sim } = campaign(two);
    const politics = sim.read().politics;
    expect(Object.keys(politics.AAA.groups!)).toHaveLength(8);
    expect(politics.BBB.groups).toBeNull();
    expect(politics.AAA.opinion).toBe(0.5);
    // 0.5 x opinion + 0.2 x (1 - shortage) + 0.15 x debt health + 0.15 x 0.7
    expect(politics.AAA.stability).toBeCloseTo(0.25 + 0.2 + 0.15 + 0.105, 9);
  });

  it("raising VAT brings money in and angers workers; opinion and stability follow", () => {
    const { sim, months } = campaign(two);
    months(1);
    const before = structuredClone(sim.read()); // read() is a live view
    const vat = before.economies.AAA.taxes.vat;
    sim.apply({ type: "set-tax", tax: "vat", rate: vat + 0.08 });
    months(3);
    const after = sim.read();
    expect(after.economies.AAA.revenue).toBeGreaterThan(
      before.economies.AAA.revenue * 1.05,
    );
    expect(after.politics.AAA.groups!.workers).toBeLessThan(0.47);
    expect(after.politics.AAA.groups!.military).toBeCloseTo(
      before.politics.AAA.groups!.military,
      2,
    );
    expect(after.politics.AAA.opinion).toBeLessThan(
      before.politics.AAA.opinion,
    );
    expect(after.politics.AAA.stability).toBeLessThan(
      before.politics.AAA.stability,
    );
    // The other nation did not change anything.
    expect(after.economies.BBB.taxes.vat).toBe(before.economies.BBB.taxes.vat);
  });

  it("cutting defence angers the military, raising social spending pleases retirees", () => {
    const { sim, months } = campaign(two);
    sim.apply({ type: "set-spending", post: "defense", share: 0.005 });
    sim.apply({ type: "set-spending", post: "social", share: 0.24 });
    months(4);
    const groups = sim.read().politics.AAA.groups!;
    expect(groups.military).toBeLessThan(0.4);
    expect(groups.retirees).toBeGreaterThan(0.53);
  });

  it("investment (infrastructure + research) above its reference raises growth", () => {
    const base = campaign(two);
    const invest = campaign(two);
    invest.sim.apply({
      type: "set-spending",
      post: "infrastructure",
      share: 0.08,
    });
    base.months(24);
    invest.months(24);
    expect(invest.sim.read().economies.AAA.gdp).toBeGreaterThan(
      base.sim.read().economies.AAA.gdp * 1.005,
    );
  });

  it("clamps sliders to their ceilings and validates embargoes", () => {
    const { sim } = campaign(two);
    const max = loadVeritableConfig().budget;
    sim.apply({ type: "set-tax", tax: "vat", rate: 0.95 });
    sim.apply({ type: "set-spending", post: "social", share: 0.9 });
    expect(sim.read().economies.AAA.taxes.vat).toBe(max.maxTaxRate.vat);
    expect(sim.read().economies.AAA.spending.social).toBe(max.maxSpendingShare);
    expect(() =>
      sim.apply({
        type: "set-embargo",
        from: "AAA",
        to: "ZZZ",
        good: "gas",
        active: true,
      }),
    ).toThrow(/unknown pair/);
    sim.apply({
      type: "set-embargo",
      from: "AAA",
      to: "ROW",
      good: "gas",
      active: true,
    });
    sim.apply({
      type: "set-embargo",
      from: "AAA",
      to: "ROW",
      good: "gas",
      active: true,
    });
    expect(sim.read().market.embargoes).toHaveLength(1);
    sim.apply({
      type: "set-embargo",
      from: "AAA",
      to: "ROW",
      good: "gas",
      active: false,
    });
    expect(sim.read().market.embargoes).toHaveLength(0);
  });

  it("the rest of the world is a market participant, never a nation", () => {
    const { sim } = campaign(two);
    const view = sim.read();
    expect(view.nations.map((n) => n.id)).toEqual(["AAA", "BBB"]);
    expect(view.economies.ROW).toBeUndefined();
    expect(view.politics.ROW).toBeUndefined();
    expect(view.market.rowProduction.oil).toBeGreaterThan(0);
  });
});

describe("shortages", () => {
  // A world that cannot feed AAA: it needs 300 and grows 100, the rest of the
  // world has nothing to spare.
  const hungry = {
    nations: {
      AAA: { production: { food: 100 }, consumption: { food: 300 } },
      BBB: {},
    },
    row: [1000, 1000, { food: [1000, 1000] as [number, number] }] as Parameters<
      typeof testRow
    >,
  };

  it("coverage = obtained / needed; the shortage index weighs it by good", () => {
    const { sim, months } = campaign(hungry);
    months(1);
    const e = sim.read().economies.AAA;
    expect(e.coverage.food).toBeLessThan(0.75);
    expect(e.coverage.oil).toBe(1);
    expect(e.shortage).toBeCloseTo((1 / 12) * (1 - e.coverage.food), 6);
    expect(sim.read().economies.BBB.shortage).toBe(0);
  });

  it("a shortage slows growth, lowers stability, and pushes the price up", () => {
    const { sim, months } = campaign(hungry);
    months(12);
    const view = sim.read();
    expect(view.economies.AAA.gdp).toBeLessThan(view.economies.BBB.gdp);
    expect(view.politics.AAA.stability).toBeLessThan(
      view.politics.BBB.stability,
    );
    expect(view.market.prices.food).toBeGreaterThan(100);
  });

  it("electricity: the fossil share of production follows the coverage of its fuel; industry follows electricity", () => {
    const config = quietConfig();
    const nations = [
      testNation("AAA", {
        production: { electricity: 100 },
        fossilElectricity: { gas: 40 },
      }),
    ];
    const ctx = buildContext(config, testSimData(["AAA"]), nations);
    const economy = initEconomy(ctx, nations, testRow()).nations.AAA;
    expect(economy.fossilShare.gas).toBeCloseTo(0.4, 9);
    expect(effectiveProduction(ctx, economy, ctx.good("electricity"))).toBe(
      100,
    );
    economy.coverage.gas = 0.5; // half the gas is missing
    expect(
      effectiveProduction(ctx, economy, ctx.good("electricity")),
    ).toBeCloseTo(80, 9);
    economy.coverage.electricity = 0.8;
    expect(effectiveProduction(ctx, economy, ctx.good("steel"))).toBeCloseTo(
      100 * (1 - config.economy.electricityShortageOnIndustry * 0.2),
      9,
    );
    expect(effectiveProduction(ctx, economy, ctx.good("food"))).toBe(100);
  });

  it("unrest starts when stability falls under the threshold, and is reported", () => {
    const config = quietConfig();
    config.politics.stability.unrestThreshold = 0.7; // just under the initial 0.705
    const { sim, events, months } = campaign({ ...hungry, config });
    months(6);
    expect(events.map((e) => e.type)).toContain("unrest-started");
    expect(sim.read().politics.AAA.unrest).toBe(true);
    expect(sim.read().journal.map((j) => j.kind)).toContain("unrest-started");
  });
});

describe("blocs and AI", () => {
  const club: Bloc = {
    id: "club",
    name: "bloc.club",
    layer: 1,
    members: [{ nation: "AAA", status: "full" }],
    fiscalRule: {
      maxDeficitToGdp: 0.03,
      maxDebtToGdp: 0.6,
      opinionMalus: 0.03,
    },
  };

  it("the bloc reprimands a member beyond 3 % / 60 %, once, and it costs opinion", () => {
    const { sim, events, months } = campaign({
      nations: { AAA: { debtToGdp: 0.9 }, BBB: { debtToGdp: 0.9 } },
      blocs: [club],
    });
    months(6);
    const reprimands = events.filter((e) => e.type === "bloc-reprimand");
    expect(reprimands).toHaveLength(1);
    expect(reprimands[0]).toMatchObject({ nation: "AAA", bloc: "club" });
    const politics = sim.read().politics;
    expect(politics.AAA.reprimanded).toBe(true);
    expect(politics.BBB.reprimanded).toBe(false);
    expect(politics.AAA.opinion).toBeLessThan(0.5);
  });

  it("the AI fiscal rule consolidates a nation nobody plays, and spares investment", () => {
    const { sim, months } = campaign({
      nations: { AAA: {}, BBB: { revenuePctGdp: 0.3 } }, // BBB: 10-point deficit
    });
    months(36);
    const view = sim.read();
    const b = view.economies.BBB;
    expect(b.spending.social).toBeLessThan(b.spending0.social);
    expect(b.spending.infrastructure).toBe(b.spending0.infrastructure);
    expect(b.taxes.vat).toBeGreaterThan(b.taxes0.vat);
    const deficit = -b.balances.reduce((x, y) => x + y, 0) / b.gdp;
    expect(deficit).toBeLessThan(0.04);
    // The player's nation is left to the player...
    expect(view.economies.AAA.spending).toEqual(view.economies.AAA.spending0);
  });

  it("...unless nobody plays (headless autopilot)", () => {
    const { sim, months } = campaign({
      nations: { AAA: { revenuePctGdp: 0.3 } },
      autopilot: true,
    });
    months(24);
    const a = sim.read().economies.AAA;
    expect(a.spending.social).toBeLessThan(a.spending0.social);
  });
});
