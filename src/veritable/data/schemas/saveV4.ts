import { z } from "zod";
import { zb } from "../../../../zbin";
import { IsoDateSchema, NationIdSchema, RegimeSchema } from "./common";
import { ActorRoleSchema } from "./leaders";
import {
  CalendarSchema,
  NationNameSchema,
  NationStateSchema,
  WorldStateSchema,
} from "./saveV1";

// Save file, version 4 (J4: circumvention per good, the political engine —
// regimes, leaders, parties, elections, laws, political capital,
// legitimacy, coups, objectives, notes). FROZEN: a v4 file can only be
// decoded by this schema, forever. The current version is save.ts.
//
// Pieces imported from saveV1.ts are unchanged since v1.

export const JOURNAL_KINDS_V4 = [
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
] as const;
export const JournalEntryV4Schema = z.object({
  date: IsoDateSchema,
  kind: z.enum(JOURNAL_KINDS_V4),
  nation: NationIdSchema.optional(),
  params: z.record(z.string(), z.string()),
});
export type JournalEntryV4 = z.infer<typeof JournalEntryV4Schema>;

// Quantities keyed by good, tax, spending post or interest group. Key order
// is part of the bytes: records are always built in the order of the ids.
const amounts = z.record(z.string(), zb.float());

// Economy of one nation. Quantities per year in the unit of the good; money
// in US$. Sliders (taxes, spending) are the player's or the AI's settings;
// the `0` variants are the values of the first day, the reference of the
// political drivers and of the AI fiscal rule.
export const NationEconomyV4Schema = z.object({
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
export type NationEconomyV4 = z.infer<typeof NationEconomyV4Schema>;

// --- the political engine (J4) --------------------------------------------

// Wire versions of the ideology and traits of politics.ts / leaders.ts (zbin
// wants explicit number encodings).
export const IdeologyWireV4Schema = z.object({
  economic: zb.float(),
  authority: zb.float(),
  sovereignty: zb.float(),
});
export const TraitsWireV4Schema = IdeologyWireV4Schema.extend({
  aggressiveness: zb.float(),
  corruption: zb.float(),
  charisma: zb.float(),
  competence: zb.float(),
});

// A political actor in play: the leader of the nation or of a party. Real
// ones carry an i18n key (parody or fictional name, per config), generated
// ones a literal name drawn from the name pools.
export const ActorStateV4Schema = z.object({
  id: z.string().min(1),
  name: NationNameSchema,
  born: IsoDateSchema,
  party: z.string().nullable(),
  role: ActorRoleSchema,
  traits: TraitsWireV4Schema,
});
export type ActorStateV4 = z.infer<typeof ActorStateV4Schema>;

export const PartyStateV4Schema = z.object({
  id: z.string().min(1),
  name: NationNameSchema,
  ideology: IdeologyWireV4Schema,
  support: zb.float(), // share at the last election
  leader: ActorStateV4Schema,
});
export type PartyStateV4 = z.infer<typeof PartyStateV4Schema>;

export const ElectionResultV4Schema = z.object({
  date: IsoDateSchema,
  results: amounts, // party -> share
  incumbentShare: zb.float(),
  alternation: z.boolean(),
  fraudDetected: z.boolean(),
});
export type ElectionResultV4 = z.infer<typeof ElectionResultV4Schema>;

export const NationPoliticsV4Schema = z.object({
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
  leader: ActorStateV4Schema,
  parties: z.array(PartyStateV4Schema),
  government: z.object({
    parties: z.array(z.string()),
    since: IsoDateSchema,
    ideology: IdeologyWireV4Schema,
  }),
  nextElection: IsoDateSchema.nullable(),
  lastElection: ElectionResultV4Schema.nullable(),
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
  groupIdeologies: z.record(z.string(), IdeologyWireV4Schema),
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
export type NationPoliticsV4 = z.infer<typeof NationPoliticsV4Schema>;

export const PinnedObjectiveV4Schema = z.object({
  id: z.string().min(1),
  since: IsoDateSchema,
  baseline: zb.float(), // value of the tracked quantity when pinned
  progress: zb.float(), // 0..1
  done: z.boolean(),
});
export type PinnedObjectiveV4 = z.infer<typeof PinnedObjectiveV4Schema>;

export const EmbargoV4Schema = z.object({
  from: z.string(), // exporter
  to: z.string(), // importer (a nation or ROW)
  good: z.string(),
});
export type EmbargoV4 = z.infer<typeof EmbargoV4Schema>;

export const MarketV4Schema = z.object({
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
  embargoes: z.array(EmbargoV4Schema),
});
export type MarketV4 = z.infer<typeof MarketV4Schema>;

export const EconomyStateV4Schema = z.object({
  market: MarketV4Schema,
  nations: z.record(z.string(), NationEconomyV4Schema),
});
export type EconomyStateV4 = z.infer<typeof EconomyStateV4Schema>;

export const PoliticsStateV4Schema = z.object({
  nations: z.record(z.string(), NationPoliticsV4Schema),
  // True when the player's nation is run by the AI fiscal rule (headless).
  autopilot: z.boolean(),
  // The player's objectives and free-text notes (J4).
  player: z.object({
    objectives: z.array(PinnedObjectiveV4Schema),
    notes: z.array(z.object({ date: IsoDateSchema, text: z.string() })),
  }),
});
export type PoliticsStateV4 = z.infer<typeof PoliticsStateV4Schema>;

// --- diplomacy (J3a) ---------------------------------------------------------

export const PeaceTermsV4Schema = z.object({
  // ceasefire: everyone keeps what it holds, no transfer; cession: the tiles
  // the winner holds stay with it, tagged contested; annexation: every tile
  // of the loser goes to the winner, the loser is exiled.
  kind: z.enum(["ceasefire", "cession", "annexation"]),
  reparationsPctGdp: zb.float(), // of the payer's GDP, per year
  reparationYears: zb.uint(),
  maxDivisions: zb.uint().nullable(), // demilitarisation of the loser
});
export type PeaceTermsV4 = z.infer<typeof PeaceTermsV4Schema>;

export const PeaceOfferV4Schema = z.object({
  id: zb.uint(),
  war: z.string(),
  from: NationIdSchema,
  to: NationIdSchema,
  terms: PeaceTermsV4Schema,
  date: IsoDateSchema,
});
export type PeaceOfferV4 = z.infer<typeof PeaceOfferV4Schema>;

export const WarV4Schema = z.object({
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
  offers: z.array(PeaceOfferV4Schema),
});
export type WarV4 = z.infer<typeof WarV4Schema>;

export const SanctionV4Schema = z.object({
  by: NationIdSchema,
  against: NationIdSchema,
  since: IsoDateSchema,
});
export type SanctionV4 = z.infer<typeof SanctionV4Schema>;

export const DiplomacyStateV4Schema = z.object({
  // relations[a][b] for a < b (ids compared as strings), in [-100, 100].
  relations: z.record(z.string(), z.record(z.string(), zb.float())),
  wars: z.array(WarV4Schema),
  sanctions: z.array(SanctionV4Schema),
  // Coalition calls open against an aggressor: months left to answer.
  coalitionCalls: z.array(
    z.object({
      war: z.string(),
      nation: NationIdSchema,
      monthsLeft: zb.uint(),
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
export type DiplomacyStateV4 = z.infer<typeof DiplomacyStateV4Schema>;

// --- military (J3a) ----------------------------------------------------------

export const DivisionV4Schema = z.object({
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
export type DivisionV4 = z.infer<typeof DivisionV4Schema>;

export const NationMilitaryV4Schema = z.object({
  conscription: z.enum(["peace", "partial", "total"]),
  manpower: zb.float(), // men available in the pool
  divisions: z.array(DivisionV4Schema),
  nextDivisionId: zb.uint(),
  exhaustion: zb.float(), // 0..1
  training: zb.float(), // of new divisions
  losses: zb.float(), // men, cumulative
  lossesLastMonth: zb.float(),
  // Air and naval power of the sheet, scaled by the arms coverage in play.
  airPower: zb.float(),
  navalPower: zb.float(),
});
export type NationMilitaryV4 = z.infer<typeof NationMilitaryV4Schema>;

export const MilitaryStateV4Schema = z.object({
  nations: z.record(z.string(), NationMilitaryV4Schema),
});
export type MilitaryStateV4 = z.infer<typeof MilitaryStateV4Schema>;

// --- navy (J3b) ------------------------------------------------------------------

export const NavalStateV4Schema = z.object({
  // Where each nation projects its naval power: zone -> share (sum <= 1).
  // Empty = spread over its own coastal zones.
  deployments: z.record(z.string(), z.record(z.string(), zb.float())),
  // Last computed control of each zone: nation -> share of the presence.
  control: z.record(z.string(), z.record(z.string(), zb.float())),
  // Last computed blockade of each nation: share of the enemy control of
  // its coastal zones, 0..1.
  blockade: z.record(z.string(), zb.float()),
});
export type NavalStateV4 = z.infer<typeof NavalStateV4Schema>;

export const SaveHeaderV4Schema = zb.object({
  schemaVersion: z.literal(4),
  seed: zb.uint(),
  rngState: z.tuple([zb.uint(), zb.uint(), zb.uint(), zb.uint()]),
  calendar: CalendarSchema,
  nations: z.array(NationStateSchema),
  blocs: z.array(z.object({ id: z.string() })),
  world: WorldStateSchema,
  economy: EconomyStateV4Schema,
  politics: PoliticsStateV4Schema,
  diplomacy: DiplomacyStateV4Schema,
  military: MilitaryStateV4Schema,
  naval: NavalStateV4Schema,
  journal: z.array(JournalEntryV4Schema),
  metrics: z.record(z.string(), zb.float()),
  tilesInfo: z.object({ width: zb.uint(), height: zb.uint() }),
});
export type SaveHeaderV4 = z.infer<typeof SaveHeaderV4Schema>;
export type SaveFileV4 = SaveHeaderV4 & { tiles: Uint16Array };
