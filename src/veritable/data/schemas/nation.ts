import { z } from "zod";
import {
  ContestedRegionSchema,
  INTEREST_GROUPS,
  NationIdSchema,
  NuclearDoctrineSchema,
  RegimeSchema,
  SourcedNumberSchema,
  TileCoordSchema,
} from "./common";

// Shape of data/veritable/nations/<iso3>.json.

export const TerritorySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tiles") }),
  z.object({ kind: z.literal("microstate"), hostTile: TileCoordSchema }),
]);
export type Territory = z.infer<typeof TerritorySchema>;

const InterestGroupsSchema = z.object(
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

const ProvenanceSchema = z.object({
  source: z.string().min(1),
  asOf: z.string().min(1),
  note: z.string().optional(),
});

// The capital is geographic data (lon/lat): its tile depends on the map and is
// computed by tools/veritable/borders (borders/<scenario>.meta.json).
const CapitalSchema = z.object({
  name: z.string().min(1), // i18n key
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  source: z.string().min(1),
  asOf: z.string().min(1),
});

// J1 -> J2: the sourced figures (population, gdp, debtToGdp, production,
// military, startingTech, interestGroups, aiAgenda, nuclear) are OPTIONAL
// until the J2 ingestion fills the sheets; they become mandatory again then
// (DECISIONS.md, 2026-09-21).
export const NationDataSchema = z.object({
  id: NationIdSchema,
  name: z.string().min(1), // i18n key
  capital: CapitalSchema,
  regime: RegimeSchema,
  regimeSource: ProvenanceSchema,
  blocs: z.array(z.string()),
  nuclear: z
    .object({
      warheads: z.number().int().nonnegative(),
      doctrine: NuclearDoctrineSchema,
    })
    .nullable()
    .optional(),
  territory: TerritorySchema,
  contested: z.array(ContestedRegionSchema),
  population: SourcedNumberSchema.optional(),
  gdp: SourcedNumberSchema.optional(),
  debtToGdp: SourcedNumberSchema.optional(),
  production: z.record(z.string(), z.number().nonnegative()).optional(),
  military: z
    .object({
      spendingPctGdp: z.number().nonnegative(),
      activePersonnel: z.number().int().nonnegative(),
      airPower: z.number().min(0).max(1),
      navalPower: z.number().min(0).max(1),
      source: z.string().min(1),
      asOf: z.string().min(1),
    })
    .optional(),
  startingTech: z.array(z.string()).optional(),
  interestGroups: InterestGroupsSchema.optional(),
  aiAgenda: z
    .array(
      z.object({ goal: z.enum(AI_GOALS), weight: z.number().min(0).max(1) }),
    )
    .optional(),
});
export type NationData = z.infer<typeof NationDataSchema>;
