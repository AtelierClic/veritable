import { SaveFileV1 } from "../../data/schemas/saveV1";
import { SaveFileV2 } from "../../data/schemas/saveV2";
import { buildContext } from "../../sim/economy/context";
import { initEconomy, initPolitics } from "../../sim/economy/init";
import { Rng } from "../../sim/rng";
import { MigrationContext } from "./index";

// v1 (J0-J1) -> v2 (J2): the save gains its `economy` and `politics` sections.
//
// A v1 campaign had no economy at all, so there is nothing to convert: both
// sections start from the nation sheets, exactly like a new campaign, whatever
// the date of the save. Everything else (calendar, nations, tiles, core world,
// journal, Rng) is kept as it is.
//
// The economy is built by the current code, so the objects carry the fields
// of later versions too; the next migrations only add what is absent.
export function v1ToV2(
  save: SaveFileV1,
  context: MigrationContext,
): SaveFileV2 {
  const sheets = save.nations.map((nation) => {
    const data = context.nationData(nation.id);
    if (data === undefined) {
      throw new Error(`migration v1 -> v2: no nation sheet for ${nation.id}`);
    }
    return data;
  });
  const ctx = buildContext(context.config, context.data, sheets);
  const player = save.nations.find((n) => n.isPlayer)?.id ?? null;
  return {
    ...save,
    schemaVersion: 2,
    economy: initEconomy(ctx, sheets, context.data.row),
    politics: initPolitics(
      ctx,
      sheets,
      player,
      false,
      new Rng(save.seed),
      save.calendar.date,
    ),
  } as SaveFileV2;
}
