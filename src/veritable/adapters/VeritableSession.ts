import { Game } from "../../core/game/Game";
import { simpleHash } from "../../core/Util";
import { loadVeritableConfig } from "../data/loadConfig";
import { VeritableConfig } from "../data/schemas/config";
import { decodeSave, encodeSaveWithStats } from "../save/serialize";
import { SimEvent, VeritableSim } from "../sim/VeritableSim";
import { VeritableSimImpl } from "../sim/VeritableSimImpl";
import { CoreBridge } from "./CoreBridge";
import { bindNations, scenarioFromCoreGame } from "./coreScenario";
import { SnapshotResult, VeritableRequest } from "./protocol";

// One Véritable campaign running next to one OpenFront core game. Used by the
// game worker (client) and, from J2, by the headless runner: both go through
// the same VeritableSim interface.
export class VeritableSession {
  private constructor(
    readonly sim: VeritableSim,
    private readonly game: Game,
    private readonly bridge: CoreBridge,
    private readonly config: VeritableConfig,
  ) {}

  // `coreStart` is whatever recreates this exact core game (GameStartInfo).
  // `saveBytes`, when given, is a .vsave produced from the same coreStart.
  static create(
    game: Game,
    coreStart: { gameID: string },
    saveBytes?: Uint8Array,
    config: VeritableConfig = loadVeritableConfig(),
  ): VeritableSession {
    const bindings = bindNations(game);
    const bridge = new CoreBridge(game, bindings, coreStart);
    const sim = new VeritableSimImpl({ config, world: bridge });
    if (saveBytes !== undefined) {
      sim.restore(decodeSave(saveBytes));
    } else {
      sim.init(
        scenarioFromCoreGame(game, bindings, config.time.defaultStartDate),
        simpleHash(coreStart.gameID),
      );
    }
    return new VeritableSession(sim, game, bridge, config);
  }

  // Called once after every core tick. Campaign time only flows once the
  // world exists: not during the spawn phase, not before a pending restore.
  onCoreTick(): SimEvent[] {
    if (
      this.game.inSpawnPhase() ||
      this.bridge.hasPendingRestore() ||
      this.bridge.restoredDuringLastTick()
    ) {
      return [];
    }
    return this.sim.advance(this.config.time.gameMinutesPerTick);
  }

  handle(request: VeritableRequest): unknown {
    switch (request.kind) {
      case "read":
        return this.sim.read();
      case "apply":
        this.sim.apply(request.command);
        return null;
      case "snapshot":
        return this.snapshot();
    }
  }

  snapshot(): SnapshotResult {
    const save = this.sim.snapshot();
    const { bytes, stats } = encodeSaveWithStats(save);
    return { bytes, stats, gameDate: save.calendar.date };
  }
}
