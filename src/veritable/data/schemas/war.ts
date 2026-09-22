import { z } from "zod";

// Shapes of data/veritable/war/*.json: the four division templates and the
// catalogue of casus belli. Balancing values live there, never in .ts files.

export const DIVISION_TEMPLATE_IDS = [
  "infantry",
  "mechanized",
  "armored",
  "artillery",
] as const;
export type DivisionTemplateId = (typeof DIVISION_TEMPLATE_IDS)[number];

export const DivisionTemplateSchema = z.object({
  id: z.enum(DIVISION_TEMPLATE_IDS),
  name: z.string().min(1), // i18n key
  attack: z.number().positive(),
  defense: z.number().positive(),
  men: z.number().int().positive(), // full strength
  // Arms (index points of the good "arms") a full re-equipment costs, in
  // units of config.war.armsIndexPerEquipmentUnit.
  arms: z.number().positive(),
});
export type DivisionTemplate = z.infer<typeof DivisionTemplateSchema>;
export const DivisionTemplatesSchema = z
  .array(DivisionTemplateSchema)
  .refine(
    (t) => new Set(t.map((d) => d.id)).size === DIVISION_TEMPLATE_IDS.length,
    {
      message: "every division template must appear exactly once",
    },
  );

export const CASUS_BELLI_CHECKS = [
  // The target controls a region the declarer claims (scenario or cession).
  "contested-territory",
  // The target is the aggressor of a war against a bloc-mate of the declarer.
  "ally-attacked",
  // The target is in unrest with a stability under the threshold.
  "humanitarian",
  // No pretext: the maximal international reaction.
  "none",
] as const;
export const CasusBelliSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1), // i18n key
  check: z.enum(CASUS_BELLI_CHECKS),
  // Relations lost with every nation, per month of war, before the power
  // multiplier.
  relationsCost: z.number().min(0),
});
export type CasusBelli = z.infer<typeof CasusBelliSchema>;
export const CasusBelliCatalogueSchema = z
  .array(CasusBelliSchema)
  .refine((c) => c.some((cb) => cb.check === "none"), {
    message: "the catalogue needs the entry without casus belli",
  });

export const POSTURES = ["defend", "attack", "breakthrough"] as const;
export type Posture = (typeof POSTURES)[number];

export const CONSCRIPTION_LEVELS = ["peace", "partial", "total"] as const;
export type ConscriptionLevel = (typeof CONSCRIPTION_LEVELS)[number];
