import { z } from "zod";
import { NationIdSchema } from "./common";

// The cities of a scenario (J7, data/veritable/cities/<scenario>.json),
// written by tools/veritable/borders (command `cities`): the three largest
// populated places of Natural Earth of each nation and its capital, on the
// tile of the map they belong to, owned by the de facto owner of that tile
// on the first day.
export const CityDataSchema = z.object({
  id: z.string().min(1),
  nation: NationIdSchema,
  name: z.string().min(1), // i18n key
  tile: z.number().int().nonnegative(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  population: z.number().nonnegative(), // POP_MAX of Natural Earth
  capital: z.boolean(),
  source: z.string(),
});
export type CityData = z.infer<typeof CityDataSchema>;

export const CitiesFileSchema = z.object({
  scenario: z.string(),
  map: z.string(),
  source: z.string(),
  cities: z.array(CityDataSchema),
});
export type CitiesFile = z.infer<typeof CitiesFileSchema>;
