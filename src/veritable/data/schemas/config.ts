import { z } from "zod";
import {
  INTEREST_GROUPS,
  IsoDateSchema,
  NUCLEAR_DOCTRINES,
  RegimeSchema,
} from "./common";
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
    // J7: time constant, in months, of the growth that opinion, the events
    // and the screens read: the rate of each update smoothed over about a
    // month, the same whether the nation is updated every day or once a
    // month (the rate of one day carries the turns of the goods).
    indicatorMonths: z.number().positive(),
  }),
  rowSupplyNoise: z.object({
    monthlySd: z.number().min(0),
    persistence: share,
  }),
  // Share of industrial production lost per point of missing electricity.
  electricityShortageOnIndustry: share,
  // J7: the population trend of a sheet converges to longRunGrowth (per
  // year) with a half-life of halfLifeYears (sim/economy/population.ts).
  population: z.object({
    longRunGrowth: z.number(),
    halfLifeYears: z.number().positive(),
  }),
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
    // J6b: the real rate of the first day of a sheet with interest data
    // (interest paid / debt, at most nominalMax, minus inflation), kept in
    // [realMin, realMax]; the rate never falls under realMin afterwards.
    nominalMax: z.number().min(0),
    realMin: z.number(),
    realMax: z.number(),
  }),
  austerity: z.object({
    debtToGdp: positive,
    risingMonths: z.number().int().min(1),
    spendingCap: share, // posts capped at this share of their level
  }),
  default: z.object({
    debtToGdp: positive,
    // J6b: a nation above debtToGdp (or interestToRevenue) on the first day
    // defaults at its own debt ratio (interest share) of that day x
    // startMargin.
    startMargin: z.number().min(1),
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
  // Internal conflicts of the scenario (J6b): stability lost at intensity 1,
  // halving every halfLifeYears from the start of the campaign.
  internalConflict: z.object({
    stabilityMalus: share,
    halfLifeYears: positive,
  }),
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
    // J7: the cost of governing — the vote for the incumbent x (1 - this x
    // years in power), never below incumbencyFatigueFloor.
    incumbencyFatiguePerYear: share,
    incumbencyFatigueFloor: share,
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
    // J7: a democracy that is stable and legitimate (both at least these)
    // has its risk of a coup multiplied by stableDemocracyFactor: no
    // consolidated democracy has fallen to a coup since 1990.
    stableDemocracyFactor: share,
    stableDemocracyStability: share,
    stableDemocracyLegitimacy: share,
    juntaTransitionMonths: z.number().int().min(0),
    juntaTransitionMonthlyProbability: share,
    // J7: an electoral autocracy of the first day without a coup attempt
    // since 1990 (its sheet's coupHistory) has the coup base of this regime
    // while its regime of the first day lasts.
    noAttemptRegime: RegimeSchema,
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
  // (1 - ideological distance of the leaders / max distance). J6b: a common
  // bloc weighs by its type (a bloc without type: affinityPerBloc), minus
  // affinitySanctions when either sanctions the other, minus
  // affinityAllyAtWar when either is at war against an ally of the other (a
  // member of a common bloc of an `allyBlocTypes` type, or a nation it
  // guarantees or that guarantees it).
  affinityPerBloc: z.number().min(0),
  affinityIdeology: z.number().min(0),
  affinityByBlocType: z.object({
    "military-alliance": z.number().min(0),
    "economic-union": z.number().min(0),
    forum: z.number().min(0),
  }),
  affinitySanctions: z.number().min(0),
  affinityAllyAtWar: z.number().min(0),
  // J7: plus affinityGuarantee when either guarantees the other, minus
  // affinityClaim x the weight of the strongest active claim of either on
  // land the other holds (the terms the card of a nation breaks down).
  affinityGuarantee: z.number().min(0),
  affinityClaim: z.number().min(0),
  allyBlocTypes: z.array(
    z.enum(["military-alliance", "economic-union", "forum"]),
  ),
  // Inherited mistrust (J6c): the hostility of the first day's relations
  // (scenario file) that the affinity does not explain — rivalries, old
  // wars — pulls the affinity of the pair down by share x the negative
  // first-day relation, halving every halfLifeYears.
  mistrust: z.object({
    share: share,
    halfLifeYears: z.number().positive(),
  }),
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
    // A sanction imposed in the campaign is lifted once the war is over and
    // relations are back here (J3).
    liftAboveRelations: z.number(),
    // J7 (Lukas, answer 2 to the J6), the ways a sanction falls besides:
    // (a) after a change of regime of the target, the issuer reviews it
    // within reviewMonths and lifts it with reviewLiftProbability; (b) the
    // issuer lifts it once its relation with the target has stayed >= 0
    // for friendlyMonths and the war it answered is over; (c) the vote of
    // the issuing bloc (sim/blocs). The player lifts its own at will: each
    // ally that keeps its sanction loses playerLiftAllyRelations with it.
    reviewMonths: z.number().int().min(1),
    reviewLiftProbability: share,
    friendlyMonths: z.number().int().min(1),
    playerLiftAllyRelations: z.number().min(0),
  }),
  coalition: z.object({
    relationsBelow: z.number(),
    powerRatio: positive, // aggressor / victim
    monthlyProbability: share,
    windowMonths: z.number().int().min(1),
  }),
  // Claims (J6, sim/diplomacy/claims.ts): a territorial casus belli needs
  // the target to hold at least `minTiles` unsettled tiles of the claim;
  // every `failuresPerHalving` white or lost wars on a claim halve its
  // weight; J6c: after `abandonAfterFailures` of them the claim is given up
  // (J7: it sleeps)
  // (weight 0, no casus belli).
  claims: z.object({
    minTiles: z.number().int().min(1),
    failuresPerHalving: z.number().int().min(1),
    abandonAfterFailures: z.number().int().min(1),
    // J7: a sleeping claim wakes when the claimant changes regime or a
    // leader above this sovereignty comes to power.
    wakeSovereigntyAbove: z.number(),
  }),
});

const WarConfigSchema = z.object({
  // Division templates of the starting army, as shares of the personnel.
  startingMix: record(DIVISION_TEMPLATE_IDS, share),
  // Manpower = population x level.
  conscription: record(CONSCRIPTION_LEVELS, share),
  manpowerRenewalPerMonth: share, // of the manpower ceiling
  raisedDivisionEquipment: share, // equipment of a freshly raised division
  // Arms (bn US$ of the good "arms", J6; index points before) per unit of a
  // template's `arms` at full equipment.
  armsPerEquipmentUnit: positive,
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

// Nuclear weapons (J5). Threat level of a nuclear nation: 0 at peace, 1 at
// war, 2 when an enemy took land from it in a war going on or its capital is
// within `capitalFrontTiles` of a front, 3 when it lost more than
// `lostTerritoryShare` of its first-day land, its capital, or its stability
// fell under `collapseStability`. Daily probability of a shot =
// base[doctrine][level] x (0.5 + aggressiveness of the leader) x deterrence.
const NuclearConfigSchema = z.object({
  base: z.record(
    z.enum(NUCLEAR_DOCTRINES),
    z.tuple([share, share, share, share]),
  ),
  // Deterrence: the target has warheads of its own, or belongs to a
  // collective-defence bloc with a nuclear member.
  deterrence: share,
  collectiveDefenseBlocs: z.array(z.string()),
  capitalFrontTiles: z.number().int().min(0),
  lostTerritoryShare: share,
  collapseStability: share,
  // Dead hand: at the annexation of a nuclear nation, p = deadHand[doctrine]
  // x (0.5 + aggressiveness) that it strikes the capital of the annexer.
  deadHand: z.record(z.enum(NUCLEAR_DOCTRINES), share),
  // After any shot: relations of everyone with the shooter at most this.
  relationsCap: z.number().min(-100).max(0),
  // Production, GDP and population of a nation hit x (1 - falloutLoss x share
  // of its tiles hit).
  falloutLoss: share,
});

// Blocs, layers 2 and 3 (J5, sim/blocs/blocs.ts). A member votes yes when
//   U = relations x (relation with the target) + ideology x (alignment of
//       the governments) - tradePerPctGdp x (trade at stake, % of GDP)
//       - sovereignty x (its sovereignty axis) x integration + loyalty > 0
// Relations and alignment count for the target of the measure, with the
// sign of a hostile measure (sanctions, suspension); the measures of the
// bloc itself (budget, common defence, programme) have no target: loyalty,
// cost and sovereignty only.
const perMeasure = z.object({
  sanctions: z.number(),
  lift: z.number(),
  accession: z.number(),
  suspension: z.number(),
  budget: z.number(),
  "common-defense": z.number(),
  "tech-program": z.number(),
  "trade-agreement": z.number(),
});
const BlocsConfigSchema = z.object({
  // Rotating presidencies count their terms from this date.
  rotationEpoch: IsoDateSchema,
  vote: z.object({
    relations: z.number().min(0),
    ideology: z.number().min(0),
    tradePerPctGdp: z.number().min(0),
    sovereignty: z.number().min(0),
    loyalty: z.number(),
  }),
  integration: perMeasure, // how much a measure pools sovereignty
  // Trade at stake for the voter, x its trade share with the target and
  // its openness: a cost (> 0) or a gain (< 0).
  tradeStake: perMeasure,
  capitalCost: perMeasure, // political capital of a player's proposal
  budgetStep: share, // +/- 20 % of the contributions
  budgetScaleMin: z.number().min(0),
  budgetScaleMax: z.number().min(1),
  programMonths: z.number().int().min(1),
  agreementTradeBonus: z.number().min(1),
  historyMonths: z.number().int().min(1), // resolved proposals kept
  // J7: days the player has to vote on a proposal of its bloc.
  voteDays: z.number().int().min(1),
  // A hegemon keeps the lead while its power is within this share of the
  // largest (no monthly flip-flop between near equals).
  hegemonMargin: share,
  // Voted common defence clause of a bloc that has none in its data.
  commonDefense: z.object({
    joinProbability: share,
    sovereignJoinProbability: share,
    sovereigntyAbove: z.number(),
  }),
  // A player that ignores a call of collective defence loses this with
  // every other member.
  article5RefusalRelations: z.number().min(0),
  ai: z.object({
    sanctionRelationsBelow: z.number(),
    liftAboveRelations: z.number(),
    techProgramProbability: share,
    tradeAgreementProbability: share,
    tradeAgreementRelations: z.number(),
    applyProbability: share,
    applyRelationMargin: z.number(),
    applySovereigntyBelow: z.number(),
  }),
});

// Technology (J5, sim/tech): points a month = total R&D (the budget's
// public research over its public share) in points of GDP x
// pointsPerRdPoint x research modifiers; a node costs cost x (1 - diffusion
// x share of the nations that have it); at most maxProjects in parallel; a
// bloc programme adds programBonus to its members' points. Development
// index of the first day = gdpWeight x GDP per head / ref + (1 - gdpWeight)
// x R&D / ref, each capped at 1.
const TechConfigSchema = z.object({
  publicShareOfResearch: share,
  pointsPerRdPoint: z.number().positive(),
  diffusion: share,
  maxProjects: z.number().int().min(1),
  programBonus: z.number().min(0),
  development: z.object({
    gdpPerCapitaRef: z.number().positive(),
    rdRef: z.number().positive(),
    gdpWeight: share,
  }),
  // The domains each goal of an AI agenda favours; other domains count for
  // offAgendaWeight.
  agendaDomains: z.record(z.string(), z.array(z.string())),
  offAgendaWeight: share,
  // The AI finishes a tier before the next: a tier-2 node counts for this.
  tier2Weight: share,
  // Share of a node's effect that counts: the trend growth of the data
  // already holds the technical progress of the world, a node is the lead
  // over it (deviation from 1 of a multiplier, or the added growth).
  effectScale: z.object({
    capacity: share,
    growth: share,
    military: share,
    research: share,
  }),
});

// Events (J5, sim/events). A stability effect moves opinion (stability is
// recomputed every week from its inputs); unrest is an opinion shock that
// brings stability under the unrest threshold. The AI scores the choices
// with these weights (by kind of effect).
const EventsConfigSchema = z.object({
  maxPopupsPerMonth: z.number().int().min(0),
  // J7: game days the player has to choose before the government decides.
  answerDays: z.number().int().min(1),
  defaultCooldownMonths: z.number().int().min(0),
  uncertainProbability: share,
  // Unrest brings stability this far under the unrest threshold.
  unrestMargin: share,
  // A government sometimes takes another choice than its best one.
  aiMistakeProbability: share,
  grievanceMonths: z.number().int().min(1),
  // A "tense neighbour" (J6c): a land neighbour with relations at or under
  // this value; the incidents of a tense border are drawn among them.
  tenseNeighbourRelations: z.number(),
  historyKept: z.number().int().min(1),
  // J7: how the ideology of a government shades its weights (choiceScore):
  // money x (1 + economic x e), groups x (1 - economic x e), relations
  // abroad x (1 - sovereignty x s), a grievance + sovereignty x s, defence
  // x (1 + authority x a), unrest x (1 - authority x a).
  ideology: z.object({
    economic: share,
    authority: share,
    sovereignty: share,
  }),
  ai: z.object({
    stability: z.number(),
    budget: z.number(),
    relations: z.number(),
    grievance: z.number(),
    military: z.number(),
    unrest: z.number(),
    group: z.number(),
    capacity: z.number(),
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
  // J6c: the war constants in tiles (distances, speeds of conquest, the
  // value of a tile) are calibrated on the Europe map; a map of another
  // scale converts them (data/mapScale.ts). Its tiles per radian.
  mapScale: z.object({ referenceGeorefScale: z.number().positive() }),
  // J7: the rolling queue of the nations (sim/schedule.ts). Every nation is
  // updated on its own cadence, the time elapsed since its last update
  // integrated: the player's nation every playerDays, the nations dealing
  // with it (land neighbours, enemies, members of a common bloc) at least
  // every interactionDays, the others every stakesDays when they have
  // stakes (war, crisis, a dispute with the player, an election within
  // electionSoonDays), otherwise every calmDays. At most maxUpdatesPerTick
  // updates a core tick, the rest waits for the next one. The goods of the
  // market are computed one at a time, the twelve in tradeCycleDays.
  schedule: z.object({
    playerDays: z.number().int().min(1),
    interactionDays: z.number().int().min(1),
    stakesDays: z.number().int().min(1),
    calmDays: z.number().int().min(1),
    electionSoonDays: z.number().int().min(0),
    maxUpdatesPerTick: z.number().int().min(1),
    tradeCycleDays: z.number().int().min(1),
  }),
  // Intelligence (J7, sim/intel/intel.ts): the level of the player on
  // another nation by the relation (at or above each mark: 1, 2, 3), the
  // half-width of the ranges at levels 0, 1, 2 (share of the value), the
  // regimes whose statistics are public and those closed to the world.
  intel: z.object({
    relationLevels: z.tuple([z.number(), z.number(), z.number()]),
    precision: z.tuple([share, share, share]),
    openRegimes: z.array(z.string()),
    closedRegimes: z.array(z.string()),
    // Month starts of the player's relations kept for the trend.
    trendMonths: z.number().int().min(1),
  }),
  save: z.object({
    // Monthly automatic saves kept; older ones are rotated out.
    autosaveSlots: z.number().int().min(1),
    // J6c: journal entries older than this many game years are folded into
    // yearly summaries (sim/journal.ts), every 1 January.
    journalFullYears: z.number().int().min(1),
  }),
  economy: EconomyConfigSchema,
  budget: BudgetConfigSchema,
  politics: PoliticsConfigSchema,
  diplomacy: DiplomacyConfigSchema,
  war: WarConfigSchema,
  naval: NavalConfigSchema,
  air: AirConfigSchema,
  logistics: LogisticsConfigSchema,
  nuclear: NuclearConfigSchema,
  blocs: BlocsConfigSchema,
  tech: TechConfigSchema,
  events: EventsConfigSchema,
  ai: z.object({
    // The AI of the nations (J5, ai/nations.ts).
    nations: z.object({
      // J7: the nation AI decides at each update of the nation (the rolling
      // queue); its draws per review keep the odds of the J5 by time: a
      // review stands for reviewDaysStakes days with stakes, reviewDaysCalm
      // without.
      reviewDaysCalm: z.number().int().min(1),
      reviewDaysStakes: z.number().int().min(1),
      crisisStability: share,
      defense: z.object({
        warBoost: z.number().min(0),
        hostileBoost: z.number().min(0),
        hostileRelation: z.number(),
        maxShare: share,
        rampPerReview: share,
      }),
      war: z.object({
        powerRatio: z.number().min(1),
        // Never against a nation it is on better terms with (J5).
        maxRelations: z.number(),
        aggressivenessWithoutCasusBelli: share,
        landSharePerPowerRatio: share,
        maxLandShare: share,
        exhaustionCostPctGdp: share,
        reputationCostPctGdp: share,
        declareProbability: share,
        minMonthsBetweenWars: z.number().int().min(0),
        // J7: the war orders of an AI nation (divisions on the segments,
        // postures, levies, ceasefires) come every ordersDays of its own
        // time, as the monthly step gave them until the J6, and at once
        // when it enters a war.
        ordersDays: z.number().int().min(1),
        // The land taken stays (its contest ends), the costs end with the
        // war: gain over this horizon against cost over the expected war.
        gainHorizonYears: z.number().min(0),
        // A real casus belli (not "none") multiplies the gain the AI
        // expects: a justified war also serves the government at home (J5).
        casusBelliMotive: z.number().min(1),
        expectedWarYears: z.number().min(0),
        // War memory (J6): at the end of a war each belligerent adds
        // lossesWeight x men lost / population + yearsWeight x years of war;
        // it halves every halfLifeYears. A war is declared only if the gain
        // beats the cost x (1 + memory).
        memory: z.object({
          lossesWeight: z.number().min(0),
          yearsWeight: z.number().min(0),
          halfLifeYears: positive,
        }),
        // Help the target would get (J6): arms from the nations above
        // config.ai.nations.armsAid.donorRelations with it (the monthly
        // share of their arms, over its own, capped), and the members of
        // its collective-defence blocs weighted by the chance they honour
        // the clause. Both add to its power; the war is expected to last
        // longer in proportion, up to durationCap times.
        aid: z.object({
          armsBoostCap: z.number().min(0),
          durationCap: z.number().min(1),
        }),
      }),
      armsAid: z.object({
        share: share,
        donorRelations: z.number(),
        enemyRelations: z.number(),
      }),
      navy: z.object({
        landingControl: share,
        landingCooldownMonths: z.number().int().min(0),
      }),
    }),
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
