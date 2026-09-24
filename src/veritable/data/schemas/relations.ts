import { z } from "zod";
import { NationIdSchema } from "./common";

// Relations of the first day of a scenario (J6b), data/veritable/scenarios/
// <id>.relations.json: `values` is the upper triangle of the matrix, row by
// row (the pairs i < j of `nations`, in that order), integers in [-100, 100].
// Built by the ingest tool (build-relations) from the votes at the UN
// General Assembly, the blocs and the pairs written by hand.
export const RelationsFileSchema = z
  .object({
    scenario: z.string().min(1),
    asOf: z.string().min(1),
    source: z.string().min(1),
    note: z.string(),
    nations: z.array(NationIdSchema).min(2),
    values: z.array(z.number().int().min(-100).max(100)),
  })
  .refine(
    (f) => f.values.length === (f.nations.length * (f.nations.length - 1)) / 2,
    { message: "values must hold every pair i < j of nations" },
  );
export type RelationsFile = z.infer<typeof RelationsFileSchema>;

// Relation of a pair in the file (null when a nation is not in it).
export function relationIn(
  file: RelationsFile,
  index: ReadonlyMap<string, number>,
  a: string,
  b: string,
): number | null {
  const i0 = index.get(a);
  const j0 = index.get(b);
  if (i0 === undefined || j0 === undefined || i0 === j0) return null;
  const [i, j] = i0 < j0 ? [i0, j0] : [j0, i0];
  const n = file.nations.length;
  // Row i starts after the i previous rows of n-1, n-2, ... pairs.
  return file.values[i * n - (i * (i + 1)) / 2 + (j - i - 1)];
}
