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
      // Tiles of the contested regions (J6, claims): borders/<id>.regions.bin.
      regions: z.string().min(1).optional(),
      // Natural Earth units attached to a nation of the scenario (J6: the
      // dependencies to their de facto sovereign), and the size under which
      // a nation becomes a micro-state (no tile, a host tile).
      attachments: z.string().min(1).optional(),
      microstateTiles: z.number().int().min(1).optional(),
    }),
    // A rest of the world (row.json) closes the market of a scenario that
    // does not hold every nation (europe-10); the world has none (J6).
    restOfWorld: z.boolean().optional(),
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
