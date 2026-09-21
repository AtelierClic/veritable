import { z } from "zod";
import { INTEREST_GROUPS, IsoDateSchema } from "./common";
import { TAX_IDS } from "./nation";

// Shape of data/veritable/config.json: every balancing constant has a name
// and lives there, never in a .ts file.

const share = z.number().min(0).max(1);
const positive = z.number().positive();

function record<K extends string, T extends z.ZodTypeAny>(
  keys: readonly K[],
  value: T,
) {
  return z.object(
    Object.fromEntries(keys.map((k) => [k, value])) as Record<K, T>,
  );
}

const EconomyConfigSchema = z.object({
  // p(t+1) = p(t) x (1 + k x (D - S) / S), once per game day.
  priceAdjustment: positive,
  maxDailyPriceChange: positive,
  priceFloor: positive, // x basePrice
  priceCeiling: positive, // x basePrice
  // Bilateral flows: weight = surplus x exp(-distance / scale) x bonuses.
  distanceScaleKm: positive,
  rowDistanceKm: positive,
  rowElasticityFactor: positive,
  rowGrowthPerYear: z.number(),
  agreementBonus: z.number().min(1),
  sanctionDiscount: share,
  rationingPasses: z.number().int().min(1),
  growth: z.object({
    alpha: z.number().min(0), // x (infrastructure + research - reference)
    beta: z.number().min(0), // x shortage index
    gamma: z.number().min(0), // unrest
    capacityInvestment: z.number().min(0),
    noiseMonthlySd: z.number().min(0),
  }),
  rowSupplyNoise: z.object({
    monthlySd: z.number().min(0),
    persistence: share,
  }),
  // Share of industrial production lost per point of missing electricity.
  electricityShortageOnIndustry: share,
});

const BudgetConfigSchema = z.object({
  // Tax bases as shares of GDP (tariffs: value of imports; rents: value of
  // the production of resource goods).
  taxBases: z.object({ income: share, corporate: share, vat: share }),
  maxTaxRate: record(TAX_IDS, share),
  maxSpendingShare: share,
  // i = base + debtSlope x max(0, debt/GDP - threshold)
  //          + instabilitySlope x (1 - stability)
  interest: z.object({
    base: z.number().min(0),
    debtSlope: z.number().min(0),
    debtThreshold: z.number().min(0),
    instabilitySlope: z.number().min(0),
  }),
  austerity: z.object({
    debtToGdp: positive,
    risingMonths: z.number().int().min(1),
    spendingCap: share, // posts capped at this share of their level
  }),
  default: z.object({
    debtToGdp: positive,
    interestToRevenue: share,
    haircut: share,
    noDeficitYears: z.number().int().min(0),
    satisfactionHit: share,
    stabilityHit: share,
  }),
});

const PoliticsConfigSchema = z.object({
  convergencePerWeek: share,
  groupWeights: record(INTEREST_GROUPS, share),
  // A driver is its raw value divided by its scale, clamped to [-1, 1].
  driverScales: z.object({
    growth: positive,
    prices: positive,
    taxRate: positive,
    spending: positive,
    shortage: positive,
  }),
  // target = 0.5 + sum(weight x driver). Keys: growth, prices, shortage,
  // tax.<tax>, spending.<post>.
  drivers: record(INTEREST_GROUPS, z.record(z.string(), z.number())),
  stability: z.object({
    opinion: share,
    shortage: share,
    debt: share,
    legitimacy: share,
    legitimacyValue: share,
    unrestThreshold: share,
    debtHealthyAt: z.number(),
    debtRuinousAt: z.number(),
    foodShortageWeight: z.number().min(1),
  }),
  // Opinion proxy of AI nations (no interest groups).
  aiOpinion: z.object({
    growth: z.number().min(0),
    shortage: z.number().min(0),
    prices: z.number().min(0),
  }),
});

export const VeritableConfigSchema = z.object({
  leaderNames: z.enum(["parody", "fictional"]),
  time: z.object({
    // Game minutes elapsed per OpenFront tick at speed x1. One game month
    // (30 days = 43 200 min) per real minute (600 ticks of 100 ms) = 72.
    gameMinutesPerTick: z.number().positive(),
    // Start of a campaign whose scenario does not say otherwise.
    defaultStartDate: IsoDateSchema,
  }),
  save: z.object({
    // Monthly automatic saves kept; older ones are rotated out.
    autosaveSlots: z.number().int().min(1),
  }),
  economy: EconomyConfigSchema,
  budget: BudgetConfigSchema,
  politics: PoliticsConfigSchema,
  ai: z.object({
    // Minimal fiscal rule of nations nobody plays (not the J5 AI).
    fiscal: z.object({
      maxDeficitToGdp: share,
      adjustPerMonth: share,
      relaxBelowDeficit: share,
    }),
  }),
});
export type VeritableConfig = z.infer<typeof VeritableConfigSchema>;
