import { NationId } from "../../data/schemas/common";
import { GOOD_IDS, GoodId } from "../../data/schemas/goods";
import {
  NationData,
  SPENDING_POSTS,
  SpendingPost,
} from "../../data/schemas/nation";
import { Scenario } from "../../data/schemas/scenario";

const sourced = (value: number) => ({
  value,
  source: "test",
  asOf: "2026-01-01",
});

export interface TestNationOptions {
  gdp?: number; // US$
  debtToGdp?: number;
  growthBase?: number;
  tradeOpenness?: number;
  production?: Partial<Record<GoodId, number>>;
  consumption?: Partial<Record<GoodId, number>>;
  fossilElectricity?: { gas?: number; coal?: number; oil?: number };
  revenuePctGdp?: number;
  spending?: Partial<Record<SpendingPost, number>>;
  blocs?: string[];
  lon?: number;
  lat?: number;
  regime?: NationData["regime"];
  electionIntervalMonths?: number;
  lastElection?: string;
  electionsSuspendedAtWarAtHome?: boolean;
}

const DEFAULT_SPENDING: Record<SpendingPost, number> = {
  defense: 0.02,
  social: 0.18,
  healthEducation: 0.12,
  research: 0.01,
  infrastructure: 0.04,
  subsidies: 0.03,
};

// Minimal but complete nation sheet: by default self-sufficient in every good
// (production = consumption = 100) with a balanced budget.
export function testNation(
  id: NationId,
  options: TestNationOptions = {},
): NationData {
  const spending = { ...DEFAULT_SPENDING, ...options.spending };
  const expense = SPENDING_POSTS.reduce((s, p) => s + spending[p], 0);
  return {
    id,
    name: `nation.${id}.name`,
    capital: {
      name: `nation.${id}.capital`,
      lon: options.lon ?? 0,
      lat: options.lat ?? 0,
      source: "test",
      asOf: "2026-01-01",
    },
    regime: options.regime ?? "parliamentary",
    regimeSource: { source: "test", asOf: "2026-01-01" },
    blocs: options.blocs ?? [],
    nuclear: null,
    territory: { kind: "tiles" },
    contested: [],
    population: sourced(10_000_000),
    gdp: sourced(options.gdp ?? 1e12),
    debtToGdp: sourced(options.debtToGdp ?? 0.5),
    economy: {
      tradeOpenness: sourced(options.tradeOpenness ?? 0.5),
      growthBase: sourced(options.growthBase ?? 0.02),
      goods: Object.fromEntries(
        GOOD_IDS.map((g) => [
          g,
          {
            production: sourced(options.production?.[g] ?? 100),
            consumption: sourced(options.consumption?.[g] ?? 100),
          },
        ]),
      ) as NationData["economy"]["goods"],
      electricityFromFossil: {
        gas: sourced(options.fossilElectricity?.gas ?? 0),
        coal: sourced(options.fossilElectricity?.coal ?? 0),
        oil: sourced(options.fossilElectricity?.oil ?? 0),
      },
      budget: {
        revenuePctGdp: sourced(options.revenuePctGdp ?? expense),
        expensePctGdp: sourced(expense),
        grantsPctGdp: sourced(0),
        revenueShares: {
          value: {
            income: 0.42,
            corporate: 0.1,
            vat: 0.42,
            tariffs: 0.02,
            rents: 0.04,
          },
          source: "test",
          asOf: "2026-01-01",
        },
        spending: Object.fromEntries(
          SPENDING_POSTS.map((p) => [p, sourced(spending[p])]),
        ) as NationData["economy"]["budget"]["spending"],
      },
    },
    military: {
      spendingPctGdp: 2,
      activePersonnel: 100_000,
      airPower: 0.5,
      navalPower: 0.5,
      source: "test",
      asOf: "2026-01-01",
    },
    startingTech: [],
    politics: {
      electionIntervalMonths: options.electionIntervalMonths ?? 48,
      lastElection: options.lastElection ?? "2024-01-01",
      electionsSuspendedAtWarAtHome:
        options.electionsSuspendedAtWarAtHome ?? false,
      source: "test",
      asOf: "2026-01-01",
    },
  };
}

export function testScenario(nations: NationId[]): Scenario {
  return {
    id: "test",
    map: "memory",
    startDate: "2026-01-01",
    nations,
    borders: { source: "test", rasterized: "borders/test.bin" },
    contested: [],
    wars: [],
    playerDefault: nations[0],
  };
}
