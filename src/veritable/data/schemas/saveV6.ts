import { z } from "zod";
import { zb } from "../../../../zbin";
import { BlocMemberStatusSchema } from "./bloc";
import {
  IsoDateSchema,
  NationIdSchema,
  NuclearDoctrineSchema,
  RegimeSchema,
} from "./common";
import { ActorRoleSchema } from "./leaders";
import {
  CalendarSchema,
  NationNameSchema,
  NationStateSchema,
  WorldStateSchema,
} from "./saveV1";

// Save file, version 6 (J6: war memory, losses and claims of each war,
// dynamic claims with their weight, tiles settled by treaty in the tile
// block, sanctions of policy, interest spread, yearly journal summaries).
// FROZEN: a v6 file can only be decoded by this schema, forever. The current
// version is save.ts.
//
// Pieces imported from saveV1.ts are unchanged since v1.

export const JOURNAL_KINDS_V6 = [
  "campaign-started",
  "nation-status",
  "unrest-started",
  "unrest-ended",
  "austerity-started",
  "austerity-ended",
  "sovereign-default",
  "bloc-reprimand",
  "war-declared",
  "war-joined",
  "sanctions-imposed",
  "sanctions-lifted",
  "peace-offered",
  "peace-refused",
  "peace-signed",
  "annexation",
  "landing-refused",
  "landing",
  // The political engine (J4).
  "election-held",
  "government-formed",
  "elections-suspended",
  "law-enacted",
  "law-refused",
  "law-repealed",
  "law-repeal-announced",
  "coup-attempted",
  "coup-succeeded",
  "revolution",
  "leader-died",
  "leader-succeeded",
  "fraud-detected",
  "objective-completed",
  "regime-changed",
  "bloc-suspended",
  "civilian-transition",
  "note",
  // Nuclear weapons (J5).
  "nuclear-launch",
  "nuclear-detonation",
  "nuclear-intercepted",
  "dead-hand",
  // The AI of the nations (J5).
  "arms-aid-started",
  "arms-aid-ended",
  "ai-landing",
  // Blocs, layers 2 and 3 (J5).
  "bloc-proposal",
  "bloc-decision",
  "bloc-presidency",
  "bloc-application",
  "bloc-accession-opened",
  "bloc-accession-frozen",
  "bloc-joined",
  "bloc-exit-notified",
  "bloc-left",
  "bloc-article5",
  "bloc-article5-refused",
  // Technology and events (J5).
  "tech-completed",
  "event-occurred",
  // Claims (J6).
  "claim-weakened",
  "claims-settled",
  // Compaction (J6c): the entries of a year older than
  // save.journalFullYears, by nation and category.
  "yearly-summary",
] as const;
export const JournalEntryV6Schema = z.object({
  date: IsoDateSchema,
  kind: z.enum(JOURNAL_KINDS_V6),
  nation: NationIdSchema.optional(),
  params: z.record(z.string(), z.string()),
});
export type JournalEntryV6 = z.infer<typeof JournalEntryV6Schema>;

// Quantities keyed by good, tax, spending post or interest group. Key order
// is part of the bytes: records are always built in the order of the ids.
const amounts = z.record(z.string(), zb.float());

// Economy of one nation. Quantities per year in the unit of the good; money
// in US$. Sliders (taxes, spending) are the player's or the AI's settings;
// the `0` variants are the values of the first day, the reference of the
// political drivers and of the AI fiscal rule.
export const NationEconomyV6Schema = z.object({
  gdp: zb.float(),
  debt: zb.float(),
  growthBase: zb.float(), // per year
  growthAnnual: zb.float(), // last month, annualised
  production: amounts, // capacity
  consumption: amounts, // demand at the base price
  fossilShare: amounts, // share of electricity made from gas / coal / oil
  coverage: amounts, // obtained / needed, last month
  imports: amounts, // last month, annualised
  exports: amounts,
  // Value of the exports really sold (US$ per year, last month), and the
  // share of GDP it is compared with in the growth: starts at the share of
  // the first day and adapts slowly (J3, correction of the J2).
  exportsValue: zb.float(),
  exportShareReference: zb.float(),
  shortage: zb.float(), // weighted lack of coverage, 0..1
  priceIndex: zb.float(), // consumer basket, 1 = base prices
  taxes: amounts, // in effect
  taxes0: amounts,
  spending: amounts, // shares of GDP, in effect
  spending0: amounts,
  // Sliders with a progressive effect (J4): what the player or the AI set;
  // the values in effect reach them over laws.rampMonths.
  taxTargets: amounts,
  spendingTargets: amounts,
  grantsPctGdp: zb.float(),
  investmentReference: zb.float(), // infrastructure + research on day one
  revenue: zb.float(), // last month, US$
  expenditure: zb.float(),
  interest: zb.float(),
  interestRate: zb.float(),
  // J6b: the gap between the real rate of the first day (interest paid,
  // inflation) and the formula of the J2 at the debt and stability of that
  // day, kept for the whole campaign (0: the formula alone).
  interestSpread: zb.float(),
  balances: z.array(zb.float()), // last 12 monthly balances, US$
  debtRisingMonths: zb.uint(),
  austerity: z.boolean(),
  noDeficitUntil: IsoDateSchema.nullable(),
  defaults: zb.uint(),
  armsShort: z.boolean(), // read by the J3a divisions
  // Share of the industrial capacity and supply lost to enemy air strikes
  // (J3b), decaying; value of the trade that went by sea last month (US$ per
  // year), what a blockade bites into.
  strikeDamage: zb.float(),
  maritimeTradeValue: zb.float(),
  // Circumvention index of an embargoed exporter, 0..1, per good (J3a
  // sanctions; per good since the J4: fungible goods shipped by sea re-route
  // faster than pipeline gas).
  circumvention: amounts,
  // Trade dependence (J3a): trade / GDP of the sheet, and the level factor
  // of GDP that sanctions and wars with trade partners are pulling towards
  // (1 = nothing lost).
  tradeOpenness: zb.float(),
  tradeFactor: zb.float(),
});
export type NationEconomyV6 = z.infer<typeof NationEconomyV6Schema>;

// --- the political engine (J4) --------------------------------------------

// Wire versions of the ideology and traits of politics.ts / leaders.ts (zbin
// wants explicit number encodings).
export const IdeologyWireV6Schema = z.object({
  economic: zb.float(),
  authority: zb.float(),
  sovereignty: zb.float(),
});
export const TraitsWireV6Schema = IdeologyWireV6Schema.extend({
  aggressiveness: zb.float(),
  corruption: zb.float(),
  charisma: zb.float(),
  competence: zb.float(),
});

// A political actor in play: the leader of the nation or of a party. Real
// ones carry an i18n key (parody or fictional name, per config), generated
// ones a literal name drawn from the name pools.
export const ActorStateV6Schema = z.object({
  id: z.string().min(1),
  name: NationNameSchema,
  born: IsoDateSchema,
  party: z.string().nullable(),
  role: ActorRoleSchema,
  traits: TraitsWireV6Schema,
});
export type ActorStateV6 = z.infer<typeof ActorStateV6Schema>;

export const PartyStateV6Schema = z.object({
  id: z.string().min(1),
  name: NationNameSchema,
  ideology: IdeologyWireV6Schema,
  support: zb.float(), // share at the last election
  leader: ActorStateV6Schema,
});
export type PartyStateV6 = z.infer<typeof PartyStateV6Schema>;

export const ElectionResultV6Schema = z.object({
  date: IsoDateSchema,
  results: amounts, // party -> share
  incumbentShare: zb.float(),
  alternation: z.boolean(),
  fraudDetected: z.boolean(),
});
export type ElectionResultV6 = z.infer<typeof ElectionResultV6Schema>;

export const NationPoliticsV6Schema = z.object({
  // Eight interest groups: the player's nation only (asymmetric simulation).
  groups: amounts.nullable(),
  opinion: zb.float(),
  stability: zb.float(),
  unrest: z.boolean(),
  reprimanded: z.boolean(),
  // Bloc fiscal rule (J3 revision): consecutive months with the trailing
  // twelve-month deficit above the limit, and the opinion malus in force,
  // which fades out over some months once the reprimand is lifted.
  deficitBreachMonths: zb.uint(),
  reprimandMalus: zb.float(),
  // The political engine (J4). The regime in play (a coup or a reform
  // changes it), legitimacy, political capital, corruption of the leader,
  // press freedom and media control in effect.
  regime: RegimeSchema,
  legitimacy: zb.float(),
  capital: zb.float(),
  corruption: zb.float(),
  pressFreedom: zb.float(),
  mediaControl: zb.float(),
  leader: ActorStateV6Schema,
  parties: z.array(PartyStateV6Schema),
  government: z.object({
    parties: z.array(z.string()),
    since: IsoDateSchema,
    ideology: IdeologyWireV6Schema,
  }),
  nextElection: IsoDateSchema.nullable(),
  lastElection: ElectionResultV6Schema.nullable(),
  electionsSuspended: z.boolean(),
  levers: z.object({
    propagandaPctGdp: zb.float(),
    fraud: zb.float(),
    clientelism: z.string().nullable(), // targeted group
  }),
  laws: z.array(z.object({ id: z.string(), since: IsoDateSchema })),
  repealing: z.array(z.object({ id: z.string(), at: IsoDateSchema })),
  lowStabilityMonths: zb.uint(),
  fraudCoupUntil: IsoDateSchema.nullable(),
  coupRisk: zb.float(), // last monthly probability, for the screens
  groupIdeologies: z.record(z.string(), IdeologyWireV6Schema),
  // Counters for the metrics and the objectives.
  alternations: zb.uint(),
  coups: zb.uint(),
  revolutions: zb.uint(),
  electionsWon: zb.uint(),
  // Blocs with a democratic criterion that suspended the nation (coup).
  suspendedFrom: z.array(z.string()),
  // When the regime in play started, and the regime before it (a junta
  // hands power back to it when it was democratic).
  regimeSince: IsoDateSchema,
  regimeBefore: RegimeSchema.nullable(),
});
export type NationPoliticsV6 = z.infer<typeof NationPoliticsV6Schema>;

export const PinnedObjectiveV6Schema = z.object({
  id: z.string().min(1),
  since: IsoDateSchema,
  baseline: zb.float(), // value of the tracked quantity when pinned
  progress: zb.float(), // 0..1
  done: z.boolean(),
});
export type PinnedObjectiveV6 = z.infer<typeof PinnedObjectiveV6Schema>;

export const EmbargoV6Schema = z.object({
  from: z.string(), // exporter
  to: z.string(), // importer (a nation or ROW)
  good: z.string(),
});
export type EmbargoV6 = z.infer<typeof EmbargoV6Schema>;

export const MarketV6Schema = z.object({
  prices: amounts, // world price
  // Price paid by the importers of the scenario: the world price plus a
  // premium when the scenario's demand is not covered (J3).
  importPrices: amounts,
  // Volume a good's embargoes keep off the market, annualised: it leaves the
  // supply that forms the price.
  stranded: amounts,
  rowProduction: amounts,
  // Production the rest of the world really delivers: it follows its price
  // response with a lag of months instead of instantly (J3).
  rowEffectiveProduction: amounts,
  rowConsumption: amounts,
  rowSupplyShock: amounts, // AR(1), multiplicative
  embargoes: z.array(EmbargoV6Schema),
});
export type MarketV6 = z.infer<typeof MarketV6Schema>;

export const EconomyStateV6Schema = z.object({
  market: MarketV6Schema,
  nations: z.record(z.string(), NationEconomyV6Schema),
});
export type EconomyStateV6 = z.infer<typeof EconomyStateV6Schema>;

export const PoliticsStateV6Schema = z.object({
  nations: z.record(z.string(), NationPoliticsV6Schema),
  // True when the player's nation is run by the AI fiscal rule (headless).
  autopilot: z.boolean(),
  // The player's objectives and free-text notes (J4).
  player: z.object({
    objectives: z.array(PinnedObjectiveV6Schema),
    notes: z.array(z.object({ date: IsoDateSchema, text: z.string() })),
  }),
});
export type PoliticsStateV6 = z.infer<typeof PoliticsStateV6Schema>;

// --- diplomacy (J3a) ---------------------------------------------------------

export const PeaceTermsV6Schema = z.object({
  // ceasefire: everyone keeps what it holds, no transfer; cession: the tiles
  // the winner holds stay with it, tagged contested; annexation: every tile
  // of the loser goes to the winner, the loser is exiled.
  kind: z.enum(["ceasefire", "cession", "annexation"]),
  reparationsPctGdp: zb.float(), // of the payer's GDP, per year
  reparationYears: zb.uint(),
  maxDivisions: zb.uint().nullable(), // demilitarisation of the loser
});
export type PeaceTermsV6 = z.infer<typeof PeaceTermsV6Schema>;

export const PeaceOfferV6Schema = z.object({
  id: zb.uint(),
  war: z.string(),
  from: NationIdSchema,
  to: NationIdSchema,
  terms: PeaceTermsV6Schema,
  date: IsoDateSchema,
});
export type PeaceOfferV6 = z.infer<typeof PeaceOfferV6Schema>;

export const WarV6Schema = z.object({
  id: z.string().min(1),
  aggressors: z.array(NationIdSchema),
  defenders: z.array(NationIdSchema),
  casusBelli: z.string().nullable(), // id of the catalogue; null = none
  since: IsoDateSchema,
  // False for a war the scenario starts with: the world has priced it in.
  declaredInCampaign: z.boolean(),
  // Per belligerent: war score, months in a row spent losing tiles, tiles
  // taken since the start, net tiles gained this month (reset monthly).
  score: z.record(z.string(), zb.float()),
  retreatMonths: z.record(z.string(), zb.uint()),
  tilesTaken: z.record(z.string(), zb.uint()),
  monthlyTiles: z.record(z.string(), zb.float()),
  offers: z.array(PeaceOfferV6Schema),
  // J6: men each belligerent lost in this war (its war memory at the end),
  // and the claims of the aggressors it was declared on (a white or lost
  // war weakens them).
  losses: z.record(z.string(), zb.float()),
  claims: z.array(z.string()),
});
export type WarV6 = z.infer<typeof WarV6Schema>;

// A claim of a nation on a region (J6): a region of the scenario, or
// "homeland:<ISO3>" (the first-day land of that nation, claimed by it).
// Two white or lost wars on a claim halve its weight, which scales the
// motive of a war on it.
export const ClaimV6Schema = z.object({
  region: z.string(),
  claimant: NationIdSchema,
  weight: zb.float(),
  failures: zb.uint(),
});
export type ClaimV6 = z.infer<typeof ClaimV6Schema>;

export const SanctionV6Schema = z.object({
  by: NationIdSchema,
  against: NationIdSchema,
  since: IsoDateSchema,
  // J6b: a sanction of policy (the first day of the world: Russia, Iran,
  // North Korea, Cuba...): lifted only once the regime of the target has
  // changed and the two governments are close
  // (diplomacy.sanction.liftPolicyMinAffinity). Absent: a sanction imposed
  // in the campaign, lifted by the rule of the J3.
  policy: z.boolean().optional(),
});
export type SanctionV6 = z.infer<typeof SanctionV6Schema>;

export const DiplomacyStateV6Schema = z.object({
  // relations[a][b] for a < b (ids compared as strings), in [-100, 100].
  relations: z.record(z.string(), z.record(z.string(), zb.float())),
  wars: z.array(WarV6Schema),
  sanctions: z.array(SanctionV6Schema),
  // Coalition calls open against an aggressor: months left to answer, and
  // the side the nation would join (J5: against a nuclear shooter, whatever
  // its side).
  coalitionCalls: z.array(
    z.object({
      war: z.string(),
      nation: NationIdSchema,
      monthsLeft: zb.uint(),
      side: z.enum(["aggressors", "defenders"]),
    }),
  ),
  // Nations that fired a nuclear weapon (J5): a coalition may form against
  // them whatever their power.
  pariahs: z.array(NationIdSchema),
  // Grievances an event gave a nation against another (J5): a casus belli
  // until the date.
  grievances: z.array(
    z.object({
      by: NationIdSchema,
      against: NationIdSchema,
      until: IsoDateSchema,
    }),
  ),
  // Annexations signed while the dead hand of the annexed nation fired: the
  // land changes hands the next day, once the warhead has left its silo.
  pendingAnnexations: z.array(
    z.object({
      war: z.string(),
      nation: NationIdSchema,
      by: NationIdSchema,
      at: IsoDateSchema,
    }),
  ),
  // Claims whose weight or failures differ from the default (J6; the
  // scenario's claims are all listed from the first day).
  claims: z.array(ClaimV6Schema),
  // WarV6 memory of each nation (J6): raises the gain it asks of a new war,
  // halves every config.ai.nations.war.memory.halfLifeYears.
  warMemory: z.record(z.string(), zb.float()),
  reparations: z.array(
    z.object({
      from: NationIdSchema,
      to: NationIdSchema,
      pctGdp: zb.float(),
      until: IsoDateSchema,
    }),
  ),
  demilitarized: z.array(
    z.object({ nation: NationIdSchema, maxDivisions: zb.uint() }),
  ),
  nextOfferId: zb.uint(),
  nextWarId: zb.uint(),
});
export type DiplomacyStateV6 = z.infer<typeof DiplomacyStateV6Schema>;

// --- military (J3a) ----------------------------------------------------------

export const DivisionV6Schema = z.object({
  id: zb.uint(),
  template: z.string(),
  men: zb.float(),
  equipment: zb.float(), // 0..1
  training: zb.float(),
  // Assignment: a front (id "A|B", ids sorted), optionally one of its
  // segments; null = reserve.
  front: z.string().nullable(),
  segment: zb.uint().nullable(),
  posture: z.enum(["defend", "attack", "breakthrough"]),
});
export type DivisionV6 = z.infer<typeof DivisionV6Schema>;

export const NationMilitaryV6Schema = z.object({
  conscription: z.enum(["peace", "partial", "total"]),
  manpower: zb.float(), // men available in the pool
  divisions: z.array(DivisionV6Schema),
  nextDivisionId: zb.uint(),
  exhaustion: zb.float(), // 0..1
  training: zb.float(), // of new divisions
  losses: zb.float(), // men, cumulative
  lossesLastMonth: zb.float(),
  // Air and naval power of the sheet, scaled by the arms coverage in play.
  airPower: zb.float(),
  navalPower: zb.float(),
});
export type NationMilitaryV6 = z.infer<typeof NationMilitaryV6Schema>;

export const MilitaryStateV6Schema = z.object({
  nations: z.record(z.string(), NationMilitaryV6Schema),
});
export type MilitaryStateV6 = z.infer<typeof MilitaryStateV6Schema>;

// --- navy (J3b) ------------------------------------------------------------------

export const NavalStateV6Schema = z.object({
  // Where each nation projects its naval power: zone -> share (sum <= 1).
  // Empty = spread over its own coastal zones.
  deployments: z.record(z.string(), z.record(z.string(), zb.float())),
  // Last computed control of each zone: nation -> share of the presence.
  control: z.record(z.string(), z.record(z.string(), zb.float())),
  // Last computed blockade of each nation: share of the enemy control of
  // its coastal zones, 0..1.
  blockade: z.record(z.string(), zb.float()),
});
export type NavalStateV6 = z.infer<typeof NavalStateV6Schema>;

// --- nuclear weapons (J5) -------------------------------------------------------

export const NationNuclearV6Schema = z.object({
  doctrine: NuclearDoctrineSchema,
  warheads: zb.uint(),
  threat: zb.uint(), // 0 to 3, today
  shots: zb.uint(), // warheads fired in the campaign
});
export type NationNuclearV6 = z.infer<typeof NationNuclearV6Schema>;

export const NuclearStrikeV6Schema = z.object({
  id: zb.uint(),
  date: IsoDateSchema,
  by: NationIdSchema,
  target: NationIdSchema,
  aim: z.enum(["front", "capital", "city", "dead-hand"]),
  weapon: z.enum(["atom", "hydrogen"]),
  // In flight until the world reports it; "lost" when a save was reloaded
  // while it flew (warheads in flight are not saved).
  status: z.enum(["in-flight", "detonated", "intercepted", "failed", "lost"]),
  hits: z.record(z.string(), zb.uint()), // tiles hit, by nation
});
export type NuclearStrikeV6 = z.infer<typeof NuclearStrikeV6Schema>;

export const NuclearStateV6Schema = z.object({
  // Nuclear powers only.
  nations: z.record(z.string(), NationNuclearV6Schema),
  strikes: z.array(NuclearStrikeV6Schema),
  nextStrikeId: zb.uint(),
  // What fallout left of each nation hit: production, GDP and population
  // factor (1 = untouched), no reconstruction before the J7.
  fallout: z.record(z.string(), zb.float()),
});
export type NuclearStateV6 = z.infer<typeof NuclearStateV6Schema>;

// --- the AI of the nations (J5) ---------------------------------------------------

export const NationAiV6Schema = z.object({
  nextReview: IsoDateSchema,
  defenseGoal: zb.float(), // share of GDP it aims at
  lastWar: IsoDateSchema.nullable(), // last war it declared
  lastLanding: IsoDateSchema.nullable(),
  blockading: NationIdSchema.nullable(),
});
export type NationAiV6 = z.infer<typeof NationAiV6Schema>;

export const AiStateV6Schema = z.object({
  // Index of the next nation of the staggered review.
  cursor: zb.uint(),
  nations: z.record(z.string(), NationAiV6Schema),
  // Arms sent this month: index points of the good "arms".
  armsAid: z.array(
    z.object({ from: NationIdSchema, to: NationIdSchema, points: zb.float() }),
  ),
});
export type AiStateV6 = z.infer<typeof AiStateV6Schema>;

// --- blocs, layers 2 and 3 (J5) ------------------------------------------------

// The measures a bloc leader proposes; each falls in a decision domain of
// the bloc (sim/blocs/blocs.ts, MEASURE_DOMAIN).
export const BLOC_MEASURES_V6 = [
  "sanctions",
  "lift",
  "accession",
  "suspension",
  "budget",
  "common-defense",
  "tech-program",
  "trade-agreement",
] as const;
export const BlocMeasureV6Schema = z.enum(BLOC_MEASURES_V6);
export type BlocMeasureV6 = z.infer<typeof BlocMeasureV6Schema>;

export const BlocVoteV6Schema = z.enum(["yes", "no", "abstain"]);
export type BlocVoteV6 = z.infer<typeof BlocVoteV6Schema>;

export const BlocProposalV6Schema = z.object({
  id: zb.uint(),
  bloc: z.string(),
  by: NationIdSchema,
  kind: BlocMeasureV6Schema,
  // The nation the measure is about (sanctions, lift, accession,
  // suspension, trade agreement); null for the measures of the bloc itself.
  target: NationIdSchema.nullable(),
  direction: z.enum(["up", "down"]).nullable(), // budget only
  date: IsoDateSchema,
  resolveOn: IsoDateSchema,
  // Votes cast by the player; the AI votes when the proposal resolves.
  cast: z.record(z.string(), BlocVoteV6Schema),
  result: z.enum(["pending", "adopted", "rejected"]),
  votes: z.record(z.string(), BlocVoteV6Schema), // at resolution
});
export type BlocProposalV6 = z.infer<typeof BlocProposalV6Schema>;

export const BlocStateV6Schema = z.object({
  id: z.string(),
  // Every member, simulated or not; `since` null for the members of the
  // first day.
  members: z.array(
    z.object({
      nation: NationIdSchema,
      status: BlocMemberStatusSchema,
      since: IsoDateSchema.nullable(),
    }),
  ),
  budgetScale: zb.float(), // x the contribution of the data
  sanctions: z.array(NationIdSchema), // bloc sanctions in force
  agreements: z.array(NationIdSchema), // trade agreements with non-members
  commonDefense: z.boolean(), // voted common defence clause
  programs: z.array(
    z.object({ id: zb.uint(), since: IsoDateSchema, until: IsoDateSchema }),
  ),
  // Accession processes: opened, the next annual vote, the end.
  accessions: z.array(
    z.object({
      nation: NationIdSchema,
      since: IsoDateSchema,
      nextVote: IsoDateSchema,
      completeOn: IsoDateSchema,
    }),
  ),
  applications: z.array(
    z.object({ nation: NationIdSchema, date: IsoDateSchema }),
  ),
  exits: z.array(
    z.object({ nation: NationIdSchema, effectiveOn: IsoDateSchema }),
  ),
  lastProposal: z.string().nullable(), // "YYYY-MM" of the leader's last one
  // Last month's budget: what each member paid and received (US$).
  contributions: z.record(z.string(), zb.float()),
  received: z.record(z.string(), zb.float()),
});
export type BlocStateV6 = z.infer<typeof BlocStateV6Schema>;

export const BlocsStateV6Schema = z.object({
  blocs: z.array(BlocStateV6Schema),
  // Pending proposals and those resolved in the last months.
  proposals: z.array(BlocProposalV6Schema),
  nextProposal: zb.uint(),
  // Collective defence: a member attacked by a non-member calls the others;
  // the player answers within the month.
  calls: z.array(
    z.object({
      bloc: z.string(),
      war: z.string(),
      nation: NationIdSchema,
      until: IsoDateSchema,
    }),
  ),
  handledWars: z.array(z.string()),
  // Leader of each bloc at the last monthly step ("" = none simulated).
  leaders: z.record(z.string(), z.string()),
  // Net bloc transfer of each nation, paid by the next monthly budget.
  net: z.record(z.string(), zb.float()),
});
export type BlocsStateV6 = z.infer<typeof BlocsStateV6Schema>;

// --- technology (J5) ----------------------------------------------------------

export const TechProjectV6Schema = z.object({
  node: z.string(),
  points: zb.float(),
  since: IsoDateSchema,
});
export const NationTechV6Schema = z.object({
  // Nodes researched, in order; `baseline`: those it had on the first day
  // (their effects are in the data of 2026, not applied again).
  done: z.array(z.string()),
  baseline: z.array(z.string()),
  projects: z.array(TechProjectV6Schema), // at most config.tech.maxProjects
  pointsLastMonth: zb.float(),
});
export type NationTechV6 = z.infer<typeof NationTechV6Schema>;
export const TechStateV6Schema = z.object({
  nations: z.record(z.string(), NationTechV6Schema),
});
export type TechStateV6 = z.infer<typeof TechStateV6Schema>;

// --- events (J5) -----------------------------------------------------------------

export const EventInstanceV6Schema = z.object({
  id: zb.uint(),
  event: z.string(),
  nation: NationIdSchema, // the subject (the player for a world event)
  other: NationIdSchema.nullable(),
  good: z.string().nullable(),
  date: IsoDateSchema,
});
export type EventInstanceV6 = z.infer<typeof EventInstanceV6Schema>;
export const EventsStateV6Schema = z.object({
  nextId: zb.uint(),
  // Pop-ups waiting for the player's choice; unanswered, the government
  // decides at `deadline`.
  pending: z.array(EventInstanceV6Schema.extend({ deadline: IsoDateSchema })),
  // Events that happened, with the choice (the Events screen keeps the last
  // ones; the journal keeps them all).
  history: z.array(EventInstanceV6Schema.extend({ choice: z.string() })),
  // Once-events already fired, per event: the nations ("world" for a world
  // event); cooldowns: "event|nation" -> date when it may fire again.
  fired: z.record(z.string(), z.array(z.string())),
  cooldowns: z.record(z.string(), IsoDateSchema),
  // Growth effects that last some months.
  growth: z.array(
    z.object({
      nation: NationIdSchema,
      value: zb.float(),
      until: IsoDateSchema,
    }),
  ),
  // Pop-ups shown to the player this month ("YYYY-MM").
  popupMonth: z.string(),
  popups: zb.uint(),
});
export type EventsStateV6 = z.infer<typeof EventsStateV6Schema>;

// --- territory (J5) -----------------------------------------------------------

export const TerritoryStateV6Schema = z.object({
  // Tiles of each nation on the first day of the campaign (nuclear threat:
  // share of the territory lost).
  initialTiles: z.record(z.string(), zb.uint()),
  // Structures each nation has built on the map (levels summed, by OpenFront
  // unit type) at the last monthly count, and what the new ones cost its
  // budget that month (US$).
  structures: z.record(z.string(), z.record(z.string(), zb.uint())),
  constructionCost: z.record(z.string(), zb.float()),
});
export type TerritoryStateV6 = z.infer<typeof TerritoryStateV6Schema>;

export const SaveHeaderV6Schema = zb.object({
  schemaVersion: z.literal(6),
  seed: zb.uint(),
  rngState: z.tuple([zb.uint(), zb.uint(), zb.uint(), zb.uint()]),
  calendar: CalendarSchema,
  nations: z.array(NationStateSchema),
  blocs: BlocsStateV6Schema,
  world: WorldStateSchema,
  economy: EconomyStateV6Schema,
  politics: PoliticsStateV6Schema,
  diplomacy: DiplomacyStateV6Schema,
  military: MilitaryStateV6Schema,
  naval: NavalStateV6Schema,
  territory: TerritoryStateV6Schema,
  nuclear: NuclearStateV6Schema,
  ai: AiStateV6Schema,
  tech: TechStateV6Schema,
  events: EventsStateV6Schema,
  journal: z.array(JournalEntryV6Schema),
  metrics: z.record(z.string(), zb.float()),
  tilesInfo: z.object({ width: zb.uint(), height: zb.uint() }),
});
export type SaveHeaderV6 = z.infer<typeof SaveHeaderV6Schema>;
// The tile grid, and since v5 the contest of each tile (a second block of
// the .vsave container).
export type SaveFileV6 = SaveHeaderV6 & {
  tiles: Uint16Array;
  contest: Uint16Array;
};
