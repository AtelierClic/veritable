import { z } from "zod";

// Shared building blocks for every Véritable data schema.
// Reference: docs/veritable/DATA-SCHEMAS.md.

// ISO 3166-1 alpha-3 ("FRA") or a kebab-case slug for ad-hoc nations.
export const NationIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/);
export type NationId = z.infer<typeof NationIdSchema>;

export const REGIMES = [
  "parliamentary",
  "presidential",
  "semi-presidential",
  "electoral-authoritarian",
  "single-party",
  "absolute-monarchy",
  "junta",
  "theocracy",
  "failed-state",
] as const;
export const RegimeSchema = z.enum(REGIMES);
export type Regime = z.infer<typeof RegimeSchema>;

export const NUCLEAR_DOCTRINES = [
  "first-use-possible",
  "no-first-use",
  "undeclared",
  "unpredictable",
] as const;
export const NuclearDoctrineSchema = z.enum(NUCLEAR_DOCTRINES);

export const INTEREST_GROUPS = [
  "business",
  "workers",
  "farmers",
  "military",
  "religious",
  "youth",
  "retirees",
  "minorities",
] as const;

export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// A figure taken from a real-world source carries where and when it comes from.
export const SourcedNumberSchema = z.object({
  value: z.number(),
  // "worldbank:<indicator>", "owid-energy@<commit>:<column>", "derived"
  // (computed from sourced figures, method in `note`) or "estimate" (no open
  // source: justification in `note`, never a silent number).
  source: z.string().min(1),
  asOf: z.string().min(1),
  note: z.string().optional(),
});

export const TileCoordSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
]);

export const ContestedRegionSchema = z.object({
  region: z.string().min(1),
  controller: NationIdSchema,
  claimants: z.array(NationIdSchema),
  recognizedBy: z.array(NationIdSchema),
});
