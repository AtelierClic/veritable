import { z } from "zod";
import { NationIdSchema, RegimeSchema } from "./common";

// Shape of data/veritable/blocs/<slug>.json (layer 1 at J2: trade bonus and,
// for the EU, the fiscal rule).
export const BlocSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1), // i18n key
  members: z.array(
    z.object({
      nation: NationIdSchema,
      status: z.enum(["full", "observer", "candidate"]),
    }),
  ),
  joinCriteria: z
    .object({
      regimes: z.array(RegimeSchema).optional(),
      maxDebtToGdp: z.number().positive().optional(),
      geography: z.string().optional(),
    })
    .optional(),
  exit: z.object({ delayMonths: z.number(), cost: z.number() }).optional(),
  decisionRules: z.record(z.string(), z.string()).optional(),
  budget: z
    .object({
      contributionPctGdp: z.number().min(0),
      spending: z.record(z.string(), z.number()),
    })
    .optional(),
  competencies: z.array(z.string()).optional(),
  leadership: z.enum(["rotating", "elected", "hegemon"]).optional(),
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
});
export type Bloc = z.infer<typeof BlocSchema>;
