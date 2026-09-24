import { z } from "zod";
import {
  INTEREST_GROUPS,
  NationId,
  NationIdSchema,
} from "../data/schemas/common";
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
  NavalState,
  NuclearState,
  PeaceTermsSchema,
  PinnedObjective,
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
  // Navy (J3b): the fleet goes to the coastal zones of the target, or home.
  z.object({
    type: z.literal("set-blockade"),
    target: NationIdSchema,
    active: z.boolean(),
  }),
  // A landing on the coast of an enemy: refused unless the zone of the
  // landing tile is controlled.
  z.object({ type: z.literal("landing"), target: NationIdSchema }),
  // The political engine (J4). Laws of data/veritable/laws/; the electoral
  // levers of the player; objectives of data/veritable/politics/
  // objectives.json; free-text notes.
  z.object({ type: z.literal("enact-law"), law: z.string().min(1) }),
  z.object({ type: z.literal("repeal-law"), law: z.string().min(1) }),
  z.object({
    type: z.literal("set-lever"),
    propagandaPctGdp: z.number().min(0).max(1).optional(),
    fraud: z.number().min(0).max(1).optional(),
    clientelism: z.enum(INTEREST_GROUPS).nullable().optional(),
  }),
  z.object({ type: z.literal("pin-objective"), objective: z.string().min(1) }),
  z.object({
    type: z.literal("unpin-objective"),
    objective: z.string().min(1),
  }),
  z.object({ type: z.literal("add-note"), text: z.string().min(1).max(2000) }),
  // Nuclear weapons (J5): a warhead of the player's nation at an enemy, at the
  // concentration of its divisions on their front or at its capital. The
  // screen asks twice; the command carries the second answer.
  z.object({
    type: z.literal("nuclear-launch"),
    target: NationIdSchema,
    aim: z.enum(["front", "capital"]),
    confirmed: z.literal(true),
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
    }
  // The political engine (J4); the parameters are those of the journal.
  | {
      type:
        | "election-held"
        | "government-formed"
        | "elections-suspended"
        | "law-enacted"
        | "law-refused"
        | "law-repealed"
        | "law-repeal-announced"
        | "coup-attempted"
        | "coup-succeeded"
        | "revolution"
        | "leader-died"
        | "leader-succeeded"
        | "fraud-detected"
        | "objective-completed"
        | "regime-changed"
        | "bloc-suspended"
        | "civilian-transition"
        // Nuclear weapons (J5).
        | "nuclear-launch"
        | "nuclear-detonation"
        | "nuclear-intercepted"
        | "dead-hand";
      date: string;
      nation: NationId;
      params: Record<string, string>;
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
  // Per side: divisions engaged, force, posture in effect, and the factors
  // of its force (J5: what a click on a segment of the map shows).
  sides: Record<NationId, SegmentSide>;
  ratio: number; // force of a / force of b, last tick
  // The attack that counts on the segment: who attacks, and its force over
  // the defender's (terrain and structures included); null when nobody
  // attacks.
  attacker: NationId | null;
  attackRatio: number;
  movedTo: NationId | null; // who took tiles last tick
}
export interface SegmentSide {
  divisions: number;
  force: number; // with supply and air, without terrain and structures
  attacking: boolean;
  men: number;
  equipment: number; // 0..1, mean of the engaged divisions
  training: number; // mean of the engaged divisions
  supply: number; // factor
  air: number; // factor
  terrain: number; // factor on its defence
  structures: number; // factor on its defence (defence posts, cities)
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
  readonly naval: Readonly<NavalState>;
  readonly fronts: readonly FrontView[];
  // Nuclear weapons (J5): arsenals, threat levels, strikes, fallout; the
  // probability that the dead hand of each nuclear nation strikes its
  // annexer; the daily probability of a shot of each nuclear nation nobody
  // plays at the enemy that threatens it most.
  readonly nuclear: Readonly<NuclearState>;
  readonly deadHand: Readonly<Record<NationId, number>>;
  readonly nuclearRisk: Readonly<Record<NationId, number>>;
  // Contested tiles each nation holds (J5), and its tiles on the first day.
  readonly contested: Readonly<Record<NationId, number>>;
  readonly initialTiles: Readonly<Record<NationId, number>>;
  // What the structures built on the map cost each budget last month (US$).
  readonly constructionCost: Readonly<Record<NationId, number>>;
  // Casus belli the player could invoke against each other nation.
  readonly casusBelli: Readonly<Record<NationId, readonly string[]>>;
  // The political engine (J4): projected shares of the player's next
  // election (levers applied, no draw), the pinned objectives and notes.
  readonly electionProjection: Readonly<Record<string, number>> | null;
  readonly objectives: readonly Readonly<PinnedObjective>[];
  readonly notes: readonly Readonly<{ date: string; text: string }>[];
}

export interface TileGrid {
  width: number;
  height: number;
  // See TILE_NATION_MASK / TILE_FALLOUT_BIT in data/schemas/saveV1.ts.
  tiles: Uint16Array;
  // Contest of each tile (sim/war/contest.ts), since v5; absent in a grid
  // made from an older save, where the contested bit of `tiles` is all
  // there is.
  contest?: Uint16Array;
}

// Geometry of a front as the world computes it (J3a): the simulation reasons
// in segments, never in tiles.
export interface FrontGeometry {
  id: string; // "A|B", ids sorted
  a: NationId;
  b: NationId;
  segments: readonly SegmentGeometry[];
}
export interface SegmentGeometry {
  index: number;
  tiles: number;
  terrain: { plains: number; highland: number; mountain: number }; // shares
  // Multiplier of the structures (defence posts, cities) each side holds on
  // its tiles of the segment.
  defense: Record<NationId, number>;
  // Ports and cities of each side near the segment (logistics, J3b).
  supply: Record<NationId, number>;
}

// The sea as the world sees it today (J3b): zones each nation touches from
// its coast and from its ports, and the warships present in each zone.
export interface NavalSnapshot {
  coast: Record<NationId, string[]>;
  ports: Record<NationId, string[]>;
  ships: Record<string, Record<NationId, number>>;
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
  // Fronts between the given pairs of belligerents, cut into segments of
  // about `segmentTiles` tiles. Pairs without a common border are omitted.
  fronts(
    pairs: readonly [NationId, NationId][],
    segmentTiles: number,
  ): FrontGeometry[];
  // Takes up to `tiles` tiles of `loser` for `winner` along a segment of the
  // last computed geometry of the front; returns how many were taken. Taken
  // tiles are tagged contested.
  advance(
    front: string,
    segment: number,
    winner: NationId,
    loser: NationId,
    tiles: number,
  ): number;
  // Annexation: every tile of `from` goes to `to`, tagged contested.
  transferAll(from: NationId, to: NationId): number;
  // The sea today (computed by the world, cached for the day).
  naval(): NavalSnapshot;
  // Zone of the tile a landing of `attacker` on `target` would aim at (an
  // enemy port, else the nearest enemy shore); null when there is none.
  landingZone(attacker: NationId, target: NationId): string | null;
  // Sends the landing: a transport that takes a beachhead of `radius` tiles
  // around the landing tile when it arrives. False when it cannot sail.
  launchLanding(attacker: NationId, target: NationId, radius: number): boolean;
  // Contest of the tiles (J5, sim/war/contest.ts). The month is counted from
  // the start of the campaign; the simulation sets it before any capture.
  setMonth(month: number): void;
  // Contested tiles each nation holds.
  contestedCounts(): ReadonlyMap<NationId, number>;
  // A treaty cedes to `winner` the contested tiles it holds.
  cede(winner: NationId): number;
  // Contests older than their delay end; returns how many.
  settleContested(warMonths: number, cessionMonths: number): number;
  // Structures each nation has on the map, levels summed, by OpenFront unit
  // type (J5: what it builds is paid by its budget).
  structureCounts(): ReadonlyMap<NationId, Record<string, number>>;
  // Nuclear weapons (J5). A warhead of `by` towards `target`, from a silo near
  // its capital (built if it has none); false when the world cannot launch
  // it. Its outcome comes later, through nukeOutcomes().
  launchNuke(
    id: number,
    by: NationId,
    target: NationId,
    aim: NukeAim,
    weapon: "atom" | "hydrogen",
  ): boolean;
  // Launches resolved since the last call: tiles hit by nation, or
  // intercepted, or never launched.
  nukeOutcomes(): NukeOutcome[];
  // Does the nation still hold its capital?
  capitalHeld(nation: NationId): boolean;
  // Tiles from the capital of the nation to the nearest front it fights on
  // (last computed geometry); null without a front.
  capitalFrontDistance(nation: NationId): number | null;
}

export type NukeAim =
  | { kind: "front"; front: string; segment: number }
  | { kind: "capital" }
  | { kind: "city"; index: number };

export interface NukeOutcome {
  id: number;
  status: "detonated" | "intercepted" | "failed";
  hits: Record<NationId, number>;
}

export { NationIdSchema };
