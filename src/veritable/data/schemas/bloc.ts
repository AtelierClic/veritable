import { z } from "zod";
import { NationIdSchema, RegimeSchema } from "./common";

// Shape of data/veritable/blocs/<slug>.json. Layer 1 (J2-J4): trade bonus,
// fiscal rule, suspension after a coup, alignment of sanctions. Layers 2 and
// 3 (J5): members and their statuses, decision rules by domain, budget,
// accession and exit, leadership, collective defence.

const share = z.number().min(0).max(1);

export const BLOC_MEMBER_STATUSES = [
  "full",
  "candidate",
  "observer",
  "partner",
  "associate",
  "suspended",
] as const;
export const BlocMemberStatusSchema = z.enum(BLOC_MEMBER_STATUSES);
export type BlocMemberStatus = z.infer<typeof BlocMemberStatusSchema>;

// The domains a bloc decides in; each measure a leader proposes falls in one.
export const BLOC_DOMAINS = [
  "sanctions",
  "lift",
  "accession",
  "suspension",
  "budget",
  "defense",
  "tech",
  "trade",
] as const;
export type BlocDomain = (typeof BLOC_DOMAINS)[number];

// unanimity and consensus: nobody votes no and somebody votes yes
// (abstention allowed); qualified-majority: the shares of `qualifiedMajority`
// (members and population among the voters); simple-majority: more yes than
// no.
export const DECISION_RULES = [
  "unanimity",
  "consensus",
  "qualified-majority",
  "simple-majority",
] as const;
export const DecisionRuleSchema = z.enum(DECISION_RULES);
export type DecisionRule = z.infer<typeof DecisionRuleSchema>;

export const BlocSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1), // i18n key
  // Every member, simulated or not (ISO 3166-1 alpha-3); only the nations of
  // the scenario vote and pay (europe-10: an artifact lifted at the J6).
  members: z.array(
    z.object({ nation: NationIdSchema, status: BlocMemberStatusSchema }),
  ),
  decisionRules: z.record(z.enum(BLOC_DOMAINS), DecisionRuleSchema),
  qualifiedMajority: z
    .object({ memberShare: share, populationShare: share })
    .optional(),
  budget: z
    .object({
      contributionPctGdp: z.number().min(0),
      // Structural funds go to the members whose GDP per head is under this
      // share of the bloc's, in proportion to what they lack.
      structuralFundsBelowGdpPerCapitaShare: share.optional(),
      // Shares of the pool (a missing one is 0).
      shares: z.object({
        structural: share.optional(),
        defense: share.optional(),
        candidates: share.optional(),
        programs: share.optional(),
      }),
    })
    .optional(),
  accession: z.object({
    regimes: z.array(RegimeSchema).optional(),
    maxDebtToGdp: z.number().positive().optional(),
    // Mean relations of the members with the candidate.
    minRelations: z.number().optional(),
    monthsMin: z.number().int().min(0),
    monthsMax: z.number().int().min(0),
  }),
  exit: z.object({
    delayMonths: z.number().int().min(0),
    tradeCostPctGdp: share, // GDP level lost when the exit takes effect
  }),
  leadership: z.object({
    kind: z.enum(["rotating", "hegemon", "elected"]),
    termMonths: z.number().int().min(1).optional(),
    order: z.array(NationIdSchema).optional(),
  }),
  // Article 5: a member attacked by a non-member; every other member enters
  // the war within the month with this probability (lower for a sovereignist
  // government).
  collectiveDefense: z
    .object({
      joinProbability: share,
      sovereignJoinProbability: share,
      sovereigntyAbove: z.number(),
    })
    .optional(),
  competencies: z.array(z.string()).optional(),
  techBranch: z.string().optional(),
  layer: z.number().int().min(1).max(3),
  // Reprimand of members beyond these limits: opinion malus and journal.
  // Reprimanded when the deficit is above the limit for `deficitYears`
  // consecutive years, or when debt is above its limit and has been rising
  // for `debtRisingMonths`; the malus fades out over `malusFadeMonths` once
  // the reprimand is lifted (J3 revision).
  fiscalRule: z
    .object({
      maxDeficitToGdp: z.number().positive(),
      deficitYears: z.number().int().min(1),
      maxDebtToGdp: z.number().positive(),
      debtRisingMonths: z.number().int().min(1),
      opinionMalus: z.number().min(0).max(1),
      malusFadeMonths: z.number().int().min(1),
    })
    .optional(),
  // Weight multiplier of trade flows between two full members.
  tradeBonus: z.number().min(1).optional(),
  // Democratic criterion (layer 1, J4): a member that falls to a coup is
  // suspended (no trade bonus, no alignment, no fiscal rule) until it is a
  // democracy again.
  suspendsOnCoup: z.boolean().optional(),
});
export type Bloc = z.infer<typeof BlocSchema>;
