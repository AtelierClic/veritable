import { z } from "zod";
import { ContestedRegionSchema, IsoDateSchema, NationIdSchema } from "./common";

// Shape of data/veritable/scenarios/<slug>.json.

export const ScenarioSchema = z
  .object({
    id: z.string().min(1),
    map: z.string().min(1),
    startDate: IsoDateSchema,
    nations: z.array(NationIdSchema).min(1),
    borders: z.object({
      source: z.string().min(1),
      rasterized: z.string().min(1),
    }),
    contested: z.array(ContestedRegionSchema),
    wars: z.array(
      z.object({
        id: z.string().min(1),
        belligerents: z.tuple([
          z.array(NationIdSchema),
          z.array(NationIdSchema),
        ]),
        since: IsoDateSchema,
        intensity: z.number().min(0).max(1),
        fronts: z.array(z.unknown()),
      }),
    ),
    playerDefault: NationIdSchema,
  })
  .refine((s) => new Set(s.nations).size === s.nations.length, {
    message: "duplicate nation id in scenario",
  })
  .refine((s) => s.nations.includes(s.playerDefault), {
    message: "playerDefault is not a nation of the scenario",
  });
export type Scenario = z.infer<typeof ScenarioSchema>;
