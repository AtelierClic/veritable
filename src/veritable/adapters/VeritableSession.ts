import { Game } from "../../core/game/Game";
import { simpleHash } from "../../core/Util";
import { loadVeritableConfig } from "../data/loadConfig";
import { VeritableConfig } from "../data/schemas/config";
import { decodeSave, encodeSaveWithStats } from "../save/serialize";
import { SimEvent, VeritableSim } from "../sim/VeritableSim";
import { VeritableSimImpl } from "../sim/VeritableSimImpl";
import { CoreBridge } from "./CoreBridge";
import { DomainTiming, PerformanceProbe } from "./perfProbe";
import { SnapshotResult, VeritableRequest } from "./protocol";
import {
  bindScenario,
  initialWorld,
  playerNationOf,
  ScenarioPack,
  unclaimableMask,
} from "./scenarioWorld";

export interface SessionOptions {
  // Whatever recreates this exact core game (OpenFront GameStartInfo).
  coreStart: { gameID: string; config: { veritablePlayerNation?: string } };
  pack: ScenarioPack;
  // Encoded .vsave made in the same scenario, when loading a campaign.
  saveBytes?: Uint8Array;
  config?: VeritableConfig;
  // Nobody plays: the AI fiscal rule also runs the player's nation.
  autopilot?: boolean;
}

// One Véritable campaign running next to one OpenFront core game. Used by the
// game worker (client) and, from J2, by the headless runner: both go through
// the same VeritableSim interface.
export class VeritableSession {
  private constructor(
    readonly sim: VeritableSim,
    private readonly game: Game,
    private readonly bridge: CoreBridge,
    private readonly config: VeritableConfig,
    private readonly probe: PerformanceProbe,
  ) {}

  // Must be called before the core registers its executions: the world is put
  // in place (scenario borders, or a save) by an execution that has to run
  // first.
  static create(game: Game, options: SessionOptions): VeritableSession {
    const { coreStart, pack, saveBytes } = options;
    const config = options.config ?? loadVeritableConfig();
    const playerNation = playerNationOf(
      pack,
      coreStart.config.veritablePlayerNation,
    );
    // First: it checks that the scenario was rasterized for this very map.
    game.setUnclaimableTiles(unclaimableMask(game, pack));
    const bindings = bindScenario(game, pack, playerNation);
    const bridge = new CoreBridge(game, bindings, coreStart);

    const probe = new PerformanceProbe();
    const nationData = (id: string) => pack.nations.find((n) => n.id === id);
    const sim = new VeritableSimImpl({
      config,
      world: bridge,
      data: pack.data,
      nationData,
      perf: probe,
      autopilot: options.autopilot,
    });
    if (saveBytes !== undefined) {
      sim.restore(
        decodeSave(saveBytes, {
          context: { config, data: pack.data, nationData },
        }),
      );
    } else {
      // A new campaign is the first day of the scenario applied like a save:
      // the nations hold their borders before the first advance, so none of
      // them ever starts "exiled".
      const first = initialWorld(game, pack, bindings, coreStart);
      bridge.restore(pack.scenario.nations, first.world, first.grid);
      sim.init(
        { ...pack.scenario, playerDefault: playerNation },
        simpleHash(coreStart.gameID),
      );
    }
    return new VeritableSession(sim, game, bridge, config, probe);
  }

  // Called once after every core tick. Campaign time only flows once the
  // world is in place.
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
      case "perf":
        return this.perf();
    }
  }

  snapshot(): SnapshotResult {
    const save = this.sim.snapshot();
    const { bytes, stats } = encodeSaveWithStats(save);
    return { bytes, stats, gameDate: save.calendar.date };
  }

  perf(): Record<string, DomainTiming> {
    return this.probe.report();
  }
}
