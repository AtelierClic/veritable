import { z } from "zod";
import { zb } from "../../../../zbin";
import { IsoDateSchema, NationIdSchema } from "./common";
import { CalendarSchema, NationStateSchema, WorldStateSchema } from "./saveV1";

// Save file, CURRENT version: schemaVersion 2 (J2: economy and politics).
//
// zbin has no version byte and no field tags: the schema IS the format. Once
// a save of this version exists in the wild, any change of shape means a new
// version: freeze this file as saveV2.ts, write the new one here, and add
// migrations/v2-to-v3.ts (ARCHITECTURE.md, invariant 2).
//
// Pieces imported from saveV1.ts are unchanged since v1; saveV1.ts is frozen,
// so a piece that must change is redefined here, never edited there.

export const SAVE_SCHEMA_VERSION = 2;

export * from "./saveV1";

export const JOURNAL_KINDS_V2 = [
  "campaign-started",
  "nation-status",
  "unrest-started",
  "unrest-ended",
  "austerity-started",
  "austerity-ended",
  "sovereign-default",
  "bloc-reprimand",
] as const;
export const JournalEntryV2Schema = z.object({
  date: IsoDateSchema,
  kind: z.enum(JOURNAL_KINDS_V2),
  nation: NationIdSchema.optional(),
  params: z.record(z.string(), z.string()),
});
export type JournalEntryV2 = z.infer<typeof JournalEntryV2Schema>;

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
});
export type NationPolitics = z.infer<typeof NationPoliticsSchema>;

export const EmbargoSchema = z.object({
  from: z.string(), // exporter
  to: z.string(), // importer (a nation or ROW)
  good: z.string(),
});
export type Embargo = z.infer<typeof EmbargoSchema>;

export const MarketSchema = z.object({
  prices: amounts,
  // Volume a good's embargoes keep off the market, annualised: it leaves the
  // supply that forms the price.
  stranded: amounts,
  rowProduction: amounts,
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

export const SaveHeaderV2Schema = zb.object({
  schemaVersion: z.literal(2),
  seed: zb.uint(),
  rngState: z.tuple([zb.uint(), zb.uint(), zb.uint(), zb.uint()]),
  calendar: CalendarSchema,
  nations: z.array(NationStateSchema),
  blocs: z.array(z.object({ id: z.string() })),
  world: WorldStateSchema,
  economy: EconomyStateSchema,
  politics: PoliticsStateSchema,
  journal: z.array(JournalEntryV2Schema),
  metrics: z.record(z.string(), zb.float()),
  tilesInfo: z.object({ width: zb.uint(), height: zb.uint() }),
});
export type SaveHeaderV2 = z.infer<typeof SaveHeaderV2Schema>;
export type SaveFileV2 = SaveHeaderV2 & { tiles: Uint16Array };

// Current version aliases: the rest of the code only uses these.
export const SaveHeaderSchema = SaveHeaderV2Schema;
export type SaveFile = SaveFileV2;
export type JournalEntry = JournalEntryV2;
export const JOURNAL_KINDS = JOURNAL_KINDS_V2;
