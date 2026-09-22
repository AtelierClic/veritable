import { z } from "zod";

// Shape of data/veritable/maps/<map>.seas.json: the seeds of the maritime
// zones. The tool tools/veritable/borders (command `zones`) partitions the
// water tiles of the map between them by travel distance over water.
export const SeaZoneSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1), // i18n key
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
});
export type SeaZone = z.infer<typeof SeaZoneSchema>;

export const SeasSchema = z
  .object({
    map: z.string().min(1),
    note: z.string().optional(),
    zones: z.array(SeaZoneSchema).min(1),
  })
  .refine((s) => new Set(s.zones.map((z) => z.id)).size === s.zones.length, {
    message: "duplicate zone id",
  });
export type Seas = z.infer<typeof SeasSchema>;
