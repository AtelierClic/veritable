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

export const NationDataSchema = z.object({
  id: NationIdSchema,
  name: z.string().min(1), // i18n key
  capital: z.object({ tileHint: TileCoordSchema }),
  regime: RegimeSchema,
  blocs: z.array(z.string()),
  nuclear: z
    .object({
      warheads: z.number().int().nonnegative(),
      doctrine: NuclearDoctrineSchema,
    })
    .nullable(),
  territory: TerritorySchema,
  contested: z.array(ContestedRegionSchema),
  population: SourcedNumberSchema,
  gdp: SourcedNumberSchema,
  debtToGdp: SourcedNumberSchema,
  production: z.record(z.string(), z.number().nonnegative()),
  military: z.object({
    spendingPctGdp: z.number().nonnegative(),
    activePersonnel: z.number().int().nonnegative(),
    airPower: z.number().min(0).max(1),
    navalPower: z.number().min(0).max(1),
    source: z.string().min(1),
    asOf: z.string().min(1),
  }),
  startingTech: z.array(z.string()),
  interestGroups: InterestGroupsSchema,
  aiAgenda: z.array(
    z.object({ goal: z.enum(AI_GOALS), weight: z.number().min(0).max(1) }),
  ),
});
export type NationData = z.infer<typeof NationDataSchema>;
