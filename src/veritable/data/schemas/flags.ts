import { z } from "zod";
import { NationIdSchema } from "./common";

// The flag of each nation (J7, data/veritable/flags.json): the file
// resources/flags/<code>.svg of OpenFront; a nation without one has none.
export const FlagsFileSchema = z.object({
  _comment: z.string().optional(),
  asOf: z.string(),
  flags: z.record(NationIdSchema, z.string().regex(/^[a-z]{2}$/)),
});
export type FlagsFile = z.infer<typeof FlagsFileSchema>;
