import { z } from "zod";
import { NationId, NationIdSchema } from "../data/schemas/common";
import { GoodIdSchema } from "../data/schemas/goods";
import { SPENDING_POSTS, TAX_IDS } from "../data/schemas/nation";
import {
  JournalEntry,
  Market,
  NationEconomy,
  NationPolitics,
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
  // Budget sliders of the player's nation. Values are clamped to what the
  // rules allow (ceilings, forced austerity); effect from the next month.
  z.object({
    type: z.literal("set-tax"),
    tax: z.enum(TAX_IDS),
    rate: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("set-spending"),
    post: z.enum(SPENDING_POSTS),
    share: z.number().min(0).max(1),
  }),
  // Sanctions, mechanics only (the interface is J3a): an embargo stops the
  // flow of one good from an exporter to an importer.
  z.object({
    type: z.literal("set-embargo"),
    from: NationIdSchema,
    to: NationIdSchema,
    good: GoodIdSchema,
    active: z.boolean(),
  }),
]);
export type PlayerCommand = z.infer<typeof PlayerCommandSchema>;

export type SimEvent =
  | { type: "day-started"; date: string }
  // The monthly clocks have run; the client takes its automatic save on it.
  | { type: "month-started"; date: string }
  | {
      type: "nation-status-changed";
      date: string;
      nation: NationId;
      from: NationStatus;
      to: NationStatus;
    }
  | {
      type:
        | "unrest-started"
        | "unrest-ended"
        | "austerity-started"
        | "austerity-ended"
        | "sovereign-default";
      date: string;
      nation: NationId;
    }
  | {
      type: "bloc-reprimand";
      date: string;
      nation: NationId;
      bloc: string;
      deficitToGdp: number;
      debtToGdp: number;
    };

export interface ReadonlyWorldView {
  readonly seed: number;
  readonly date: string;
  readonly elapsedGameMinutes: number;
  readonly speed: number;
  readonly playerNation: NationId | null;
  readonly nations: readonly Readonly<NationState>[];
  readonly journal: readonly Readonly<JournalEntry>[];
  readonly market: Readonly<Market>;
  readonly economies: Readonly<Record<NationId, Readonly<NationEconomy>>>;
  readonly politics: Readonly<Record<NationId, Readonly<NationPolitics>>>;
}

export interface TileGrid {
  width: number;
  height: number;
  // See TILE_NATION_MASK / TILE_FALLOUT_BIT in data/schemas/saveV1.ts.
  tiles: Uint16Array;
}

// What the simulation needs from the tiled world. Implemented by
// src/veritable/adapters/CoreBridge.ts over the OpenFront core, and by
// in-memory worlds for tests and the headless runner. Nations are always
// addressed by NationId; tile values use the index of the nation in the
// `nations` argument.
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
