import { z } from "zod";
import { zb } from "../../../../zbin";
import { IsoDateSchema, NationIdSchema } from "./common";
import { CalendarSchema, NationStateSchema, WorldStateSchema } from "./saveV1";

// Save file, CURRENT version: schemaVersion 3 (J3: exports in the growth,
// deferred substitution of the rest of the world, regional premium, revised
// EU rule, diplomacy, land war, navy, air).
//
// zbin has no version byte and no field tags: the schema IS the format. Once
// a save of this version exists in the wild, any change of shape means a new
// version: freeze this file as saveV3.ts, write the new one here, and add
// migrations/v3-to-v4.ts (ARCHITECTURE.md, invariant 2).
//
// Pieces imported from saveV1.ts / saveV2.ts are unchanged since then; those
// files are frozen, so a piece that must change is redefined here, never
// edited there.

export const SAVE_SCHEMA_VERSION = 3;

export * from "./saveV1";

export const JOURNAL_KINDS_V3 = [
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
] as const;
export const JournalEntryV3Schema = z.object({
  date: IsoDateSchema,
  kind: z.enum(JOURNAL_KINDS_V3),
  nation: NationIdSchema.optional(),
  params: z.record(z.string(), z.string()),
});
export type JournalEntryV3 = z.infer<typeof JournalEntryV3Schema>;

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
  taxes: amounts,
  taxes0: amounts,
  spending: amounts, // shares of GDP
  spending0: amounts,
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
});
export type NationEconomy = z.infer<typeof NationEconomySchema>;

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
});
export type NationPolitics = z.infer<typeof NationPoliticsSchema>;

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
  // taken since the start.
  score: z.record(z.string(), zb.float()),
  retreatMonths: z.record(z.string(), zb.uint()),
  tilesTaken: z.record(z.string(), zb.uint()),
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

export const SaveHeaderV3Schema = zb.object({
  schemaVersion: z.literal(3),
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
  journal: z.array(JournalEntryV3Schema),
  metrics: z.record(z.string(), zb.float()),
  tilesInfo: z.object({ width: zb.uint(), height: zb.uint() }),
});
export type SaveHeaderV3 = z.infer<typeof SaveHeaderV3Schema>;
export type SaveFileV3 = SaveHeaderV3 & { tiles: Uint16Array };

// Current version aliases: the rest of the code only uses these.
export const SaveHeaderSchema = SaveHeaderV3Schema;
export type SaveFile = SaveFileV3;
export type JournalEntry = JournalEntryV3;
export const JOURNAL_KINDS = JOURNAL_KINDS_V3;
