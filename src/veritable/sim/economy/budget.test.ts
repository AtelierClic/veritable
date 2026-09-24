import { loadVeritableConfig } from "../../data/loadConfig";
import { VeritableConfig } from "../../data/schemas/config";
import { NationData } from "../../data/schemas/nation";
import { EconomyState } from "../../data/schemas/save";
import { MemoryWorld } from "../testing/MemoryWorld";
import { testNation, testScenario } from "../testing/nations";
import { testSimData } from "../testing/simData";
import { SimEvent } from "../VeritableSim";
import { VeritableSimImpl } from "../VeritableSimImpl";
import {
  defaultDebtThreshold,
  defaultInterestShare,
  formulaRate,
} from "./budget";
import { EconomyContext } from "./context";

// The debt of the first day (J6b): the real interest rate observed (interest
// paid / debt - inflation), a default threshold of its own for a nation
// already above the rule's, and the nations already in default.

const DAY = 1440;
const sourced = (value: number) => ({
  value,
  source: "test",
  asOf: "2026-01-01",
});

function quietConfig(): VeritableConfig {
  const config = structuredClone(loadVeritableConfig());
  config.economy.growth.noiseMonthlySd = 0;
  config.economy.rowSupplyNoise.monthlySd = 0;
  config.politics.aiShock.sd = 0;
  config.politics.coups.militaryScale = 0;
  config.politics.leaders.deathBase = 0;
  return config;
}

function withInterest(
  sheet: NationData,
  interestPctGdp: number,
  inflation: number,
): NationData {
  sheet.economy.budget.interestPctGdp = sourced(interestPctGdp);
  sheet.economy.budget.inflation = sourced(inflation);
  return sheet;
}

function campaign(sheetList: NationData[]) {
  const ids = sheetList.map((s) => s.id);
  const sheets = new Map(sheetList.map((s) => [s.id, s]));
  const scenario = testScenario(ids);
  const sim = new VeritableSimImpl({
    config: quietConfig(),
    world: new MemoryWorld(4, 4),
    data: testSimData(ids),
    nationData: (id) => sheets.get(id),
    scenario,
  });
  sim.init(scenario, 5);
  const internals = sim as unknown as {
    ctx: EconomyContext;
    economy: EconomyState;
  };
  const events: SimEvent[] = [];
  const days = (n: number) => {
    for (let d = 0; d < n; d++) events.push(...sim.advance(DAY));
  };
  return { internals, days, events };
}

describe("the interest rate of the first day (J6b)", () => {
  it("is the real rate observed: interest paid / debt - inflation", () => {
    const { internals } = campaign([
      withInterest(testNation("AAA", { debtToGdp: 1.2 }), 0.036, 0.02),
      testNation("BBB"),
    ]);
    expect(internals.economy.nations.AAA.interestRate).toBeCloseTo(0.01, 12);
  });

  it("then moves with the debt and the stability as the formula of the J2", () => {
    const { internals, days } = campaign([
      withInterest(testNation("AAA", { debtToGdp: 1.2 }), 0.036, 0.02),
      testNation("BBB"),
    ]);
    const nation = internals.economy.nations.AAA;
    const spread = nation.interestSpread;
    days(40);
    const stability = (
      internals as unknown as {
        politics: { nations: Record<string, { stability: number }> };
      }
    ).politics.nations.AAA.stability;
    // The rate of the last monthly step: the formula at the debt of that
    // step plus the spread of the first day.
    expect(nation.interestRate).toBeGreaterThan(0);
    expect(spread).toBeLessThan(0);
    expect(
      Math.abs(
        nation.interestRate -
          (formulaRate(internals.ctx, nation.debt / nation.gdp, stability) +
            spread),
      ),
    ).toBeLessThan(0.002);
  });

  it("follows the formula of the J2 without interest data", () => {
    const { internals } = campaign([testNation("AAA"), testNation("BBB")]);
    expect(internals.economy.nations.AAA.interestSpread).toBe(0);
  });

  it("never falls under realMin, whatever the inflation", () => {
    const { internals } = campaign([
      withInterest(testNation("AAA", { debtToGdp: 0.3 }), 0.03, 0.3),
      testNation("BBB"),
    ]);
    expect(internals.economy.nations.AAA.interestRate).toBe(
      internals.ctx.config.budget.interest.realMin,
    );
  });
});

describe("defaults (J6b)", () => {
  it("a nation above the rule on the first day defaults at its own debt x startDebtMargin", () => {
    const { internals, days, events } = campaign([
      withInterest(testNation("AAA", { debtToGdp: 2.4 }), 0.012, 0.02),
      testNation("BBB"),
    ]);
    const cfg = internals.ctx.config.budget.default;
    expect(defaultDebtThreshold(internals.ctx, "AAA")).toBeCloseTo(
      2.4 * cfg.startMargin,
      12,
    );
    expect(defaultDebtThreshold(internals.ctx, "BBB")).toBe(cfg.debtToGdp);
    days(95);
    expect(events.some((e) => e.type === "sovereign-default")).toBe(false);
  });

  it("a nation paying most of its revenue in interest on the first day defaults above that share x startMargin", () => {
    // Real rate 8 %, debt 1.0, revenue 0.14: interest takes 57 % of it.
    const { internals, days, events } = campaign([
      withInterest(
        testNation("AAA", { debtToGdp: 1, revenuePctGdp: 0.14 }),
        0.1,
        0.02,
      ),
      testNation("BBB"),
    ]);
    const cfg = internals.ctx.config.budget.default;
    expect(defaultInterestShare(internals.ctx, "AAA")).toBeCloseTo(
      (0.08 / 0.14) * cfg.startMargin,
      12,
    );
    expect(defaultInterestShare(internals.ctx, "BBB")).toBe(
      cfg.interestToRevenue,
    );
    days(95);
    expect(events.some((e) => e.type === "sovereign-default")).toBe(false);
  });

  it("a nation in default on the first day cannot borrow and does not default again", () => {
    const sheet = withInterest(
      testNation("AAA", { debtToGdp: 2.2, revenuePctGdp: 0.2 }),
      0.02,
      0.02,
    );
    sheet.economy.budget.inDefault = {
      since: "2017-11-13",
      source: "test",
      asOf: "2026-01-01",
    };
    const { internals, days, events } = campaign([sheet, testNation("BBB")]);
    const nation = internals.economy.nations.AAA;
    const cfg = internals.ctx.config.budget.default;
    expect(nation.defaults).toBe(1);
    expect(nation.noDeficitUntil).toBe(`${2026 + cfg.noDeficitYears}-01-01`);
    const debtBefore = nation.debt;
    days(95);
    expect(events.some((e) => e.type === "sovereign-default")).toBe(false);
    // Spending cut to revenue: the debt does not grow.
    expect(nation.debt).toBeLessThanOrEqual(debtBefore * 1.0001);
  });
});
