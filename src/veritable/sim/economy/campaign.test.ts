import { loadVeritableConfig } from "../../data/loadConfig";
import { Bloc } from "../../data/schemas/bloc";
import { VeritableConfig } from "../../data/schemas/config";
import { NationData } from "../../data/schemas/nation";
import { NationEconomy } from "../../data/schemas/save";
import { stepFiscalRules } from "../blocs/fiscalRule";
import { Rng } from "../rng";
import { MemoryWorld } from "../testing/MemoryWorld";
import {
  testNation,
  TestNationOptions,
  testScenario,
} from "../testing/nations";
import { testBloc, testGoods, testRow, testSimData } from "../testing/simData";
import { SimEvent } from "../VeritableSim";
import { VeritableSimImpl } from "../VeritableSimImpl";
import { buildContext } from "./context";
import { effectiveProduction, stepGrowth, stepTrade } from "./engine";
import { initEconomy, initPolitics } from "./init";

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
    expect(politics.AAA.stability).toBeCloseTo(0.25 + 0.2 + 0.15 + 0.12, 9);
  });

  it("raising VAT brings money in and angers workers; opinion and stability follow", () => {
    const { sim, months } = campaign(two);
    months(1);
    const before = structuredClone(sim.read()); // read() is a live view
    const vat = before.economies.AAA.taxes.vat;
    sim.apply({ type: "set-tax", tax: "vat", rate: vat + 0.08 });
    // Sliders ramp (J4): the value in effect follows the target over months.
    months(9);
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
    expect(sim.read().economies.AAA.taxTargets.vat).toBe(max.maxTaxRate.vat);
    expect(sim.read().economies.AAA.spendingTargets.social).toBe(
      max.maxSpendingShare,
    );
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
  const club: Bloc = testBloc({
    id: "club",
    members: [{ nation: "AAA", status: "full" }],
    fiscalRule: {
      maxDeficitToGdp: 0.03,
      deficitYears: 2,
      maxDebtToGdp: 0.6,
      debtRisingMonths: 12,
      opinionMalus: 0.03,
      malusFadeMonths: 6,
    },
  });

  it("debt above 60 % and rising for a year: the bloc reprimands a member, once, and it costs opinion", () => {
    const { sim, events, months } = campaign({
      nations: { AAA: { debtToGdp: 0.9 }, BBB: { debtToGdp: 0.9 } },
      blocs: [club],
    });
    months(6);
    expect(events.filter((e) => e.type === "bloc-reprimand")).toHaveLength(0);
    months(8);
    const reprimands = events.filter((e) => e.type === "bloc-reprimand");
    expect(reprimands).toHaveLength(1);
    expect(reprimands[0]).toMatchObject({ nation: "AAA", bloc: "club" });
    const politics = sim.read().politics;
    expect(politics.AAA.reprimanded).toBe(true);
    expect(politics.AAA.reprimandMalus).toBe(0.03);
    expect(politics.BBB.reprimanded).toBe(false);
    expect(politics.AAA.opinion).toBeLessThan(0.5);
  });

  it("a deficit above 3 % reprimands only after two consecutive years", () => {
    const { sim, events, months } = campaign({
      nations: { AAA: { debtToGdp: 0.3, revenuePctGdp: 0.35 } }, // 5 points
      blocs: [club],
    });
    months(20);
    expect(events.filter((e) => e.type === "bloc-reprimand")).toHaveLength(0);
    expect(sim.read().politics.AAA.deficitBreachMonths).toBeGreaterThan(18);
    months(6);
    expect(events.filter((e) => e.type === "bloc-reprimand")).toHaveLength(1);
    expect(
      sim.read().economies.AAA.debt / sim.read().economies.AAA.gdp,
    ).toBeLessThan(0.6);
  });

  it("the malus fades out over six months once the reprimand is lifted", () => {
    const config = quietConfig();
    const nations = [testNation("AAA", { debtToGdp: 0.3 })];
    const ctx = buildContext(config, testSimData(["AAA"]), nations);
    const economy = initEconomy(ctx, nations, testRow()).nations.AAA;
    const politics = initPolitics(
      ctx,
      nations,
      "AAA",
      false,
      new Rng(1),
      "2026-01-01",
    ).nations.AAA;
    politics.reprimanded = true;
    politics.reprimandMalus = 0.03;
    const malus: number[] = [];
    for (let m = 0; m < 7; m++) {
      stepFiscalRules([club], () => true, "AAA", economy, politics);
      malus.push(politics.reprimandMalus);
    }
    expect(politics.reprimanded).toBe(false);
    expect(malus.map((m) => Number(m.toFixed(3)))).toEqual([
      0.025, 0.02, 0.015, 0.01, 0.005, 0, 0,
    ]);
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

describe("J3 corrections of the J2", () => {
  // AAA exports oil (300 made, 100 used); BBB and the rest of the world buy.
  const exporter = {
    nations: {
      AAA: { production: { oil: 300 }, consumption: { oil: 100 } },
      BBB: { production: { oil: 50 }, consumption: { oil: 150 } },
    },
  };

  it("exports lost to an embargo cost growth through the export term, and the drag fades", () => {
    // No circumvention here: the export term alone.
    const config = quietConfig();
    config.economy.circumvention = { initial: 0, perMonth: 0, max: 0 };
    const control = campaign({ ...exporter, config });
    const cut = campaign({ ...exporter, config });
    for (const to of ["BBB", "ROW"]) {
      cut.sim.apply({
        type: "set-embargo",
        from: "AAA",
        to,
        good: "oil",
        active: true,
      });
    }
    control.months(24);
    cut.months(24);
    const a = cut.sim.read().economies.AAA;
    const c = control.sim.read().economies.AAA;
    // The dumped surplus sells at a discount (on a world price that the
    // stranded volume pushed up): less export value...
    expect(a.exportsValue).toBeLessThan(c.exportsValue * 0.95);
    // ...and less growth, month after month.
    expect(a.gdp).toBeLessThan(c.gdp * 0.997);
    // The reference share has moved towards the new share: the drag fades.
    expect(a.exportShareReference).toBeLessThan(c.exportShareReference);
    const drag = (e: NationEconomy) => e.growthAnnual - c.growthBase;
    const early = campaign({ ...exporter, config });
    for (const to of ["BBB", "ROW"]) {
      early.sim.apply({
        type: "set-embargo",
        from: "AAA",
        to,
        good: "oil",
        active: true,
      });
    }
    early.months(2);
    expect(drag(early.sim.read().economies.AAA)).toBeLessThan(drag(a));
    expect(drag(a)).toBeLessThan(0);
    // Steady export growth costs nothing: the control grows on its trend.
    expect(c.growthAnnual).toBeCloseTo(c.growthBase, 2);
  });

  it("circumvention builds up per good in proportion to the market lost, narrows the discount, and fades once the good is free", () => {
    // Oil re-routes fast and far, gas slowly and little (as in goods.json).
    const goods = testGoods().map((g) =>
      g.id === "oil"
        ? { ...g, circumvention: { initial: 0.3, perMonth: 0.1, max: 0.8 } }
        : g.id === "gas"
          ? { ...g, circumvention: { initial: 0.05, perMonth: 0.01, max: 0.2 } }
          : g,
    );
    const nations = {
      AAA: {
        production: { oil: 300, gas: 300 },
        consumption: { oil: 100, gas: 100 },
      },
      BBB: {
        production: { oil: 50, gas: 50 },
        consumption: { oil: 150, gas: 150 },
      },
    };
    const make = () => {
      const ids = Object.keys(nations);
      const sheets = new Map<string, NationData>(
        ids.map((id) => [id, testNation(id, nations[id as "AAA"])]),
      );
      const sim = new VeritableSimImpl({
        config: quietConfig(),
        world: new MemoryWorld(4, 4),
        data: testSimData(ids, { goods, row: testRow() }),
        nationData: (id) => sheets.get(id),
      });
      sim.init(testScenario(ids), 7);
      const months = (n: number) => {
        for (let d = 0; d < 31 * n; d++) sim.advance(DAY);
      };
      return { sim, months };
    };
    const cut = make();
    for (const good of ["oil", "gas"] as const) {
      for (const to of ["BBB", "ROW"]) {
        cut.sim.apply({
          type: "set-embargo",
          from: "AAA",
          to,
          good,
          active: true,
        });
      }
    }
    cut.months(1);
    let a = cut.sim.read().economies.AAA;
    // The first month jumps to the initial index of each good; steel, never
    // embargoed, stays at 0.
    expect(a.circumvention.oil).toBeCloseTo(0.3 + 0.1, 6);
    expect(a.circumvention.gas).toBeCloseTo(0.05 + 0.01, 6);
    expect(a.circumvention.steel).toBe(0);
    cut.months(11);
    a = cut.sim.read().economies.AAA;
    // Capped at the ceiling of the good.
    expect(a.circumvention.oil).toBe(0.8);
    expect(a.circumvention.gas).toBeCloseTo(0.05 + 12 * 0.01, 6);
    // An exporter embargoed on oil alone keeps more of its export value
    // than one embargoed on gas alone (same volumes lost): the discount on
    // what is dumped narrows with the circumvention of the good.
    const cutOil = make();
    const cutGas = make();
    for (const to of ["BBB", "ROW"]) {
      cutOil.sim.apply({
        type: "set-embargo",
        from: "AAA",
        to,
        good: "oil",
        active: true,
      });
      cutGas.sim.apply({
        type: "set-embargo",
        from: "AAA",
        to,
        good: "gas",
        active: true,
      });
    }
    cutOil.months(12);
    cutGas.months(12);
    expect(cutOil.sim.read().economies.AAA.exportsValue).toBeGreaterThan(
      cutGas.sim.read().economies.AAA.exportsValue * 1.02,
    );
    // Lifted: the indices fade month after month.
    for (const good of ["oil", "gas"] as const) {
      for (const to of ["BBB", "ROW"]) {
        cut.sim.apply({
          type: "set-embargo",
          from: "AAA",
          to,
          good,
          active: false,
        });
      }
    }
    cut.months(3);
    a = cut.sim.read().economies.AAA;
    expect(a.circumvention.oil).toBeCloseTo(0.8 - 0.3, 6);
    expect(a.circumvention.gas).toBeCloseTo(0.17 - 0.03, 6);
  });

  it("the rest of the world brings its price response on line with a lag, not instantly", () => {
    const { sim, months } = campaign({
      nations: {
        AAA: { production: { food: 100 }, consumption: { food: 300 } },
        BBB: {},
      },
      row: [1000, 1000, { food: [1000, 1000] as [number, number] }],
    });
    months(1);
    const m1 = sim.read().market;
    expect(m1.prices.food).toBeGreaterThan(100);
    const target = (m: typeof m1) =>
      m.rowProduction.food * Math.pow(m.prices.food / 100, 0.3 * 2);
    // One month in: a fraction of the way (1/18) from capacity to target.
    expect(m1.rowEffectiveProduction.food).toBeGreaterThan(
      m1.rowProduction.food,
    );
    expect(m1.rowEffectiveProduction.food).toBeLessThan(
      m1.rowProduction.food + 0.1 * (target(m1) - m1.rowProduction.food),
    );
    months(35);
    const m36 = sim.read().market;
    // Three years in: most of the way.
    expect(m36.rowEffectiveProduction.food).toBeGreaterThan(
      m36.rowProduction.food + 0.7 * (target(m36) - m36.rowProduction.food),
    );
  });

  it("importers pay a premium over the world price when the scenario's demand is not covered", () => {
    const { sim, months } = campaign({
      nations: {
        AAA: { production: { food: 100 }, consumption: { food: 300 } },
        BBB: {},
      },
      row: [1000, 1000, { food: [1000, 1000] as [number, number] }],
    });
    months(1);
    const view = sim.read();
    expect(view.market.importPrices.food).toBeGreaterThan(
      view.market.prices.food * 1.1,
    );
    expect(view.market.importPrices.oil).toBe(view.market.prices.oil);
    // AAA imports its missing food dear; BBB, self-sufficient, only sees
    // the world price move.
    expect(view.economies.AAA.priceIndex).toBeGreaterThan(
      view.economies.BBB.priceIndex + 0.02,
    );
    expect(view.economies.BBB.priceIndex).toBeLessThan(1.02);
  });

  it("stepTrade and stepGrowth are the monthly steps behind the campaign", () => {
    const config = quietConfig();
    const nations = [testNation("AAA")];
    const ctx = buildContext(config, testSimData(["AAA"]), nations);
    const economy = initEconomy(ctx, nations, testRow());
    const politics = initPolitics(
      ctx,
      nations,
      "AAA",
      false,
      new Rng(1),
      "2026-01-01",
    );
    stepTrade(ctx, economy);
    stepGrowth(ctx, economy, politics, new Rng(1));
    expect(economy.nations.AAA.growthAnnual).toBeCloseTo(0.02, 6);
  });
});
