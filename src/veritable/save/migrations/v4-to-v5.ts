import { NationId } from "../../data/schemas/common";
import {
  SaveFileV5,
  TILE_CONTESTED_BIT,
  TILE_NATION_MASK,
} from "../../data/schemas/save";
import { SaveFileV4 } from "../../data/schemas/saveV4";
import { monthIndex } from "../../sim/war/contest";
import { MigrationContext } from "./index";

// v4 (J4) -> v5 (J5). Everything of the v4 is kept; the v5 adds:
//   - the contest of each tile (second tile block): a tile tagged contested
//     in the v4 is dated from the month of the save, not ceded, so it stays
//     contested ten years from then (the v4 did not know since when);
//   - the territory of the first day: the tiles of each nation in the
//     scenario borders when the caller has them, else its tiles in the save
//     (a nation at war then measures its later losses from that day).
export function v4ToV5(
  save: SaveFileV4,
  context: MigrationContext | undefined,
): SaveFileV5 {
  const month = monthIndex(save.calendar.startDate, save.calendar.date) + 1;
  const contest = new Uint16Array(save.tiles.length);
  const counts: Record<NationId, number> = Object.fromEntries(
    save.nations.map((n) => [n.id, 0]),
  );
  for (let tile = 0; tile < save.tiles.length; tile++) {
    const value = save.tiles[tile];
    const owner = value & TILE_NATION_MASK;
    if (owner === 0) continue;
    counts[save.nations[owner - 1].id] += 1;
    if ((value & TILE_CONTESTED_BIT) !== 0) contest[tile] = month;
  }
  const initialTiles = Object.fromEntries(
    save.nations.map((n) => [
      n.id,
      context?.initialTiles?.[n.id] ?? counts[n.id],
    ]),
  );
  return {
    ...save,
    schemaVersion: 5,
    territory: { initialTiles },
    contest,
  } as SaveFileV5;
}
