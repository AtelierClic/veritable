import { EncodedSaveStats } from "../save/serialize";
import {
  PlayerCommand,
  ReadonlyWorldView,
  SimEvent,
} from "../sim/VeritableSim";

// Typed payloads carried by the generic `veritable_request` /
// `veritable_response` / `veritable_events` worker messages of src/core/worker.
// The simulation lives in the worker, next to the GameRunner; the client talks
// to it through RemoteVeritableSim.

export type VeritableRequest =
  | { kind: "read" }
  | { kind: "apply"; command: PlayerCommand }
  | { kind: "snapshot" }
  | { kind: "perf" };

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
