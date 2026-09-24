import { z } from "zod";
import { NationIdSchema } from "./common";
import { GOOD_IDS } from "./goods";

// Shape of data/veritable/tech/trunk.json and tech/branches/<bloc>.json (J5).
// A node is researched with monthly points (R&D spending), costs less the
// more nations already have it, and takes at least `monthsMin` months.

export const TECH_DOMAINS = [
  "energy",
  "industry",
  "agriculture",
  "digital",
  "health",
  "land",
  "naval",
  "air",
  "nuclear",
  "space",
] as const;
export const TechDomainSchema = z.enum(TECH_DOMAINS);
export type TechDomain = z.infer<typeof TechDomainSchema>;

// What a node changes, once researched:
//   production.<good>   mul  capacity of a good (applied once, kept)
//   consumption.<good>  mul  demand base of a good (efficiency; applied once)
//   growth              add  trend growth per year (e.g. 0.001 = +0.1 point)
//   military.land       mul  force of the divisions
//   military.air        mul  air power
//   military.naval      mul  naval power
//   research            mul  research points
// The last five are modifiers of the nodes in force: a bloc branch node
// stops counting when its nation leaves the bloc.
const goodTarget = (prefix: string) =>
  z.enum(GOOD_IDS.map((g) => `${prefix}.${g}`) as [string, ...string[]]);
export const TechEffectSchema = z.union([
  z.object({
    target: z.union([goodTarget("production"), goodTarget("consumption")]),
    op: z.literal("mul"),
    value: z.number().min(0.5).max(1.5),
  }),
  z.object({
    target: z.literal("growth"),
    op: z.literal("add"),
    value: z.number().min(-0.01).max(0.01),
  }),
  z.object({
    target: z.enum([
      "military.land",
      "military.air",
      "military.naval",
      "research",
    ]),
    op: z.literal("mul"),
    value: z.number().min(0.5).max(1.5),
  }),
]);
export type TechEffect = z.infer<typeof TechEffectSchema>;

export const TechNodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1), // i18n key tech.<id>.name
  description: z.string().min(1), // i18n key tech.<id>.desc
  domain: TechDomainSchema,
  tier: z.union([z.literal(1), z.literal(2)]),
  cost: z.number().positive(), // research points
  monthsMin: z.number().int().min(1),
  requires: z.array(z.string()),
  // Who already has it on 1 January 2026: every nation whose development
  // index (sim/tech, config.tech.development) is at least `adoptedAbove`
  // (null: none by this rule), and the nations listed in `adoptedBy`.
  adoptedAbove: z.number().min(0).max(1).nullable(),
  adoptedBy: z.array(NationIdSchema).optional(),
  // A branch node: only the full members of this bloc research it, and its
  // modifiers count while they stay members.
  bloc: z.string().optional(),
  effects: z.array(TechEffectSchema).min(1),
});
export type TechNode = z.infer<typeof TechNodeSchema>;

export const TechFileSchema = z.array(TechNodeSchema);
