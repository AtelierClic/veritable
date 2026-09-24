import { z } from "zod";
import { INTEREST_GROUPS, IsoDateSchema } from "./common";
import { GoodIdSchema } from "./goods";
import { SPENDING_POSTS, TAX_IDS } from "./nation";
import { GroupIdeologiesSchema } from "./politics";
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
  // Circumvention of an embargoed exporter: the share of the market it lost
  // that it can re-route at once, rising every month it stays embargoed.
  // Default of the goods that do not set their own (goods.json).
  circumvention: z.object({ initial: share, perMonth: share, max: share }),
  // Trade dependence: GDP level lost = friction x openness x share of the
  // trade partners (by distance and GDP) that sanction or fight the nation
  // x (1 - circumvention); reached over adjustMonths.
  sanctionFriction: share,
  tradeFactorAdjustMonths: z.number().min(1),
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
  // What a structure (or a level of it) built on the map costs the national
  // budget, US$, charged the month after (J5). Keys: OpenFront unit types.
  structureCostUsd: z.record(z.string(), z.number().min(0)),
  // Foreign grants of the sheet are war aid (Ukraine): at peace they fade by
  // this share a month (J5).
  grantsPeaceDecayPerMonth: share,
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
    legitimacy: share, // x the legitimacy of the regime in play (J4)
    unrestThreshold: share,
    debtHealthyAt: z.number(),
    debtRuinousAt: z.number(),
    foodShortageWeight: z.number().min(1),
  }),
  // Opinion lost, by every group and by the AI proxy, per share of the trade
  // partners that sanction the nation: a sanctioned aggressor does not
  // recover while the sanctions last.
  sanctionsOpinionWeight: z.number().min(0),
  // Opinion proxy of AI nations (no interest groups).
  aiOpinion: z.object({
    growth: z.number().min(0),
    shortage: z.number().min(0),
    prices: z.number().min(0),
  }),
  // --- the political engine (J4) ---
  // Default ideology of the eight groups (a sheet may override it).
  groupIdeologies: GroupIdeologiesSchema,
  elections: z.object({
    // Affinity of a group for a party: exp(-d^2 / sigma^2) x (1 + charisma).
    sigma: positive,
    // Vote for the incumbent x (incumbentBase + satisfaction of the group).
    incumbentBase: share,
    // Propaganda: +propagandaWeight x (% of GDP spent) to the incumbent.
    propagandaWeight: z.number().min(0),
    propagandaMaxPctGdp: share,
    mediaControlBonus: z.number().min(1), // x on the incumbent's share
    fraudMax: share, // shares moved to the incumbent
    // Detection probability = min(1, scale x fraud x (1 - media control)
    // x press freedom).
    fraudDetectionScale: z.number().min(0),
    fraudLegitimacyHit: share,
    fraudStabilityHit: share,
    fraudCoupMultiplier: z.number().min(1),
    fraudCoupMonths: z.number().int().min(1),
    fraudDemocracyRelations: z.number(),
    // Clientelism: monthly satisfaction of the targeted group, corruption
    // rise, and the budget leak (share of GDP).
    clientelismSatisfaction: share,
    clientelismCorruption: share,
    clientelismCostPctGdp: share,
    coalitionMajority: share,
    victoryCapital: z.number().min(0),
    newGovernmentCapital: z.number().min(0),
  }),
  capital: z.object({
    // Monthly regeneration = base x (0.5 + charisma) x (0.5 + opinion).
    regenBase: z.number().min(0),
    max: positive,
    objectiveBonus: z.number().min(0),
  }),
  legitimacy: z.object({
    recoveryPerMonth: share, // towards the base of the regime
    objectiveBonus: share,
    coupValue: share,
    revolutionValue: share,
  }),
  // Corruption of the leader = leak on the spending: cost x (1 + scale x c).
  corruptionLeakScale: z.number().min(0),
  laws: z.object({
    repealDelayMonths: z.number().int().min(0),
    // Sliders reach their target linearly over this many months.
    rampMonths: z.number().min(1),
  }),
  coups: z.object({
    // p = coupBase x militaryScale x (1 - s_military)^militaryExponent
    //     x (1 + stabilityWeight x (1 - stability)) x (1 - legitimacy)
    //     x (1 + exhaustion) x (fraud detected within the year ? 2 : 1)
    //     x the laws in force (J5 formula)
    militaryScale: z.number().min(0),
    militaryExponent: z.number().min(0),
    stabilityWeight: z.number().min(0),
    failureShare: share, // share of the attempts that fail
    democracyRelationsHit: z.number(),
    failedStabilityHit: share,
    failedMilitaryHit: share,
    // No coup attempt in the months after a regime change that happened in
    // the campaign (the new regime consolidates; the regime of the first
    // day is not new), and a junta hands power back after a while.
    consolidationMonths: z.number().int().min(0),
    juntaTransitionMonths: z.number().int().min(0),
    juntaTransitionMonthlyProbability: share,
  }),
  revolution: z.object({
    angryGroups: z.number().int().min(1),
    angryBelow: share,
    shortageAbove: share,
    stabilityBelow: share,
    lowStabilityMonths: z.number().int().min(1),
    monthlyProbability: share,
    gdpHit: share,
    stabilityHit: share,
    electionDelayMonths: z.number().int().min(1),
  }),
  leaders: z.object({
    // Annual death probability = base x e^(exponent x (age - offset)).
    deathBase: z.number().min(0),
    deathExponent: z.number().min(0),
    deathAgeOffset: z.number(),
    traitNoise: share, // sd of the generated traits around their rule
    successorAge: z.number().int().positive(),
  }),
  aiShock: z.object({
    // Monthly opinion shock of an AI nation: N(0, sd x (1 - legitimacy)
    // x (1 + coupScale x coupBase)).
    sd: share,
    coupScale: z.number().min(0),
  }),
});

const DiplomacyConfigSchema = z.object({
  // Relations in [-100, 100]: +blocRelation per common bloc (capped),
  // warRelation between belligerents, 0 otherwise; back towards 0 by
  // relationDecayPerMonth every month.
  blocRelation: z.number().min(0),
  blocRelationCap: z.number().min(0).max(100),
  warRelation: z.number().min(-100).max(0),
  relationDecayPerMonth: z.number().min(0), // above the affinity, towards it
  relationRecoveryPerMonth: z.number().min(0), // below the affinity, towards it
  // Affinity (J4): affinityPerBloc x common blocs + affinityIdeology x
  // (1 - ideological distance of the leaders / max distance).
  affinityPerBloc: z.number().min(0),
  affinityIdeology: z.number().min(0),
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
  lambda: z.number().min(0), // men lost per tick per point of enemy force
  terrain: z.object({
    plains: positive,
    highland: positive,
    mountain: positive,
  }),
  cityDefense: positive,
  cityDefenseRange: z.number().int().positive(), // tiles
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
  // Contest of the tiles taken (J5): a contested tile is worth `valueShare`
  // of a tile until a treaty cedes it and `cessionMonths` pass, or
  // `warMonths` pass since its last capture.
  contest: z.object({
    valueShare: share,
    cessionMonths: z.number().int().min(1),
    warMonths: z.number().int().min(1),
  }),
  // Map overlay of the fronts (client): tiles per point of a segment line.
  overlayStep: z.number().int().min(1),
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

const NavalConfigSchema = z.object({
  // Presence of a nation in a zone = its naval power x its deployment share
  // there (its coast by default) + shipWeight per warship + portWeight per
  // port on the zone. Control = share of the presence.
  shipWeight: z.number().min(0),
  portWeight: z.number().min(0),
  landingControl: share, // control of the zone a landing needs
  landingRadius: z.number().int().positive(), // tiles of the beachhead
});

const AirConfigSchema = z.object({
  // a = air_a / (air_a + air_b); segment multiplier 1 + weight x (a - 0.5).
  segmentWeight: z.number().min(0),
  // Monthly strikes: the enemy's industrial capacity and supply lose
  // strikeShare x a; the damage decays by this factor every month.
  strikeShare: share,
  strikeDecayPerMonth: share,
});

const LogisticsConfigSchema = z.object({
  // Supply capacity of a segment, in divisions: base + perStructure x (ports
  // and cities within range) + infrastructureScale x infrastructure share of
  // GDP. Beyond it, the force is scaled by capacity / divisions.
  base: z.number().min(0),
  perStructure: z.number().min(0),
  infrastructureScale: z.number().min(0),
  range: z.number().int().positive(), // tiles
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
  naval: NavalConfigSchema,
  air: AirConfigSchema,
  logistics: LogisticsConfigSchema,
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
