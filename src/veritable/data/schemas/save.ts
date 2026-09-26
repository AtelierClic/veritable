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

// Save file, CURRENT version: schemaVersion 7 (J7: the rolling queue of the
// nations and the time elapsed since their last update, population, the
// trade of each good, balances by calendar month, the monthly ledger of each
// war, sanctions that can be lifted, dormant claims, the base of the
// parties).
//
// zbin has no version byte and no field tags: the schema IS the format. Once
// a save of this version exists in the wild, any change of shape means a new
// version: freeze this file as saveV7.ts, write the new one here, and add
// migrations/v7-to-v8.ts (ARCHITECTURE.md, invariant 2).
//
// Pieces imported from saveV1.ts are unchanged since then; the frozen files
// (saveV1.ts to saveV6.ts) are never edited: a piece that must change is
// redefined here.

export const SAVE_SCHEMA_VERSION = 7;

export * from "./saveV1";

// Tile bit set on land taken by war or ceded at a peace (J3a); the nation
// index keeps its twelve bits and fallout its bit 13. Since v5 the contest
// block of the file says since when and how (sim/war/contest.ts); the bit is
// kept equal to "contest != 0".
export const TILE_CONTESTED_BIT = 1 << 12;
// Tile bit set on land a peace treaty settled (J6): no claim covers it any
// more, whoever holds it (sim/diplomacy/claims.ts).
export const TILE_SETTLED_BIT = 1 << 14;

export const JOURNAL_KINDS_V7 = [
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
  // J7: a month of a war in which the line moved (its battles).
  "war-month",
] as const;
export const JournalEntryV7Schema = z.object({
  date: IsoDateSchema,
  kind: z.enum(JOURNAL_KINDS_V7),
  nation: NationIdSchema.optional(),
  params: z.record(z.string(), z.string()),
  // J7: where it happened (a tile of the map: the camera goes there, a
  // marker shows it), and the thread it belongs to ("war:<id>": the
  // declaration, the months of the war, the peace).
  tile: zb.uint().optional(),
  link: z.string().optional(),
});
export type JournalEntryV7 = z.infer<typeof JournalEntryV7Schema>;

// Quantities keyed by good, tax, spending post or interest group. Key order
// is part of the bytes: records are always built in the order of the ids.
const amounts = z.record(z.string(), zb.float());

// Economy of one nation. Quantities per year in the unit of the good; money
// in US$. Sliders (taxes, spending) are the player's or the AI's settings;
// the `0` variants are the values of the first day, the reference of the
// political drivers and of the AI fiscal rule.
export const NationEconomySchema = z.object({
  gdp: zb.float(),
  debt: zb.float(),
  // J7: population in play (the sheet's on the first day, growing on its
  // trend; war and fallout take theirs), and the calendar month (months
  // since the start date) of the last update of the nation: the counters of
  // "N months in a row" move by the months crossed, whatever the cadence.
  population: zb.float(),
  monthMark: zb.uint(),
  growthBase: zb.float(), // per year
  growthAnnual: zb.float(), // annualised, smoothed over about a month (J7)
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
  // J7: the trade of each good, as the rotation of the goods last computed
  // it (US$ per year): value of the exports sold, of the imports (tariff
  // base), of the resource output sold (rents base), of the trade that went
  // by sea, and the price paid for the good (import premium included). The
  // aggregates above are sums over the goods.
  exportValue: amounts,
  importValue: amounts,
  rentValue: amounts,
  maritimeValue: amounts,
  paidPrice: amounts,
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
  // Monthly rates at the last update, US$ per month (J7: an update covers
  // the time since the previous one, a day to a month).
  revenue: zb.float(),
  expenditure: zb.float(),
  interest: zb.float(),
  interestRate: zb.float(),
  // J6b: the gap between the real rate of the first day (interest paid,
  // inflation) and the formula of the J2 at the debt and stability of that
  // day, kept for the whole campaign (0: the formula alone).
  interestSpread: zb.float(),
  // Balance of each calendar month (month = months since the start date),
  // the last twelve, the last one partial: `days` of it covered so far
  // (J7). The trailing deficit is their sum over the time they cover.
  balances: z.array(
    z.object({ month: zb.uint(), value: zb.float(), days: zb.float() }),
  ),
  // Calendar months in a row the debt rose (in money: a deficit over the
  // month, the meaning of the J2 to the J6), sampled at the turn of each
  // month of the nation against the debt of the previous turn (US$).
  debtRisingMonths: zb.uint(),
  debtMark: zb.float(),
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
export type NationEconomy = z.infer<typeof NationEconomySchema>;

// --- the political engine (J4) --------------------------------------------

// Wire versions of the ideology and traits of politics.ts / leaders.ts (zbin
// wants explicit number encodings).
export const IdeologyWireSchema = z.object({
  economic: zb.float(),
  authority: zb.float(),
  sovereignty: zb.float(),
});
export const TraitsWireSchema = IdeologyWireSchema.extend({
  aggressiveness: zb.float(),
  corruption: zb.float(),
  charisma: zb.float(),
  competence: zb.float(),
});

// A political actor in play: the leader of the nation or of a party. Real
// ones carry an i18n key (parody or fictional name, per config), generated
// ones a literal name drawn from the name pools.
export const ActorStateSchema = z.object({
  id: z.string().min(1),
  name: NationNameSchema,
  born: IsoDateSchema,
  party: z.string().nullable(),
  role: ActorRoleSchema,
  traits: TraitsWireSchema,
});
export type ActorState = z.infer<typeof ActorStateSchema>;

export const PartyStateSchema = z.object({
  id: z.string().min(1),
  name: NationNameSchema,
  ideology: IdeologyWireSchema,
  support: zb.float(), // share at the last election
  // J7: the attachment of the voters to the party, fitted on the first day
  // so that the projection of that day gives the last election's shares.
  base: zb.float(),
  leader: ActorStateSchema,
});
export type PartyState = z.infer<typeof PartyStateSchema>;

export const ElectionResultSchema = z.object({
  date: IsoDateSchema,
  results: amounts, // party -> share
  incumbentShare: zb.float(),
  alternation: z.boolean(),
  fraudDetected: z.boolean(),
});
export type ElectionResult = z.infer<typeof ElectionResultSchema>;

export const NationPoliticsSchema = z.object({
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
  leader: ActorStateSchema,
  parties: z.array(PartyStateSchema),
  government: z.object({
    parties: z.array(z.string()),
    since: IsoDateSchema,
    ideology: IdeologyWireSchema,
  }),
  nextElection: IsoDateSchema.nullable(),
  lastElection: ElectionResultSchema.nullable(),
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
  groupIdeologies: z.record(z.string(), IdeologyWireSchema),
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
export type NationPolitics = z.infer<typeof NationPoliticsSchema>;

export const PinnedObjectiveSchema = z.object({
  id: z.string().min(1),
  since: IsoDateSchema,
  baseline: zb.float(), // value of the tracked quantity when pinned
  progress: zb.float(), // 0..1
  done: z.boolean(),
});
export type PinnedObjective = z.infer<typeof PinnedObjectiveSchema>;

export const EmbargoSchema = z.object({
  from: z.string(), // exporter
  to: z.string(), // importer (a nation or ROW)
  good: z.string(),
});
export type Embargo = z.infer<typeof EmbargoSchema>;

export const MarketSchema = z.object({
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
  embargoes: z.array(EmbargoSchema),
});
export type Market = z.infer<typeof MarketSchema>;

export const EconomyStateSchema = z.object({
  market: MarketSchema,
  nations: z.record(z.string(), NationEconomySchema),
});
export type EconomyState = z.infer<typeof EconomyStateSchema>;

export const PoliticsStateSchema = z.object({
  nations: z.record(z.string(), NationPoliticsSchema),
  // True when the player's nation is run by the AI fiscal rule (headless).
  autopilot: z.boolean(),
  // The player's objectives and free-text notes (J4).
  player: z.object({
    objectives: z.array(PinnedObjectiveSchema),
    notes: z.array(z.object({ date: IsoDateSchema, text: z.string() })),
  }),
});
export type PoliticsState = z.infer<typeof PoliticsStateSchema>;

// --- diplomacy (J3a) ---------------------------------------------------------

export const PeaceTermsSchema = z.object({
  // ceasefire: everyone keeps what it holds, no transfer; cession: the tiles
  // the winner holds stay with it, tagged contested; annexation: every tile
  // of the loser goes to the winner, the loser is exiled.
  kind: z.enum(["ceasefire", "cession", "annexation"]),
  reparationsPctGdp: zb.float(), // of the payer's GDP, per year
  reparationYears: zb.uint(),
  maxDivisions: zb.uint().nullable(), // demilitarisation of the loser
});
export type PeaceTerms = z.infer<typeof PeaceTermsSchema>;

export const PeaceOfferSchema = z.object({
  id: zb.uint(),
  war: z.string(),
  from: NationIdSchema,
  to: NationIdSchema,
  terms: PeaceTermsSchema,
  date: IsoDateSchema,
});
export type PeaceOffer = z.infer<typeof PeaceOfferSchema>;

export const WarSchema = z.object({
  id: z.string().min(1),
  aggressors: z.array(NationIdSchema),
  defenders: z.array(NationIdSchema),
  casusBelli: z.string().nullable(), // id of the catalogue; null = none
  since: IsoDateSchema,
  // False for a war the scenario starts with: the world has priced it in.
  declaredInCampaign: z.boolean(),
  // Per belligerent: war score, months in a row spent losing tiles, tiles
  // taken since the start, net tiles gained this war month (J7: a war keeps
  // its own months, counted from its start; `ledgerOn` is the next turn).
  ledgerOn: IsoDateSchema,
  score: z.record(z.string(), zb.float()),
  retreatMonths: z.record(z.string(), zb.uint()),
  tilesTaken: z.record(z.string(), zb.uint()),
  monthlyTiles: z.record(z.string(), zb.float()),
  offers: z.array(PeaceOfferSchema),
  // J6: men each belligerent lost in this war (its war memory at the end),
  // and the claims of the aggressors it was declared on (a white or lost
  // war weakens them).
  losses: z.record(z.string(), zb.float()),
  claims: z.array(z.string()),
});
export type War = z.infer<typeof WarSchema>;

// A claim of a nation on a region (J6): a region of the scenario, or
// "homeland:<ISO3>" (the first-day land of that nation, claimed by it).
// Two white or lost wars on a claim halve its weight, which scales the
// motive of a war on it.
export const ClaimSchema = z.object({
  region: z.string(),
  claimant: NationIdSchema,
  weight: zb.float(),
  failures: zb.uint(),
  // J7: a claim pressed in vain three times sleeps (no casus belli, no
  // weight) until a sovereignist leader or a change of regime of the
  // claimant wakes it.
  dormant: z.boolean(),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const SanctionSchema = z.object({
  by: NationIdSchema,
  against: NationIdSchema,
  since: IsoDateSchema,
  // J6b: a sanction of policy (the first day of the world: Russia, Iran,
  // North Korea, Cuba...): lifted only once the regime of the target has
  // changed and the two governments are close
  // (diplomacy.sanction.liftPolicyMinAffinity). Absent: a sanction imposed
  // in the campaign, lifted by the rule of the J3.
  policy: z.boolean().optional(),
  // J7, the ways a sanction falls: the war it answers (it stands while that
  // war lasts); the date by which the issuer reviews it after a change of
  // regime of the target; since when the relation of the issuer with the
  // target has stayed >= 0.
  war: z.string().optional(),
  reviewBy: IsoDateSchema.optional(),
  friendlySince: IsoDateSchema.optional(),
});
export type Sanction = z.infer<typeof SanctionSchema>;

export const DiplomacyStateSchema = z.object({
  // relations[a][b] for a < b (ids compared as strings), in [-100, 100].
  relations: z.record(z.string(), z.record(z.string(), zb.float())),
  wars: z.array(WarSchema),
  sanctions: z.array(SanctionSchema),
  // Coalition calls open against an aggressor: months left to answer, and
  // the side the nation would join (J5: against a nuclear shooter, whatever
  // its side).
  coalitionCalls: z.array(
    z.object({
      war: z.string(),
      nation: NationIdSchema,
      until: IsoDateSchema, // J7: a date rather than months left
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
  claims: z.array(ClaimSchema),
  // War memory of each nation (J6): raises the gain it asks of a new war,
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
export type DiplomacyState = z.infer<typeof DiplomacyStateSchema>;

// --- military (J3a) ----------------------------------------------------------

export const DivisionSchema = z.object({
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
export type Division = z.infer<typeof DivisionSchema>;

export const NationMilitarySchema = z.object({
  conscription: z.enum(["peace", "partial", "total"]),
  manpower: zb.float(), // men available in the pool
  divisions: z.array(DivisionSchema),
  nextDivisionId: zb.uint(),
  exhaustion: zb.float(), // 0..1
  training: zb.float(), // of new divisions
  losses: zb.float(), // men, cumulative
  // J7: men lost since the last update of the nation (exhaustion), and arms
  // received from abroad since then (index points).
  lossesPending: zb.float(),
  armsReceived: zb.float(),
  // Air and naval power of the sheet, scaled by the arms coverage in play.
  airPower: zb.float(),
  navalPower: zb.float(),
});
export type NationMilitary = z.infer<typeof NationMilitarySchema>;

export const MilitaryStateSchema = z.object({
  nations: z.record(z.string(), NationMilitarySchema),
});
export type MilitaryState = z.infer<typeof MilitaryStateSchema>;

// --- navy (J3b) ------------------------------------------------------------------

export const NavalStateSchema = z.object({
  // Where each nation projects its naval power: zone -> share (sum <= 1).
  // Empty = spread over its own coastal zones.
  deployments: z.record(z.string(), z.record(z.string(), zb.float())),
  // Last computed control of each zone: nation -> share of the presence.
  control: z.record(z.string(), z.record(z.string(), zb.float())),
  // Last computed blockade of each nation: share of the enemy control of
  // its coastal zones, 0..1.
  blockade: z.record(z.string(), zb.float()),
});
export type NavalState = z.infer<typeof NavalStateSchema>;

// --- nuclear weapons (J5) -------------------------------------------------------

export const NationNuclearSchema = z.object({
  doctrine: NuclearDoctrineSchema,
  warheads: zb.uint(),
  threat: zb.uint(), // 0 to 3, today
  shots: zb.uint(), // warheads fired in the campaign
});
export type NationNuclear = z.infer<typeof NationNuclearSchema>;

export const NuclearStrikeSchema = z.object({
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
export type NuclearStrike = z.infer<typeof NuclearStrikeSchema>;

export const NuclearStateSchema = z.object({
  // Nuclear powers only.
  nations: z.record(z.string(), NationNuclearSchema),
  strikes: z.array(NuclearStrikeSchema),
  nextStrikeId: zb.uint(),
  // What fallout left of each nation hit: production, GDP and population
  // factor (1 = untouched), no reconstruction before the J7.
  fallout: z.record(z.string(), zb.float()),
});
export type NuclearState = z.infer<typeof NuclearStateSchema>;

// --- the AI of the nations (J5) ---------------------------------------------------

export const NationAiSchema = z.object({
  defenseGoal: zb.float(), // share of GDP it aims at
  lastWar: IsoDateSchema.nullable(), // last war it declared
  lastLanding: IsoDateSchema.nullable(),
  blockading: NationIdSchema.nullable(),
});
export type NationAi = z.infer<typeof NationAiSchema>;

export const AiStateSchema = z.object({
  nations: z.record(z.string(), NationAiSchema),
  // Arms each donor sends: index points of the good "arms" per month.
  armsAid: z.array(
    z.object({ from: NationIdSchema, to: NationIdSchema, points: zb.float() }),
  ),
});
export type AiState = z.infer<typeof AiStateSchema>;

// --- blocs, layers 2 and 3 (J5) ------------------------------------------------

// The measures a bloc leader proposes; each falls in a decision domain of
// the bloc (sim/blocs/blocs.ts, MEASURE_DOMAIN).
export const BLOC_MEASURES = [
  "sanctions",
  "lift",
  "accession",
  "suspension",
  "budget",
  "common-defense",
  "tech-program",
  "trade-agreement",
] as const;
export const BlocMeasureSchema = z.enum(BLOC_MEASURES);
export type BlocMeasure = z.infer<typeof BlocMeasureSchema>;

export const BlocVoteSchema = z.enum(["yes", "no", "abstain"]);
export type BlocVote = z.infer<typeof BlocVoteSchema>;

export const BlocProposalSchema = z.object({
  id: zb.uint(),
  bloc: z.string(),
  by: NationIdSchema,
  kind: BlocMeasureSchema,
  // The nation the measure is about (sanctions, lift, accession,
  // suspension, trade agreement); null for the measures of the bloc itself.
  target: NationIdSchema.nullable(),
  direction: z.enum(["up", "down"]).nullable(), // budget only
  date: IsoDateSchema,
  resolveOn: IsoDateSchema,
  // Votes cast by the player; the AI votes when the proposal resolves.
  cast: z.record(z.string(), BlocVoteSchema),
  result: z.enum(["pending", "adopted", "rejected"]),
  votes: z.record(z.string(), BlocVoteSchema), // at resolution
});
export type BlocProposal = z.infer<typeof BlocProposalSchema>;

export const BlocStateSchema = z.object({
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
export type BlocState = z.infer<typeof BlocStateSchema>;

export const BlocsStateSchema = z.object({
  blocs: z.array(BlocStateSchema),
  // Pending proposals and those resolved in the last months.
  proposals: z.array(BlocProposalSchema),
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
export type BlocsState = z.infer<typeof BlocsStateSchema>;

// --- technology (J5) ----------------------------------------------------------

export const TechProjectSchema = z.object({
  node: z.string(),
  points: zb.float(),
  since: IsoDateSchema,
});
export const NationTechSchema = z.object({
  // Nodes researched, in order; `baseline`: those it had on the first day
  // (their effects are in the data of 2026, not applied again).
  done: z.array(z.string()),
  baseline: z.array(z.string()),
  projects: z.array(TechProjectSchema), // at most config.tech.maxProjects
  pointsLastMonth: zb.float(),
});
export type NationTech = z.infer<typeof NationTechSchema>;
export const TechStateSchema = z.object({
  nations: z.record(z.string(), NationTechSchema),
});
export type TechState = z.infer<typeof TechStateSchema>;

// --- events (J5) -----------------------------------------------------------------

export const EventInstanceSchema = z.object({
  id: zb.uint(),
  event: z.string(),
  nation: NationIdSchema, // the subject (the player for a world event)
  other: NationIdSchema.nullable(),
  good: z.string().nullable(),
  date: IsoDateSchema,
});
export type EventInstance = z.infer<typeof EventInstanceSchema>;
export const EventsStateSchema = z.object({
  nextId: zb.uint(),
  // Pop-ups waiting for the player's choice; unanswered, the government
  // decides at `deadline`.
  pending: z.array(EventInstanceSchema.extend({ deadline: IsoDateSchema })),
  // Events that happened, with the choice (the Events screen keeps the last
  // ones; the journal keeps them all).
  history: z.array(EventInstanceSchema.extend({ choice: z.string() })),
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
export type EventsState = z.infer<typeof EventsStateSchema>;

// --- territory (J5) -----------------------------------------------------------

export const TerritoryStateSchema = z.object({
  // Tiles of each nation on the first day of the campaign (nuclear threat:
  // share of the territory lost).
  initialTiles: z.record(z.string(), zb.uint()),
  // Structures each nation has built on the map (levels summed, by OpenFront
  // unit type) at the last monthly count, and what the new ones cost its
  // budget that month (US$).
  structures: z.record(z.string(), z.record(z.string(), zb.uint())),
  constructionCost: z.record(z.string(), zb.float()),
});
export type TerritoryState = z.infer<typeof TerritoryStateSchema>;

// --- the rolling queue of the nations (J7) ------------------------------------

// Every nation is updated on its own cadence (the player's every day, the
// nations dealing with it at least every week, the others every week to
// every month): `last` and `next` are elapsed game minutes; `drift` the
// last time the relations it owns drifted (at most once a month but for
// the player's, every day).
export const ScheduleStateSchema = z.object({
  nations: z.record(
    z.string(),
    z.object({ last: zb.uint(), next: zb.uint(), drift: zb.uint() }),
  ),
});
export type ScheduleState = z.infer<typeof ScheduleStateSchema>;

export const SaveHeaderV7Schema = zb.object({
  schemaVersion: z.literal(7),
  seed: zb.uint(),
  rngState: z.tuple([zb.uint(), zb.uint(), zb.uint(), zb.uint()]),
  calendar: CalendarSchema,
  nations: z.array(NationStateSchema),
  blocs: BlocsStateSchema,
  world: WorldStateSchema,
  economy: EconomyStateSchema,
  politics: PoliticsStateSchema,
  diplomacy: DiplomacyStateSchema,
  military: MilitaryStateSchema,
  naval: NavalStateSchema,
  territory: TerritoryStateSchema,
  nuclear: NuclearStateSchema,
  ai: AiStateSchema,
  tech: TechStateSchema,
  events: EventsStateSchema,
  schedule: ScheduleStateSchema,
  journal: z.array(JournalEntryV7Schema),
  metrics: z.record(z.string(), zb.float()),
  tilesInfo: z.object({ width: zb.uint(), height: zb.uint() }),
});
export type SaveHeaderV7 = z.infer<typeof SaveHeaderV7Schema>;
// The tile grid, and since v5 the contest of each tile (a second block of
// the .vsave container).
export type SaveFileV7 = SaveHeaderV7 & {
  tiles: Uint16Array;
  contest: Uint16Array;
};

// Current version aliases: the rest of the code only uses these.
export const SaveHeaderSchema = SaveHeaderV7Schema;
export type SaveFile = SaveFileV7;
export type JournalEntry = JournalEntryV7;
export const JOURNAL_KINDS = JOURNAL_KINDS_V7;
