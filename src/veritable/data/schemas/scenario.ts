import { z } from "zod";
import { ContestedRegionSchema, IsoDateSchema, NationIdSchema } from "./common";

// Shape of data/veritable/scenarios/<slug>.json.

// J0 extension (see DECISIONS.md): until the J1 scenario loader and the J2
// nation sheets exist, a scenario can declare nations inline, built from the
// map manifest. Their names are literals, not i18n keys.
export const AdHocNationSchema = z.object({
  id: NationIdSchema,
  literalName: z.string().min(1),
});
export type AdHocNation = z.infer<typeof AdHocNationSchema>;

export const ScenarioSchema = z
  .object({
    id: z.string().min(1),
    map: z.string().min(1),
    startDate: IsoDateSchema,
    nations: z.array(NationIdSchema),
    adHocNations: z.array(AdHocNationSchema).optional(),
    borders: z
      .object({ source: z.string().min(1), rasterized: z.string().min(1) })
      .optional(),
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
  .refine(
    (s) => {
      const ids = [...s.nations, ...(s.adHocNations ?? []).map((n) => n.id)];
      return new Set(ids).size === ids.length;
    },
    { message: "duplicate nation id in scenario" },
  )
  .refine(
    (s) =>
      s.nations.includes(s.playerDefault) ||
      (s.adHocNations ?? []).some((n) => n.id === s.playerDefault),
    { message: "playerDefault is not a nation of the scenario" },
  );
export type Scenario = z.infer<typeof ScenarioSchema>;
