import { z } from "zod";
import { SourcedNumberSchema } from "./common";
import { GoodIdSchema } from "./goods";

// Shape of data/veritable/row.json: the rest of the world. Off the map, never
// playable, no politics, no budget: a market participant, not a nation.
export const ROW_ID = "ROW";

export const RowSchema = z.object({
  id: z.literal(ROW_ID),
  name: z.string().min(1), // i18n key
  scenario: z.string().min(1),
  note: z.string().optional(),
  goods: z.record(
    GoodIdSchema,
    z.object({
      production: SourcedNumberSchema,
      consumption: SourcedNumberSchema,
    }),
  ),
});
export type RowData = z.infer<typeof RowSchema>;
