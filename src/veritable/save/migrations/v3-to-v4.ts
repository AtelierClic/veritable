import { SaveFileV3 } from "../../data/schemas/saveV3";
import { SaveFileV4 } from "../../data/schemas/saveV4";
import { buildContext } from "../../sim/economy/context";
import { initNationPolitics } from "../../sim/politics/state";
import { Rng } from "../../sim/rng";
import { MigrationContext } from "./index";

// v3 (J3) -> v4 (J4). Everything of the v3 is kept; the v4 changes:
//   - economy: the circumvention index of an embargoed exporter is kept per
//     good (the v3 scalar is given to every good); the sliders get targets
//     (equal to the values in effect);
//   - politics: the political engine (regime, legitimacy, capital, leader,
//     parties, government, elections, laws, levers) is built from the sheets
//     and the leaders data like a new campaign; the opinion, stability,
//     unrest and bloc-rule fields of the v3 are kept; the player's
//     objectives and notes start empty.
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
      const extended = nation as unknown as Partial<
        SaveFileV4["economy"]["nations"][0]
      >;
      const scalar = nation.circumvention;
      const circumvention =
        typeof scalar === "number"
          ? Object.fromEntries(goods.map((g) => [g, scalar]))
          : (scalar as Record<string, number>);
      return [
        id,
        {
          ...nation,
          circumvention,
          taxTargets: extended.taxTargets ?? { ...nation.taxes },
          spendingTargets: extended.spendingTargets ?? { ...nation.spending },
        },
      ];
    }),
  );
  const sheets = save.nations.map((nation) => {
    const data = context.nationData(nation.id);
    if (data === undefined) {
      throw new Error(`migration v3 -> v4: no nation sheet for ${nation.id}`);
    }
    return data;
  });
  const ctx = buildContext(context.config, context.data, sheets);
  const rng = new Rng(save.seed ^ 0x4a4);
  const politicsNations = Object.fromEntries(
    Object.entries(save.politics.nations).map(([id, nation]) => {
      const extended = nation as Partial<SaveFileV4["politics"]["nations"][0]>;
      if (extended.leader !== undefined) return [id, nation];
      const sheet = sheets.find((s) => s.id === id)!;
      const fresh = initNationPolitics(
        ctx,
        rng,
        sheet,
        nation.groups !== null,
        save.calendar.date,
      );
      return [id, { ...fresh, ...nation }];
    }),
  );
  const player = (save.politics as Partial<SaveFileV4["politics"]>).player ?? {
    objectives: [],
    notes: [],
  };
  return {
    ...save,
    schemaVersion: 4,
    economy: { ...save.economy, nations: economyNations },
    politics: { ...save.politics, nations: politicsNations, player },
  } as SaveFileV4;
}
