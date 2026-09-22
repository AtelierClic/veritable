import { z } from "zod";
import { NationId, NationIdSchema } from "../data/schemas/common";
import { GoodIdSchema } from "../data/schemas/goods";
import { SPENDING_POSTS, TAX_IDS } from "../data/schemas/nation";
import {
  DiplomacyState,
  JournalEntry,
  Market,
  MilitaryState,
  NationEconomy,
  NationPolitics,
  NationState,
  NationStatus,
  PeaceTermsSchema,
  SaveFile,
  SPEEDS,
  WorldState,
} from "../data/schemas/save";
import { Scenario } from "../data/schemas/scenario";
import { CONSCRIPTION_LEVELS, POSTURES } from "../data/schemas/war";

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
  // One embargo: stops the flow of one good from an exporter to an importer.
  z.object({
    type: z.literal("set-embargo"),
    from: NationIdSchema,
    to: NationIdSchema,
    good: GoodIdSchema,
    active: z.boolean(),
  }),
  // Sanctions of the player's nation against another: every good but the
  // exempt ones, both ways.
  z.object({
    type: z.literal("set-sanctions"),
    against: NationIdSchema,
    active: z.boolean(),
  }),
  // War (J3a). The casus belli is an id of data/veritable/war/casus-belli.json
  // and must hold against the target.
  z.object({
    type: z.literal("declare-war"),
    target: NationIdSchema,
    casusBelli: z.string().min(1),
  }),
  z.object({ type: z.literal("raise-division"), template: z.string().min(1) }),
  z.object({ type: z.literal("disband-division"), division: z.number().int() }),
  // front: "A|B" (ids sorted) or null for the reserve; segment: index within
  // the front, or null for the whole front.
  z.object({
    type: z.literal("assign-division"),
    division: z.number().int(),
    front: z.string().nullable(),
    segment: z.number().int().nonnegative().nullable(),
  }),
  z.object({
    type: z.literal("set-posture"),
    division: z.number().int(),
    posture: z.enum(POSTURES),
  }),
  z.object({
    type: z.literal("set-conscription"),
    level: z.enum(CONSCRIPTION_LEVELS),
  }),
  z.object({
    type: z.literal("propose-peace"),
    war: z.string().min(1),
    to: NationIdSchema,
    terms: PeaceTermsSchema,
  }),
  z.object({
    type: z.literal("answer-peace"),
    offer: z.number().int(),
    accept: z.boolean(),
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
    }
  | {
      type: "war-declared";
      date: string;
      nation: NationId; // aggressor
      target: NationId;
      casusBelli: string | null;
      war: string;
    }
  | {
      type: "war-joined";
      date: string;
      nation: NationId;
      war: string;
      against: NationId;
    }
  | {
      type: "sanctions-imposed" | "sanctions-lifted";
      date: string;
      nation: NationId; // sanctioned
      by: NationId;
    }
  | {
      type: "peace-offered" | "peace-refused" | "peace-signed";
      date: string;
      nation: NationId; // who offered / refused / the loser
      war: string;
      offer: number;
    }
  | { type: "annexation"; date: string; nation: NationId; by: NationId }
  | {
      type: "landing-refused" | "landing";
      date: string;
      nation: NationId;
      target: NationId;
    };

// A front between two belligerents, as the simulation and the UI see it:
// segments with the forces of both sides and the last resolution.
export interface FrontView {
  id: string; // "A|B", ids sorted
  a: NationId;
  b: NationId;
  segments: readonly SegmentView[];
}
export interface SegmentView {
  index: number;
  tiles: number; // tiles of the segment (defender-side border)
  terrain: { plains: number; highland: number; mountain: number }; // shares
  // Per side: divisions engaged, force, posture in effect, supply factor.
  sides: Record<
    NationId,
    { divisions: number; force: number; attacking: boolean; supply: number }
  >;
  ratio: number; // force of a / force of b, last tick
  movedTo: NationId | null; // who took tiles last tick
}

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
  readonly diplomacy: Readonly<DiplomacyState>;
  readonly military: Readonly<MilitaryState>;
  readonly fronts: readonly FrontView[];
  // Casus belli the player could invoke against each other nation.
  readonly casusBelli: Readonly<Record<NationId, readonly string[]>>;
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
