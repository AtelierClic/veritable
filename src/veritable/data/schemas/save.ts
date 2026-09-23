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

// Save file, CURRENT version: schemaVersion 5 (J5: contest of each tile,
// territory, nuclear, nation AI, blocs, technology, events).
//
// zbin has no version byte and no field tags: the schema IS the format. Once
// a save of this version exists in the wild, any change of shape means a new
// version: freeze this file as saveV5.ts, write the new one here, and add
// migrations/v5-to-v6.ts (ARCHITECTURE.md, invariant 2).
//
// Pieces imported from saveV1.ts are unchanged since then; the frozen files
// (saveV1.ts to saveV4.ts) are never edited: a piece that must change is
// redefined here.

export const SAVE_SCHEMA_VERSION = 5;

export * from "./saveV1";

// Tile bit set on land taken by war or ceded at a peace (J3a); the nation
// index keeps its twelve bits and fallout its bit 13. Since v5 the contest
// block of the file says since when and how (sim/war/contest.ts); the bit is
// kept equal to "contest != 0".
export const TILE_CONTESTED_BIT = 1 << 12;

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
const amounts = z.record(z.string(), zb.float());

// Economy of one nation. Quantities per year in the unit of the good; money
// in US$. Sliders (taxes, spending) are the player's or the AI's settings;
// the `0` variants are the values of the first day, the reference of the
// political drivers and of the AI fiscal rule.
export const NationEconomySchema = z.object({
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
  // taken since the start, net tiles gained this month (reset monthly).
  score: z.record(z.string(), zb.float()),
  retreatMonths: z.record(z.string(), zb.uint()),
  tilesTaken: z.record(z.string(), zb.uint()),
  monthlyTiles: z.record(z.string(), zb.float()),
  offers: z.array(PeaceOfferSchema),
});
export type War = z.infer<typeof WarSchema>;

export const SanctionSchema = z.object({
  by: NationIdSchema,
  against: NationIdSchema,
  since: IsoDateSchema,
});
export type Sanction = z.infer<typeof SanctionSchema>;

export const DiplomacyStateSchema = z.object({
  // relations[a][b] for a < b (ids compared as strings), in [-100, 100].
  relations: z.record(z.string(), z.record(z.string(), zb.float())),
  wars: z.array(WarSchema),
  sanctions: z.array(SanctionSchema),
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
  lossesLastMonth: zb.float(),
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

export const SaveHeaderV5Schema = zb.object({
  schemaVersion: z.literal(5),
  seed: zb.uint(),
  rngState: z.tuple([zb.uint(), zb.uint(), zb.uint(), zb.uint()]),
  calendar: CalendarSchema,
  nations: z.array(NationStateSchema),
  blocs: z.array(z.object({ id: z.string() })),
  world: WorldStateSchema,
  economy: EconomyStateSchema,
  politics: PoliticsStateSchema,
  diplomacy: DiplomacyStateSchema,
  military: MilitaryStateSchema,
  naval: NavalStateSchema,
  territory: TerritoryStateSchema,
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

// Current version aliases: the rest of the code only uses these.
export const SaveHeaderSchema = SaveHeaderV5Schema;
export type SaveFile = SaveFileV5;
export type JournalEntry = JournalEntryV5;
export const JOURNAL_KINDS = JOURNAL_KINDS_V5;
