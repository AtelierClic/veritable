import { z } from "zod";
import { NationId, NationIdSchema } from "../data/schemas/common";
import {
  JournalEntry,
  NationState,
  NationStatus,
  SaveFile,
  SPEEDS,
  WorldState,
} from "../data/schemas/save";
import { Scenario } from "../data/schemas/scenario";

// The simulation boundary (ARCHITECTURE.md, "Frontière de simulation").
// The client (through the worker) and the headless runner are two consumers of
// this same interface. The simulation does not know a UI exists.
export interface VeritableSim {
  init(scenario: Scenario, seed: number): void;
  restore(snapshot: SaveFile): void;
  snapshot(): SaveFile;
  apply(command: PlayerCommand): void;
  advance(gameMinutes: number): SimEvent[];
  read(): ReadonlyWorldView;
}

export const PlayerCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set-speed"),
    speed: z.union(SPEEDS.map((s) => z.literal(s))),
  }),
]);
export type PlayerCommand = z.infer<typeof PlayerCommandSchema>;

export type SimEvent = {
  type: "nation-status-changed";
  date: string;
  nation: NationId;
  from: NationStatus;
  to: NationStatus;
};

export interface ReadonlyWorldView {
  readonly seed: number;
  readonly date: string;
  readonly elapsedGameMinutes: number;
  readonly speed: number;
  readonly playerNation: NationId | null;
  readonly nations: readonly Readonly<NationState>[];
  readonly journal: readonly Readonly<JournalEntry>[];
}

export interface TileGrid {
  width: number;
  height: number;
  // See TILE_NATION_MASK / TILE_FALLOUT_BIT in data/schemas/save.ts.
  tiles: Uint16Array;
}

// What the simulation needs from the tiled world. Implemented by
// src/veritable/adapters/CoreBridge.ts over the OpenFront core, and by an
// in-memory fake for tests. Nations are always addressed by NationId; tile
// values use the index of the nation in the `nations` argument.
export interface WorldPort {
  tileCounts(): ReadonlyMap<NationId, number>;
  capture(nations: readonly NationId[]): { world: WorldState; grid: TileGrid };
  restore(
    nations: readonly NationId[],
    world: WorldState,
    grid: TileGrid,
  ): void;
}

export { NationIdSchema };
