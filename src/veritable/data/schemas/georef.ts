import { z } from "zod";

// The georeferencing of a map (tools/veritable/borders, J1 and J6a):
// data/veritable/maps/<map>.georef.json. The simulation reads only the
// scale — tiles per radian of the sphere — for the size of a tile (J6c).
export const GeorefSchema = z
  .object({
    map: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    scale: z.number().positive(),
  })
  .passthrough();
export type Georef = z.infer<typeof GeorefSchema>;
