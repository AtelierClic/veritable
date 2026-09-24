import { z } from "zod";
import { ContestedRegionSchema, IsoDateSchema, NationIdSchema } from "./common";
import { GoodIdSchema } from "./goods";

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
    // The world of 2026 (J6b). Relations of the first day (a file of
    // relations/, see data/schemas/relations.ts); without it, the rule of
    // the J3 (common blocs).
    relations: z.string().min(1).optional(),
    // Sanctions in force on the first day, by a nation or a bloc (its full
    // members apply them, the bloc holds them): `goods` absent = full
    // sanctions (every good but the exempt ones, both ways, as a sanction
    // imposed in the campaign), else embargoes on those goods only, both
    // ways.
    sanctions: z
      .array(
        z.object({
          // A nation, a bloc, or "*": every nation of the scenario (a
          // regime of the UN Security Council) but `except`.
          by: z.union([NationIdSchema, z.literal("*")]),
          // A nation, or a bloc: each of its full members.
          against: NationIdSchema,
          except: z.array(NationIdSchema).optional(),
          goods: z.array(GoodIdSchema).optional(),
          since: IsoDateSchema,
          source: z.string().min(1),
          note: z.string().optional(),
        }),
      )
      .optional(),
    // Armed conflicts inside a nation without a de facto entity: stability
    // lost in proportion to the intensity, fading (config.politics).
    internalConflicts: z
      .array(
        z.object({
          nation: NationIdSchema,
          intensity: z.number().min(0).max(1),
          since: IsoDateSchema,
          note: z.string().min(1),
        }),
      )
      .optional(),
    // Bilateral protection: the guarantor enters a war declared on the
    // protected nation with this probability, and the AI counts it as it
    // counts a collective-defence bloc.
    guarantees: z
      .array(
        z.object({
          guarantor: NationIdSchema,
          protected: NationIdSchema,
          probability: z.number().min(0).max(1),
          note: z.string().min(1),
        }),
      )
      .optional(),
  })
  .refine((s) => new Set(s.nations).size === s.nations.length, {
    message: "duplicate nation id in scenario",
  })
  .refine((s) => s.nations.includes(s.playerDefault), {
    message: "playerDefault is not a nation of the scenario",
  });
export type Scenario = z.infer<typeof ScenarioSchema>;
