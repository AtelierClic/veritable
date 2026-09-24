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

// Save file, version 5 (J5: contest of each tile, territory, nuclear, nation
// AI, blocs, technology, events). FROZEN: a v5 file can only be decoded by
// this schema, forever. The current version is save.ts.
//
// Pieces imported from saveV1.ts are unchanged since v1.

export const JOURNAL_KINDS_V5 = [
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
] as const;
export const JournalEntryV5Schema = z.object({
  date: IsoDateSchema,
  kind: z.enum(JOURNAL_KINDS_V5),
  nation: NationIdSchema.optional(),
  params: z.record(z.string(), z.string()),
});
export type JournalEntryV5 = z.infer<typeof JournalEntryV5Schema>;

// Quantities keyed by good, tax, spending post or interest group. Key order
// is part of the bytes: records are always built in the order of the ids.
const amountsV5 = z.record(z.string(), zb.float());

// Economy of one nation. Quantities per year in the unit of the good; money
// in US$. Sliders (taxes, spending) are the player's or the AI's settings;
// the `0` variants are the values of the first day, the reference of the
// political drivers and of the AI fiscal rule.
export const NationEconomyV5Schema = z.object({
  gdp: zb.float(),
  debt: zb.float(),
  growthBase: zb.float(), // per year
  growthAnnual: zb.float(), // last month, annualised
  production: amountsV5, // capacity
  consumption: amountsV5, // demand at the base price
  fossilShare: amountsV5, // share of electricity made from gas / coal / oil
  coverage: amountsV5, // obtained / needed, last month
  imports: amountsV5, // last month, annualised
  exports: amountsV5,
  // Value of the exports really sold (US$ per year, last month), and the
  // share of GDP it is compared with in the growth: starts at the share of
  // the first day and adapts slowly (J3, correction of the J2).
  exportsValue: zb.float(),
  exportShareReference: zb.float(),
  shortage: zb.float(), // weighted lack of coverage, 0..1
  priceIndex: zb.float(), // consumer basket, 1 = base prices
  taxes: amountsV5, // in effect
  taxes0: amountsV5,
  spending: amountsV5, // shares of GDP, in effect
  spending0: amountsV5,
  // Sliders with a progressive effect (J4): what the player or the AI set;
  // the values in effect reach them over laws.rampMonths.
  taxTargets: amountsV5,
  spendingTargets: amountsV5,
  grantsPctGdp: zb.float(),
  investmentReference: zb.float(), // infrastructure + research on day one
  revenue: zb.float(), // last month, US$
  expenditure: zb.float(),
  interest: zb.float(),
  interestRate: zb.float(),
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
  circumvention: amountsV5,
  // Trade dependence (J3a): trade / GDP of the sheet, and the level factor
  // of GDP that sanctions and wars with trade partners are pulling towards
  // (1 = nothing lost).
  tradeOpenness: zb.float(),
  tradeFactor: zb.float(),
});
export type NationEconomyV5 = z.infer<typeof NationEconomyV5Schema>;

// --- the political engine (J4) --------------------------------------------

// Wire versions of the ideology and traits of politics.ts / leaders.ts (zbin
// wants explicit number encodings).
export const IdeologyWireV5Schema = z.object({
  economic: zb.float(),
  authority: zb.float(),
  sovereignty: zb.float(),
});
export const TraitsWireV5Schema = IdeologyWireV5Schema.extend({
  aggressiveness: zb.float(),
  corruption: zb.float(),
  charisma: zb.float(),
  competence: zb.float(),
});

// A political actor in play: the leader of the nation or of a party. Real
// ones carry an i18n key (parody or fictional name, per config), generated
// ones a literal name drawn from the name pools.
export const ActorStateV5Schema = z.object({
  id: z.string().min(1),
  name: NationNameSchema,
  born: IsoDateSchema,
  party: z.string().nullable(),
  role: ActorRoleSchema,
  traits: TraitsWireV5Schema,
});
export type ActorStateV5 = z.infer<typeof ActorStateV5Schema>;

export const PartyStateV5Schema = z.object({
  id: z.string().min(1),
  name: NationNameSchema,
  ideology: IdeologyWireV5Schema,
  support: zb.float(), // share at the last election
  leader: ActorStateV5Schema,
});
export type PartyStateV5 = z.infer<typeof PartyStateV5Schema>;

export const ElectionResultV5Schema = z.object({
  date: IsoDateSchema,
  results: amountsV5, // party -> share
  incumbentShare: zb.float(),
  alternation: z.boolean(),
  fraudDetected: z.boolean(),
});
export type ElectionResultV5 = z.infer<typeof ElectionResultV5Schema>;

export const NationPoliticsV5Schema = z.object({
  // Eight interest groups: the player's nation only (asymmetric simulation).
  groups: amountsV5.nullable(),
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
  leader: ActorStateV5Schema,
  parties: z.array(PartyStateV5Schema),
  government: z.object({
    parties: z.array(z.string()),
    since: IsoDateSchema,
    ideology: IdeologyWireV5Schema,
  }),
  nextElection: IsoDateSchema.nullable(),
  lastElection: ElectionResultV5Schema.nullable(),
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
  groupIdeologies: z.record(z.string(), IdeologyWireV5Schema),
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
export type NationPoliticsV5 = z.infer<typeof NationPoliticsV5Schema>;

export const PinnedObjectiveV5Schema = z.object({
  id: z.string().min(1),
  since: IsoDateSchema,
  baseline: zb.float(), // value of the tracked quantity when pinned
  progress: zb.float(), // 0..1
  done: z.boolean(),
});
export type PinnedObjectiveV5 = z.infer<typeof PinnedObjectiveV5Schema>;

export const EmbargoV5Schema = z.object({
  from: z.string(), // exporter
  to: z.string(), // importer (a nation or ROW)
  good: z.string(),
});
export type EmbargoV5 = z.infer<typeof EmbargoV5Schema>;

export const MarketV5Schema = z.object({
  prices: amountsV5, // world price
  // Price paid by the importers of the scenario: the world price plus a
  // premium when the scenario's demand is not covered (J3).
  importPrices: amountsV5,
  // Volume a good's embargoes keep off the market, annualised: it leaves the
  // supply that forms the price.
  stranded: amountsV5,
  rowProduction: amountsV5,
  // Production the rest of the world really delivers: it follows its price
  // response with a lag of months instead of instantly (J3).
  rowEffectiveProduction: amountsV5,
  rowConsumption: amountsV5,
  rowSupplyShock: amountsV5, // AR(1), multiplicative
  embargoes: z.array(EmbargoV5Schema),
});
export type MarketV5 = z.infer<typeof MarketV5Schema>;

export const EconomyStateV5Schema = z.object({
  market: MarketV5Schema,
  nations: z.record(z.string(), NationEconomyV5Schema),
});
export type EconomyStateV5 = z.infer<typeof EconomyStateV5Schema>;

export const PoliticsStateV5Schema = z.object({
  nations: z.record(z.string(), NationPoliticsV5Schema),
  // True when the player's nation is run by the AI fiscal rule (headless).
  autopilot: z.boolean(),
  // The player's objectives and free-text notes (J4).
  player: z.object({
    objectives: z.array(PinnedObjectiveV5Schema),
    notes: z.array(z.object({ date: IsoDateSchema, text: z.string() })),
  }),
});
export type PoliticsStateV5 = z.infer<typeof PoliticsStateV5Schema>;

// --- diplomacy (J3a) ---------------------------------------------------------

export const PeaceTermsV5Schema = z.object({
  // ceasefire: everyone keeps what it holds, no transfer; cession: the tiles
  // the winner holds stay with it, tagged contested; annexation: every tile
  // of the loser goes to the winner, the loser is exiled.
  kind: z.enum(["ceasefire", "cession", "annexation"]),
  reparationsPctGdp: zb.float(), // of the payer's GDP, per year
  reparationYears: zb.uint(),
  maxDivisions: zb.uint().nullable(), // demilitarisation of the loser
});
export type PeaceTermsV5 = z.infer<typeof PeaceTermsV5Schema>;

export const PeaceOfferV5Schema = z.object({
  id: zb.uint(),
  war: z.string(),
  from: NationIdSchema,
  to: NationIdSchema,
  terms: PeaceTermsV5Schema,
  date: IsoDateSchema,
});
export type PeaceOfferV5 = z.infer<typeof PeaceOfferV5Schema>;

export const WarV5Schema = z.object({
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
  offers: z.array(PeaceOfferV5Schema),
});
export type WarV5 = z.infer<typeof WarV5Schema>;

export const SanctionV5Schema = z.object({
  by: NationIdSchema,
  against: NationIdSchema,
  since: IsoDateSchema,
});
export type SanctionV5 = z.infer<typeof SanctionV5Schema>;

export const DiplomacyStateV5Schema = z.object({
  // relations[a][b] for a < b (ids compared as strings), in [-100, 100].
  relations: z.record(z.string(), z.record(z.string(), zb.float())),
  wars: z.array(WarV5Schema),
  sanctions: z.array(SanctionV5Schema),
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
  // Regions created by cessions, claimed by the loser.
  contestedRegions: z.array(
    z.object({
      region: z.string(),
      controller: NationIdSchema,
      claimants: z.array(NationIdSchema),
      tiles: zb.uint(),
    }),
  ),
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
export type DiplomacyStateV5 = z.infer<typeof DiplomacyStateV5Schema>;

// --- military (J3a) ----------------------------------------------------------

export const DivisionV5Schema = z.object({
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
export type DivisionV5 = z.infer<typeof DivisionV5Schema>;

export const NationMilitaryV5Schema = z.object({
  conscription: z.enum(["peace", "partial", "total"]),
  manpower: zb.float(), // men available in the pool
  divisions: z.array(DivisionV5Schema),
  nextDivisionId: zb.uint(),
  exhaustion: zb.float(), // 0..1
  training: zb.float(), // of new divisions
  losses: zb.float(), // men, cumulative
  lossesLastMonth: zb.float(),
  // Air and naval power of the sheet, scaled by the arms coverage in play.
  airPower: zb.float(),
  navalPower: zb.float(),
});
export type NationMilitaryV5 = z.infer<typeof NationMilitaryV5Schema>;

export const MilitaryStateV5Schema = z.object({
  nations: z.record(z.string(), NationMilitaryV5Schema),
});
export type MilitaryStateV5 = z.infer<typeof MilitaryStateV5Schema>;

// --- navy (J3b) ------------------------------------------------------------------

export const NavalStateV5Schema = z.object({
  // Where each nation projects its naval power: zone -> share (sum <= 1).
  // Empty = spread over its own coastal zones.
  deployments: z.record(z.string(), z.record(z.string(), zb.float())),
  // Last computed control of each zone: nation -> share of the presence.
  control: z.record(z.string(), z.record(z.string(), zb.float())),
  // Last computed blockade of each nation: share of the enemy control of
  // its coastal zones, 0..1.
  blockade: z.record(z.string(), zb.float()),
});
export type NavalStateV5 = z.infer<typeof NavalStateV5Schema>;

// --- nuclear weapons (J5) -------------------------------------------------------

export const NationNuclearV5Schema = z.object({
  doctrine: NuclearDoctrineSchema,
  warheads: zb.uint(),
  threat: zb.uint(), // 0 to 3, today
  shots: zb.uint(), // warheads fired in the campaign
});
export type NationNuclearV5 = z.infer<typeof NationNuclearV5Schema>;

export const NuclearStrikeV5Schema = z.object({
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
export type NuclearStrikeV5 = z.infer<typeof NuclearStrikeV5Schema>;

export const NuclearStateV5Schema = z.object({
  // Nuclear powers only.
  nations: z.record(z.string(), NationNuclearV5Schema),
  strikes: z.array(NuclearStrikeV5Schema),
  nextStrikeId: zb.uint(),
  // What fallout left of each nation hit: production, GDP and population
  // factor (1 = untouched), no reconstruction before the J7.
  fallout: z.record(z.string(), zb.float()),
});
export type NuclearStateV5 = z.infer<typeof NuclearStateV5Schema>;

// --- the AI of the nations (J5) ---------------------------------------------------

export const NationAiV5Schema = z.object({
  nextReview: IsoDateSchema,
  defenseGoal: zb.float(), // share of GDP it aims at
  lastWar: IsoDateSchema.nullable(), // last war it declared
  lastLanding: IsoDateSchema.nullable(),
  blockading: NationIdSchema.nullable(),
});
export type NationAiV5 = z.infer<typeof NationAiV5Schema>;

export const AiStateV5Schema = z.object({
  // Index of the next nation of the staggered review.
  cursor: zb.uint(),
  nations: z.record(z.string(), NationAiV5Schema),
  // Arms sent this month: index points of the good "arms".
  armsAid: z.array(
    z.object({ from: NationIdSchema, to: NationIdSchema, points: zb.float() }),
  ),
});
export type AiStateV5 = z.infer<typeof AiStateV5Schema>;

// --- blocs, layers 2 and 3 (J5) ------------------------------------------------

// The measures a bloc leader proposes; each falls in a decision domain of
// the bloc (sim/blocs/blocs.ts, MEASURE_DOMAIN).
export const BLOC_MEASURES_V5 = [
  "sanctions",
  "lift",
  "accession",
  "suspension",
  "budget",
  "common-defense",
  "tech-program",
  "trade-agreement",
] as const;
export const BlocMeasureV5Schema = z.enum(BLOC_MEASURES_V5);
export type BlocMeasureV5 = z.infer<typeof BlocMeasureV5Schema>;

export const BlocVoteV5Schema = z.enum(["yes", "no", "abstain"]);
export type BlocVoteV5 = z.infer<typeof BlocVoteV5Schema>;

export const BlocProposalV5Schema = z.object({
  id: zb.uint(),
  bloc: z.string(),
  by: NationIdSchema,
  kind: BlocMeasureV5Schema,
  // The nation the measure is about (sanctions, lift, accession,
  // suspension, trade agreement); null for the measures of the bloc itself.
  target: NationIdSchema.nullable(),
  direction: z.enum(["up", "down"]).nullable(), // budget only
  date: IsoDateSchema,
  resolveOn: IsoDateSchema,
  // Votes cast by the player; the AI votes when the proposal resolves.
  cast: z.record(z.string(), BlocVoteV5Schema),
  result: z.enum(["pending", "adopted", "rejected"]),
  votes: z.record(z.string(), BlocVoteV5Schema), // at resolution
});
export type BlocProposalV5 = z.infer<typeof BlocProposalV5Schema>;

export const BlocStateV5Schema = z.object({
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
export type BlocStateV5 = z.infer<typeof BlocStateV5Schema>;

export const BlocsStateV5Schema = z.object({
  blocs: z.array(BlocStateV5Schema),
  // Pending proposals and those resolved in the last months.
  proposals: z.array(BlocProposalV5Schema),
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
export type BlocsStateV5 = z.infer<typeof BlocsStateV5Schema>;

// --- technology (J5) ----------------------------------------------------------

export const TechProjectV5Schema = z.object({
  node: z.string(),
  points: zb.float(),
  since: IsoDateSchema,
});
export const NationTechV5Schema = z.object({
  // Nodes researched, in order; `baseline`: those it had on the first day
  // (their effects are in the data of 2026, not applied again).
  done: z.array(z.string()),
  baseline: z.array(z.string()),
  projects: z.array(TechProjectV5Schema), // at most config.tech.maxProjects
  pointsLastMonth: zb.float(),
});
export type NationTechV5 = z.infer<typeof NationTechV5Schema>;
export const TechStateV5Schema = z.object({
  nations: z.record(z.string(), NationTechV5Schema),
});
export type TechStateV5 = z.infer<typeof TechStateV5Schema>;

// --- events (J5) -----------------------------------------------------------------

export const EventInstanceV5Schema = z.object({
  id: zb.uint(),
  event: z.string(),
  nation: NationIdSchema, // the subject (the player for a world event)
  other: NationIdSchema.nullable(),
  good: z.string().nullable(),
  date: IsoDateSchema,
});
export type EventInstanceV5 = z.infer<typeof EventInstanceV5Schema>;
export const EventsStateV5Schema = z.object({
  nextId: zb.uint(),
  // Pop-ups waiting for the player's choice; unanswered, the government
  // decides at `deadline`.
  pending: z.array(EventInstanceV5Schema.extend({ deadline: IsoDateSchema })),
  // Events that happened, with the choice (the Events screen keeps the last
  // ones; the journal keeps them all).
  history: z.array(EventInstanceV5Schema.extend({ choice: z.string() })),
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
export type EventsStateV5 = z.infer<typeof EventsStateV5Schema>;

// --- territory (J5) -----------------------------------------------------------

export const TerritoryStateV5Schema = z.object({
  // Tiles of each nation on the first day of the campaign (nuclear threat:
  // share of the territory lost).
  initialTiles: z.record(z.string(), zb.uint()),
  // Structures each nation has built on the map (levels summed, by OpenFront
  // unit type) at the last monthly count, and what the new ones cost its
  // budget that month (US$).
  structures: z.record(z.string(), z.record(z.string(), zb.uint())),
  constructionCost: z.record(z.string(), zb.float()),
});
export type TerritoryStateV5 = z.infer<typeof TerritoryStateV5Schema>;

export const SaveHeaderV5Schema = zb.object({
  schemaVersion: z.literal(5),
  seed: zb.uint(),
  rngState: z.tuple([zb.uint(), zb.uint(), zb.uint(), zb.uint()]),
  calendar: CalendarSchema,
  nations: z.array(NationStateSchema),
  blocs: BlocsStateV5Schema,
  world: WorldStateSchema,
  economy: EconomyStateV5Schema,
  politics: PoliticsStateV5Schema,
  diplomacy: DiplomacyStateV5Schema,
  military: MilitaryStateV5Schema,
  naval: NavalStateV5Schema,
  territory: TerritoryStateV5Schema,
  nuclear: NuclearStateV5Schema,
  ai: AiStateV5Schema,
  tech: TechStateV5Schema,
  events: EventsStateV5Schema,
  journal: z.array(JournalEntryV5Schema),
  metrics: z.record(z.string(), zb.float()),
  tilesInfo: z.object({ width: zb.uint(), height: zb.uint() }),
});
export type SaveHeaderV5 = z.infer<typeof SaveHeaderV5Schema>;
// The tile grid, and since v5 the contest of each tile (a second block of
// the .vsave container).
export type SaveFileV5 = SaveHeaderV5 & {
  tiles: Uint16Array;
  contest: Uint16Array;
};
