import { NationId } from "../data/schemas/common";
import { EncodedSaveStats } from "../save/serialize";
import type { IntelLevels, IntelRules } from "../sim/intel/intel";
import {
  FrontView,
  HudView,
  JournalQuery,
  MapColors,
  PlayerCommand,
  ReadonlyWorldView,
  SimEvent,
} from "../sim/VeritableSim";
import type { MapOverlay } from "./CoreBridge";

// Typed payloads carried by the generic `veritable_request` /
// `veritable_response` / `veritable_events` worker messages of src/core/worker.
// The simulation lives in the worker, next to the GameRunner; the client talks
// to it through RemoteVeritableSim.

export type VeritableRequest =
  // J7: `since`: the version the client already has (null back when the
  // view has not changed); `embargoesOf`: the embargoes of these nations
  // only (7 500 of them at 208 nations, the costliest part to copy).
  | { kind: "read"; since?: number; embargoesOf?: NationId[] }
  // J7: the always-visible interface (top bar, event cards), with the
  // journal entries added since the mark of the previous one.
  | { kind: "hud"; journalSince?: number }
  // J7: the journal screen, filtered.
  | { kind: "journal"; query: JournalQuery }
  // J7b: what lies under a point of the map (the card, the action menu).
  | { kind: "tile"; tile: number }
  // J7b: what a declaration of war of the player would bring down.
  | { kind: "war-preview"; target: NationId; casusBelli: string }
  // J7b: what the modes of the map colour the nations by.
  | { kind: "map-colors" }
  | { kind: "apply"; command: PlayerCommand }
  | { kind: "snapshot" }
  | { kind: "perf" }
  // The fronts on the map (J5): geometry of the segments, their last
  // resolution, the contested tiles when they changed since the version.
  | {
      kind: "map-overlay";
      contestedVersion: number;
      // J7c: the version of the contamination the page has.
      contaminationVersion?: number;
    };

export interface MapOverlayResult {
  overlay: MapOverlay;
  fronts: FrontView[];
  player: NationId | null;
  // J7c: the bursts whose ground zero is still contaminated (an icon at
  // every zoom: a burst covers a few tiles of the world map).
  bursts: { x: number; y: number; weapon: string; date: string }[];
  // J7b: what the player's intelligence needs to show the forces of the
  // fronts (perceive): the seed, the date, its levels on the nations at
  // war, the rules.
  intel: {
    seed: number;
    date: string;
    levels: Record<NationId, IntelLevels>;
    rules: IntelRules;
  };
}

// The modes of the map (J7b): the colours of the simulation and the id of
// each nation in the core (the palette of the renderer is indexed by it).
export interface MapColorsResult {
  colors: MapColors;
  smallIds: Record<NationId, number>;
}

// A tile of the map as the interface asks about it (J7b).
export interface TileInfo {
  tile: number;
  land: boolean;
  owner: NationId | null;
  contested: boolean;
  zone: string | null; // the sea zone of a water tile
}

export interface SnapshotResult {
  bytes: Uint8Array; // encoded .vsave
  stats: EncodedSaveStats;
  gameDate: string;
}

export type VeritableResult<R extends VeritableRequest> = R extends {
  kind: "read";
}
  ? ReadonlyWorldView | null
  : R extends { kind: "hud" }
    ? HudView
    : R extends { kind: "snapshot" }
      ? SnapshotResult
      : null;

export type VeritableEvents = SimEvent[];
