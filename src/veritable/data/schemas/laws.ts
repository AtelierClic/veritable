import { z } from "zod";
import { INTEREST_GROUPS, RegimeSchema } from "./common";
import { SPENDING_POSTS, TAX_IDS } from "./nation";
import { LawDomainSchema } from "./politics";
import { CONSCRIPTION_LEVELS } from "./war";

// Shape of data/veritable/laws/<domain>.json: the law catalogue (J4).
//
// A law has an ideological window: the government must be inside it to
// enact the law, and a government outside it repeals the law after a delay.
// Effects apply once (at enactment) or while the law is in force.

export const LAW_EFFECT_TARGETS = [
  ...INTEREST_GROUPS.map((g) => `groups.${g}` as const),
  ...SPENDING_POSTS.map((p) => `spending.${p}` as const),
  ...TAX_IDS.map((t) => `taxes.${t}` as const),
  "growthBase",
  "legitimacy",
  "legitimacyBase",
  "relations.democracies",
  "mediaControl",
  "pressFreedom",
  "corruption",
  "coupRisk",
  "conscriptionCeiling",
  "manpowerBonus",
  "electionIntervalMonths",
  "regime",
  "capital",
] as const;
export const LawEffectTargetSchema = z.enum(LAW_EFFECT_TARGETS);
export type LawEffectTarget = z.infer<typeof LawEffectTargetSchema>;

export const LawEffectSchema = z.object({
  target: LawEffectTargetSchema,
  op: z.enum(["add", "set", "mul"]),
  value: z.union([z.number(), RegimeSchema, z.enum(CONSCRIPTION_LEVELS)]),
  mode: z.enum(["once", "while"]),
});
export type LawEffect = z.infer<typeof LawEffectSchema>;

const axisRange = z.tuple([
  z.number().min(-1).max(1),
  z.number().min(-1).max(1),
]);
export const LawWindowSchema = z.object({
  economic: axisRange,
  authority: axisRange,
  sovereignty: axisRange,
});
export type LawWindow = z.infer<typeof LawWindowSchema>;

export const LawSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1), // i18n key
  description: z.string().min(1), // i18n key
  domain: LawDomainSchema,
  capitalCost: z.number().min(0),
  // null: irreversible.
  reversible: z
    .object({ cost: z.number().min(0), delayMonths: z.number().int().min(0) })
    .nullable(),
  window: LawWindowSchema,
  regimes: z.array(RegimeSchema).min(1),
  effects: z.array(LawEffectSchema),
  // Constitutional reforms: legitimacy the government needs to pass them.
  requiresLegitimacy: z.number().min(0).max(1).optional(),
});
export type Law = z.infer<typeof LawSchema>;

export const LawsSchema = z.array(LawSchema);
