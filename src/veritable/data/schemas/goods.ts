import { z } from "zod";

// Shape of data/veritable/goods/goods.json: the goods of the economy.
// Quantities are per YEAR: real units where open data exists (TWh, Mt),
// otherwise an index where 100 = production of the scenario in 2026, with a
// basePrice in M$ per point so that every flow has a dollar value.

export const GOOD_IDS = [
  "oil",
  "gas",
  "coal",
  "electricity",
  "food",
  "critical-minerals",
  "steel",
  "consumer-goods",
  "electronics",
  "arms",
  "pharma",
  "services",
] as const;
export const GoodIdSchema = z.enum(GOOD_IDS);
export type GoodId = z.infer<typeof GoodIdSchema>;

export const FOSSIL_FUELS = ["gas", "coal", "oil"] as const;
export type FossilFuel = (typeof FOSSIL_FUELS)[number];

export const ProvenanceSchema = z.object({
  source: z.string().min(1),
  asOf: z.string().min(1),
  note: z.string().optional(),
});

export const GoodSchema = z.object({
  id: GoodIdSchema,
  name: z.string().min(1), // i18n key
  tier: z.number().int().min(1),
  unit: z.string().min(1),
  // normal: distance matters; neighbors-only: land neighbours (electricity);
  // free: distance ignored (services).
  transport: z.enum(["normal", "neighbors-only", "free"]),
  storable: z.boolean(),
  basePrice: z.number().positive(), // M$ per unit
  basePriceSource: ProvenanceSchema,
  epsilon: z.number().positive(), // price elasticity of demand
  eta: z.number().positive(), // price elasticity of supply
  shortageWeight: z.number().min(0).max(1),
  rent: z.boolean(), // resource: its production value is the base of rents
  industrial: z.boolean(), // its production suffers from electricity shortages
});
export type Good = z.infer<typeof GoodSchema>;

export const GoodsSchema = z
  .array(GoodSchema)
  .refine((goods) => new Set(goods.map((g) => g.id)).size === goods.length, {
    message: "duplicate good id",
  })
  .refine(
    (goods) =>
      Math.abs(goods.reduce((s, g) => s + g.shortageWeight, 0) - 1) < 1e-6,
    { message: "shortage weights must sum to 1" },
  );
