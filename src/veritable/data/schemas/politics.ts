import { z } from "zod";
import { INTEREST_GROUPS, IsoDateSchema, RegimeSchema } from "./common";
import { GoodIdSchema } from "./goods";

// Shapes of the political data (J4): regimes.json, ideologies.json,
// objectives.json, names/<iso3>.json.

// Three ideological axes, each in [-1, 1]: economic (left … right),
// authority (liberal … authoritarian), sovereignty (internationalist …
// sovereigntist).
export const IDEOLOGY_AXES = ["economic", "authority", "sovereignty"] as const;
export type IdeologyAxis = (typeof IDEOLOGY_AXES)[number];
const axis = z.number().min(-1).max(1);
export const IdeologySchema = z.object({
  economic: axis,
  authority: axis,
  sovereignty: axis,
});
export type Ideology = z.infer<typeof IdeologySchema>;

export const LAW_DOMAINS = [
  "economy",
  "social",
  "security",
  "institutions",
  "environment",
  "defense",
] as const;
export const LawDomainSchema = z.enum(LAW_DOMAINS);
export type LawDomain = z.infer<typeof LawDomainSchema>;

export const SUCCESSION_RULES = [
  "election",
  "party",
  "hereditary",
  "military-council",
  "clerical",
  "warlord",
] as const;

// politics/regimes.json: the nine archetypes.
export const RegimeDataSchema = z.object({
  id: RegimeSchema,
  name: z.string().min(1), // i18n key
  electionIntervalMonths: z.number().int().positive().nullable(),
  successionRule: z.enum(SUCCESSION_RULES),
  // How a government forms after an election: a coalition by ideological
  // proximity up to a majority, the leading party alone, or appointed (no
  // election).
  government: z.enum(["coalition", "leading-party", "appointed"]),
  democratic: z.boolean(),
  coupBase: z.number().min(0).max(1), // monthly base probability of a coup
  legitimacyBase: z.number().min(0).max(1),
  pressFreedom: z.number().min(0).max(1), // starting value of the slider
  mediaControl: z.number().min(0).max(1), // structural control of the media
  lawDomains: z.array(LawDomainSchema),
});
export type RegimeData = z.infer<typeof RegimeDataSchema>;
export const RegimesSchema = z
  .array(RegimeDataSchema)
  .refine((r) => new Set(r.map((x) => x.id)).size === r.length, {
    message: "duplicate regime id",
  });

// politics/ideologies.json: Wikidata ideology QID -> three axes.
export const IdeologyTableSchema = z.record(
  z.string().regex(/^Q\d+$/),
  IdeologySchema.extend({ label: z.string().min(1) }),
);
export type IdeologyTable = z.infer<typeof IdeologyTableSchema>;

// politics/objectives.json: the catalogue of pinnable objectives, each with
// a condition evaluated on the world view.
export const ObjectiveConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("gdp-ratio"), value: z.number().positive() }),
  z.object({ kind: z.literal("join-bloc"), bloc: z.string().min(1) }),
  z.object({
    kind: z.literal("stability-above"),
    value: z.number().min(0).max(1),
    years: z.number().positive(),
  }),
  z.object({ kind: z.literal("retake-region") }),
  z.object({ kind: z.literal("no-war"), years: z.number().positive() }),
  z.object({ kind: z.literal("debt-below"), value: z.number().min(0) }),
  z.object({ kind: z.literal("self-sufficient"), good: GoodIdSchema }),
  z.object({
    kind: z.literal("legitimacy-above"),
    value: z.number().min(0).max(1),
  }),
  z.object({ kind: z.literal("win-election") }),
  z.object({
    kind: z.literal("shortage-below"),
    value: z.number().min(0).max(1),
    years: z.number().positive(),
  }),
  z.object({
    kind: z.literal("export-share"),
    good: GoodIdSchema,
    value: z.number().min(0).max(1),
  }),
]);
export type ObjectiveCondition = z.infer<typeof ObjectiveConditionSchema>;
export const ObjectiveSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  condition: ObjectiveConditionSchema,
});
export type Objective = z.infer<typeof ObjectiveSchema>;
export const ObjectivesSchema = z
  .array(ObjectiveSchema)
  .refine((o) => new Set(o.map((x) => x.id)).size === o.length, {
    message: "duplicate objective id",
  });

// names/<iso3>.json: pools for fictional names.
export const NamePoolSchema = z.object({
  nation: z.string().min(1),
  first: z.array(z.string().min(1)).min(5),
  last: z.array(z.string().min(1)).min(5),
});
export type NamePool = z.infer<typeof NamePoolSchema>;

// Ideology of the eight interest groups (config default, sheet override).
export const GroupIdeologiesSchema = z.object(
  Object.fromEntries(INTEREST_GROUPS.map((g) => [g, IdeologySchema])) as Record<
    (typeof INTEREST_GROUPS)[number],
    typeof IdeologySchema
  >,
);
export type GroupIdeologies = z.infer<typeof GroupIdeologiesSchema>;

// Field `politics` of a nation sheet.
export const NationPoliticsDataSchema = z.object({
  electionIntervalMonths: z.number().int().positive(),
  lastElection: IsoDateSchema, // last real national election
  electionsSuspendedAtWarAtHome: z.boolean(),
  // J7: the head of state is elected in two rounds (a runoff between the
  // first two; presidential and semi-presidential regimes), and the first
  // party governs alone whatever its share (majoritarian parliaments).
  runoff: z.boolean().optional(),
  government: z.enum(["coalition", "leading-party"]).optional(),
  groupIdeologies: GroupIdeologiesSchema.optional(),
  source: z.string().min(1),
  asOf: z.string().min(1),
  note: z.string().optional(),
});
export type NationPoliticsData = z.infer<typeof NationPoliticsDataSchema>;
