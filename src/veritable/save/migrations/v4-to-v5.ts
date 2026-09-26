import { NationId } from "../../data/schemas/common";
import { TILE_CONTESTED_BIT, TILE_NATION_MASK } from "../../data/schemas/save";
import { SaveFileV4 } from "../../data/schemas/saveV4";
import {
  BlocsStateV5 as BlocsState,
  SaveFileV5,
} from "../../data/schemas/saveV5";
import {
  BlocEnv,
  computeLeader,
  initBlocs,
  syncBlocs,
} from "../../sim/blocs/blocs";
import { dateOfDay } from "../../sim/calendar";
import { buildContext } from "../../sim/economy/context";
import { initEvents } from "../../sim/events/events";
import { initNuclear } from "../../sim/nuclear/nuclear";
import { initTech } from "../../sim/tech/tech";
import { monthIndex } from "../../sim/war/contest";
import { MigrationContext } from "./index";

// v4 (J4) -> v5 (J5). Everything of the v4 is kept; the v5 adds:
//   - the contest of each tile (second tile block): a tile tagged contested
//     in the v4 is dated from the month of the save, not ceded, so it stays
//     contested ten years from then (the v4 did not know since when);
//   - the territory of the first day: the tiles of each nation in the
//     scenario borders when the caller has them, else its tiles in the save
//     (a nation at war then measures its later losses from that day);
//   - the structures of each nation, counted from the core state of the save
//     (levels summed): only those built after the migration are charged to
//     its budget;
//   - nuclear weapons: the arsenals of the sheets, untouched (nobody fired
//     before the J5), no pariah, no delayed annexation; the coalition calls
//     open in the v4 were all for the defenders;
//   - the nation AI: every nation reviewed within the month after the save,
//     no defence goal yet, no arms flow;
//   - the blocs (layers 2 and 3): the members of the data, no measure, no
//     budget paid yet, the leader of the month; the wars of the v4 do not
//     call collective defence after the fact;
//   - technology: what each nation had on the first day (development index
//     of its sheet), nothing in research; events: none yet, no grievance.
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
  const structures: Record<NationId, Record<string, number>> = {};
  for (const player of save.world.players) {
    const count: Record<string, number> = {};
    for (const s of player.structures) {
      count[s.type] = (count[s.type] ?? 0) + Math.max(1, s.level);
    }
    structures[player.nation] = count;
  }
  const sheets = save.nations
    .map((n) => context?.nationData(n.id))
    .filter((s) => s !== undefined);
  return {
    ...save,
    schemaVersion: 5,
    blocs: migrateBlocs(save, context, sheets),
    tech:
      context === undefined
        ? { nations: {} }
        : initTech(buildContext(context.config, context.data, sheets), sheets),
    events: initEvents(),
    diplomacy: {
      ...save.diplomacy,
      coalitionCalls: save.diplomacy.coalitionCalls.map((c) => ({
        ...c,
        side: "defenders" as const,
      })),
      pariahs: [],
      pendingAnnexations: [],
      grievances: [],
    },
    territory: { initialTiles, structures, constructionCost: {} },
    nuclear: initNuclear(sheets),
    ai: v5Ai(
      save.nations.map((n) => n.id),
      save.calendar.date,
    ),
    contest,
    // Today's builders: the later migrations bring their shapes back to
    // their versions.
  } as unknown as SaveFileV5;
}

// The AI state of the v5 (J5): a staggered review, the first ones spread
// over the first month.
function v5Ai(ids: readonly NationId[], date: string): SaveFileV5["ai"] {
  return {
    cursor: 0,
    nations: Object.fromEntries(
      ids.map((id, i) => [
        id,
        {
          nextReview: dateOfDay(date, i % 30),
          defenseGoal: 0,
          lastWar: null,
          lastLanding: null,
          blockading: null,
        },
      ]),
    ),
    armsAid: [],
  };
}

function migrateBlocs(
  save: SaveFileV4,
  context: MigrationContext | undefined,
  sheets: NonNullable<ReturnType<MigrationContext["nationData"]>>[],
): BlocsState {
  if (context === undefined) {
    return {
      blocs: [],
      proposals: [],
      nextProposal: 1,
      calls: [],
      handledWars: [],
      leaders: {},
      net: {},
    };
  }
  const ctx = buildContext(context.config, context.data, sheets);
  for (const nation of save.nations) {
    for (const bloc of save.politics.nations[nation.id].suspendedFrom) {
      ctx.suspensions.add(`${bloc}|${nation.id}`);
    }
  }
  const blocs = initBlocs(ctx);
  syncBlocs(ctx, blocs);
  blocs.handledWars = save.diplomacy.wars.map((w) => w.id);
  for (const bloc of blocs.blocs) {
    blocs.leaders[bloc.id] =
      computeLeader(
        {
          ctx,
          state: blocs,
          military: save.military as unknown as BlocEnv["military"],
          // The economy of today's shape (the leader reads the GDP only).
          economy: {
            ...save.economy,
            nations: Object.fromEntries(
              Object.entries(save.economy.nations).map(([id, e]) => [
                id,
                { ...e, interestSpread: 0 },
              ]),
            ),
          } as unknown as BlocEnv["economy"],
        },
        bloc.id,
        save.calendar.date,
      ) ?? "";
  }
  return blocs;
}
