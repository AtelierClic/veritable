import {
  PlayerCommand,
  ReadonlyWorldView,
  SimEvent,
} from "../sim/VeritableSim";
import { SnapshotResult, VeritableRequest } from "./protocol";

// What RemoteVeritableSim needs from src/core/worker/WorkerClient.
export interface VeritableWorkerChannel {
  veritableRequest(request: unknown): Promise<unknown>;
  onVeritableEvents?: (events: unknown[]) => void;
}

// Client-side handle on the VeritableSim that runs in the game worker. Same
// operations as the VeritableSim interface, asynchronous because they cross
// the worker boundary. `advance` is absent on purpose: the worker advances
// the simulation with the core ticks; the client never drives time directly.
export class RemoteVeritableSim {
  private listeners = new Set<(events: SimEvent[]) => void>();

  constructor(private readonly channel: VeritableWorkerChannel) {
    channel.onVeritableEvents = (events) => {
      for (const listener of this.listeners) listener(events as SimEvent[]);
    };
  }

  private request(request: VeritableRequest): Promise<unknown> {
    return this.channel.veritableRequest(request);
  }

  read(): Promise<ReadonlyWorldView> {
    return this.request({ kind: "read" }) as Promise<ReadonlyWorldView>;
  }

  async apply(command: PlayerCommand): Promise<void> {
    await this.request({ kind: "apply", command });
  }

  // Encoded .vsave of the campaign as it is now.
  snapshot(): Promise<SnapshotResult> {
    return this.request({ kind: "snapshot" }) as Promise<SnapshotResult>;
  }

  onEvents(listener: (events: SimEvent[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
