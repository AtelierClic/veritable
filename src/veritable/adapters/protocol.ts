import { NationId } from "../data/schemas/common";
import { EncodedSaveStats } from "../save/serialize";
import {
  FrontView,
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
  | { kind: "read" }
  | { kind: "apply"; command: PlayerCommand }
  | { kind: "snapshot" }
  | { kind: "perf" }
  // The fronts on the map (J5): geometry of the segments, their last
  // resolution, the contested tiles when they changed since the version.
  | { kind: "map-overlay"; contestedVersion: number };

export interface MapOverlayResult {
  overlay: MapOverlay;
  fronts: FrontView[];
  player: NationId | null;
}

export interface SnapshotResult {
  bytes: Uint8Array; // encoded .vsave
  stats: EncodedSaveStats;
  gameDate: string;
}

export type VeritableResult<R extends VeritableRequest> = R extends {
  kind: "read";
}
  ? ReadonlyWorldView
  : R extends { kind: "snapshot" }
    ? SnapshotResult
    : null;

export type VeritableEvents = SimEvent[];
