import { z } from "zod";
import { INTEREST_GROUPS, IsoDateSchema } from "./common";
import { GoodIdSchema } from "./goods";
import { SPENDING_POSTS, TAX_IDS } from "./nation";
import { CONSCRIPTION_LEVELS, DIVISION_TEMPLATE_IDS } from "./war";

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
  // Months the rest of the world takes to bring its price response on line.
  rowSupplyLagMonths: z.number().min(1),
  // Import price = world price x (1 + premium x uncovered share of the
  // scenario's demand).
  scarcityPremium: z.number().min(0),
  // Months over which the export share reference adapts to the current one.
  exportReferenceAdaptMonths: z.number().min(1),
  growth: z.object({
    alpha: z.number().min(0), // x (infrastructure + research - reference)
    beta: z.number().min(0), // x shortage index
    gamma: z.number().min(0), // unrest
    delta: z.number().min(0), // x (exports / GDP - reference share)
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

const DiplomacyConfigSchema = z.object({
  // Relations in [-100, 100]: +blocRelation per common bloc (capped),
  // warRelation between belligerents, 0 otherwise; back towards 0 by
  // relationDecayPerMonth every month.
  blocRelation: z.number().min(0),
  blocRelationCap: z.number().min(0).max(100),
  warRelation: z.number().min(-100).max(0),
  relationDecayPerMonth: z.number().min(0),
  // Satisfaction lost by the youth and business groups of an aggressor.
  declarationGroupHit: share,
  // Humanitarian casus belli: the target is in unrest below this stability.
  humanitarianStability: share,
  sanction: z.object({
    relationsBelow: z.number(),
    aggressorPowerShare: share,
    exemptGoods: z.array(GoodIdSchema),
    // Share of a bloc's full members that drags the others along (layer 1).
    blocAlignShare: share,
    // Sanctions are lifted once the war is over and relations are back here.
    liftAboveRelations: z.number(),
  }),
  coalition: z.object({
    relationsBelow: z.number(),
    powerRatio: positive, // aggressor / victim
    monthlyProbability: share,
    windowMonths: z.number().int().min(1),
  }),
});

const WarConfigSchema = z.object({
  // Division templates of the starting army, as shares of the personnel.
  startingMix: record(DIVISION_TEMPLATE_IDS, share),
  // Manpower = population x level.
  conscription: record(CONSCRIPTION_LEVELS, share),
  manpowerRenewalPerMonth: share, // of the manpower ceiling
  raisedDivisionEquipment: share, // equipment of a freshly raised division
  // Index points of arms per unit of a template's `arms` at full equipment.
  armsIndexPerEquipmentUnit: positive,
  armsToDivisionsShare: share, // of the arms available in the month
  training: z.object({
    base: positive,
    min: positive,
    max: positive,
    // Training moves with the defence spending above its first-day share.
    defenseSpendingScale: z.number().min(0),
  }),
  // Weights of the sheet's air and naval power in the military power.
  power: z.object({ air: z.number().min(0), naval: z.number().min(0) }),
  segmentTiles: z.number().int().positive(),
  advanceThreshold: z.number().min(1), // r above which the line moves
  v0: positive, // tiles per tick per unit of (r - 1)
  vMax: positive,
  lambda: z.number().min(0), // losses per tick = enemy force x lambda
  terrain: z.object({
    plains: positive,
    highland: positive,
    mountain: positive,
  }),
  cityDefense: positive,
  breakthrough: z.object({ speed: positive, losses: positive }),
  exhaustion: z.object({
    perLossShareOfPopulation: z.number().min(0),
    perMonthAtWar: share,
    recoveryPerMonthAtPeace: share,
    opinionWeight: share, // opinion target loses weight x exhaustion
  }),
  // Satisfaction lost per share of the population lost in the month.
  lossesGroupHit: z.object({
    youth: z.number().min(0),
    workers: z.number().min(0),
  }),
  warScore: z.object({
    tileValue: z.number().min(0),
    lossValue: z.number().min(0),
  }),
  peace: z.object({
    exhaustionToAccept: share,
    retreatMonthsToAccept: z.number().int().min(1),
    // Cost of the terms, in war score units.
    reparationsValue: z.number().min(0), // per (% of GDP x years)
    demilitarizationValue: z.number().min(0), // per division above the cap
    annexationValue: z.number().min(0),
  }),
  ai: z.object({
    attackRatio: positive, // goes on the attack above this ratio
    totalConscriptionWhenLosingShare: share, // of its tiles lost
    retreatMonthsForTotal: z.number().int().min(1),
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
  diplomacy: DiplomacyConfigSchema,
  war: WarConfigSchema,
  ai: z.object({
    // Minimal fiscal rule of nations nobody plays (not the J5 AI).
    fiscal: z.object({
      maxDeficitToGdp: share,
      adjustPerMonth: share,
      relaxBelowDeficit: share,
      prudentDebtToGdp: z.number().min(0),
      debtRisingMonths: z.number().int().min(1),
      // Posts a consolidation never trims: cutting investment cuts growth.
      sparedPosts: z.array(z.enum(SPENDING_POSTS)),
    }),
  }),
});
export type VeritableConfig = z.infer<typeof VeritableConfigSchema>;
