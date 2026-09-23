import { SaveFileV4 } from "../../data/schemas/save";
import { SaveFileV3 } from "../../data/schemas/saveV3";
import { MigrationContext } from "./index";

// v3 (J3) -> v4 (J4). Everything of the v3 is kept; the v4 changes:
//   - economy: the circumvention index of an embargoed exporter is kept per
//     good (the v3 scalar is given to every good);
//   - (J4 sections added below as the milestone progresses.)
//
// Fields are only added when absent: the v2 -> v3 step builds its state with
// the current code, whose objects already carry them.
export function v3ToV4(
  save: SaveFileV3,
  context: MigrationContext,
): SaveFileV4 {
  const goods = context.data.goods.map((g) => g.id);
  const economyNations = Object.fromEntries(
    Object.entries(save.economy.nations).map(([id, nation]) => {
      const scalar = nation.circumvention;
      const circumvention =
        typeof scalar === "number"
          ? Object.fromEntries(goods.map((g) => [g, scalar]))
          : (scalar as Record<string, number>);
      return [id, { ...nation, circumvention }];
    }),
  );
  return {
    ...save,
    schemaVersion: 4,
    economy: { ...save.economy, nations: economyNations },
  };
}
