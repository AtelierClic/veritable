import { z } from "zod";
import {
  ContestedRegionSchema,
  INTEREST_GROUPS,
  IsoDateSchema,
  NationIdSchema,
  NuclearDoctrineSchema,
  RegimeSchema,
  SourcedNumberSchema,
  TileCoordSchema,
} from "./common";
import { GOOD_IDS, ProvenanceSchema } from "./goods";
import { NationPoliticsDataSchema } from "./politics";

// Shape of data/veritable/nations/<iso3>.json.

export const TerritorySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tiles") }),
  z.object({ kind: z.literal("microstate"), hostTile: TileCoordSchema }),
]);
export type Territory = z.infer<typeof TerritorySchema>;

export const InterestGroupsSchema = z.object(
  Object.fromEntries(
    INTEREST_GROUPS.map((g) => [g, z.number().min(0).max(1)]),
  ) as Record<(typeof INTEREST_GROUPS)[number], z.ZodNumber>,
);

export const AI_GOALS = [
  "security",
  "growth",
  "regional-influence",
  "ideology",
] as const;

// The capital is geographic data (lon/lat): its tile depends on the map and is
// computed by tools/veritable/borders (borders/<scenario>.meta.json).
const CapitalSchema = z.object({
  name: z.string().min(1), // i18n key
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  source: z.string().min(1),
  asOf: z.string().min(1),
});

export const TAX_IDS = [
  "income",
  "corporate",
  "vat",
  "tariffs",
  "rents",
] as const;
export type TaxId = (typeof TAX_IDS)[number];

export const SPENDING_POSTS = [
  "defense",
  "social",
  "healthEducation",
  "research",
  "infrastructure",
  "subsidies",
] as const;
export type SpendingPost = (typeof SPENDING_POSTS)[number];

function record<K extends string, T extends z.ZodTypeAny>(
  keys: readonly K[],
  value: T,
) {
  return z.object(
    Object.fromEntries(keys.map((k) => [k, value])) as Record<K, T>,
  );
}

// Economy of a nation on the first day. Quantities per year, in the unit of
// the good (goods.json). Everything is sourced; `source: "estimate"` marks
// what has no open source.
export const NationEconomySchema = z.object({
  // Trade (exports + imports) as a share of GDP: what sanctions bite into.
  tradeOpenness: SourcedNumberSchema,
  growthBase: SourcedNumberSchema, // trend real growth per year
  goods: record(
    GOOD_IDS,
    z.object({
      production: SourcedNumberSchema,
      consumption: SourcedNumberSchema,
    }),
  ),
  // TWh of electricity generated from each fossil fuel: that share of the
  // electricity production depends on the coverage of the fuel.
  electricityFromFossil: z.object({
    gas: SourcedNumberSchema,
    coal: SourcedNumberSchema,
    oil: SourcedNumberSchema,
  }),
  budget: z.object({
    revenuePctGdp: SourcedNumberSchema,
    expensePctGdp: SourcedNumberSchema,
    grantsPctGdp: SourcedNumberSchema,
    // J6b, the debt of the first day: interest paid (share of GDP, already
    // out of the programmes) and inflation, which make the real interest
    // rate of the first day. Without them (test sheets), the rate of the J2.
    interestPctGdp: SourcedNumberSchema.optional(),
    inflation: SourcedNumberSchema.optional(),
    // A nation already in default on 1 January 2026: it cannot borrow.
    inDefault: z
      .object({
        since: IsoDateSchema,
        source: z.string().min(1),
        asOf: z.string().min(1),
        note: z.string().optional(),
      })
      .optional(),
    revenueShares: z.object({
      value: record(TAX_IDS, z.number().min(0).max(1)),
      source: z.string().min(1),
      asOf: z.string().min(1),
      note: z.string().optional(),
    }),
    spending: record(SPENDING_POSTS, SourcedNumberSchema),
  }),
});
export type NationEconomyData = z.infer<typeof NationEconomySchema>;

// J6c: the region and subregion of the world (UN M49, slugs; the labels are
// i18n keys world-region.<slug>): filters of the screens, spread of the wars.
export const GeographySchema = z.object({
  region: z.string().min(1),
  subregion: z.string().min(1),
  source: z.string().min(1),
  asOf: z.string().min(1),
});

// The sourced figures were optional during J1; since the J2 ingestion they are
// mandatory again. Still optional by design: `interestGroups` (an override of
// the default weights of config.json) and `aiAgenda` (J5).
export const NationDataSchema = z.object({
  id: NationIdSchema,
  name: z.string().min(1), // i18n key
  capital: CapitalSchema,
  // J6c; optional for the test sheets.
  geography: GeographySchema.optional(),
  regime: RegimeSchema,
  regimeSource: ProvenanceSchema,
  blocs: z.array(z.string()),
  nuclear: z
    .object({
      warheads: z.number().int().nonnegative(),
      doctrine: NuclearDoctrineSchema,
      source: z.string().min(1),
      asOf: z.string().min(1),
      note: z.string().optional(),
    })
    .nullable(),
  territory: TerritorySchema,
  contested: z.array(ContestedRegionSchema),
  // A de facto entity (J6b): the nations that recognise it as a state.
  recognition: z
    .object({
      recognizedBy: z.array(NationIdSchema),
      note: z.string(),
      source: z.string().min(1),
      asOf: z.string().min(1),
    })
    .optional(),
  population: SourcedNumberSchema,
  gdp: SourcedNumberSchema, // current US$
  debtToGdp: SourcedNumberSchema,
  economy: NationEconomySchema,
  military: z.object({
    spendingPctGdp: z.number().nonnegative(),
    activePersonnel: z.number().int().nonnegative(),
    airPower: z.number().min(0).max(1),
    navalPower: z.number().min(0).max(1),
    source: z.string().min(1),
    asOf: z.string().min(1),
    note: z.string().optional(),
  }),
  startingTech: z.array(z.string()),
  // Elections (J4): interval, last real election, suspension at war at home,
  // ideology of the groups (override of config.json).
  politics: NationPoliticsDataSchema,
  interestGroups: InterestGroupsSchema.optional(),
  aiAgenda: z
    .array(
      z.object({ goal: z.enum(AI_GOALS), weight: z.number().min(0).max(1) }),
    )
    .optional(),
});
export type NationData = z.infer<typeof NationDataSchema>;
