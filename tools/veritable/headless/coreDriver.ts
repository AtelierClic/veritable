import fs from "fs";
import path from "path";
import { Config } from "../../../src/core/configuration/Config";
import { Executor } from "../../../src/core/execution/ExecutionManager";
import {
  Difficulty,
  GameMapSize,
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "../../../src/core/game/Game";
import { createGame } from "../../../src/core/game/GameImpl";
import { genTerrainFromBin } from "../../../src/core/game/TerrainMapLoader";
import { UserSettings } from "../../../src/core/game/UserSettings";
import { GameRunner } from "../../../src/core/GameRunner";
import { PseudoRandom } from "../../../src/core/PseudoRandom";
import { GameConfig } from "../../../src/core/Schemas";
import { simpleHash } from "../../../src/core/Util";
import { gameMapOf } from "../../../src/veritable/adapters/scenarioMap";
import {
  coreRoster,
  ScenarioPack,
} from "../../../src/veritable/adapters/scenarioWorld";
import { VeritableSession } from "../../../src/veritable/adapters/VeritableSession";
import { VeritableConfig } from "../../../src/veritable/data/schemas/config";
import { SimEvent } from "../../../src/veritable/sim/VeritableSim";
import { Driver } from "./campaign";

// The campaign on the OpenFront core, on the real map of the scenario: the
// same VeritableSession as the game worker, ticked twenty times per game day
// (72 game minutes per tick). Fronts move tiles, landings sail.

const MAPS = path.resolve(
  path.dirname(
    new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  ),
  "../../../resources/maps",
);

export async function coreDriver(
  pack: ScenarioPack,
  config: VeritableConfig,
  seed: number,
  player: string,
  autopilot: boolean,
  // J6: the duration of every tick (core + simulation), for the profiles.
  onTick?: (ms: number) => void,
): Promise<Driver> {
  const dir = path.join(MAPS, pack.scenario.map);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
  );
  const map = await genTerrainFromBin(
    manifest.map,
    fs.readFileSync(path.join(dir, "map.bin")),
  );
  const mini = await genTerrainFromBin(
    manifest.map4x,
    fs.readFileSync(path.join(dir, "map4x.bin")),
  );
  const gameID = `headless-${seed}`;
  const gameConfig: GameConfig = {
    gameMap: gameMapOf(pack.scenario.map),
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
    difficulty: Difficulty.Medium,
    nations: "disabled",
    donateGold: false,
    donateTroops: false,
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    veritable: true,
    veritableScenario: pack.scenario.id,
    veritablePlayerNation: player,
  };
  const coreStart = {
    gameID,
    lobbyCreatedAt: 0,
    players: [
      { clientID: "headless", username: player, clanTag: null, cosmetics: {} },
    ],
    config: gameConfig,
  };
  const random = new PseudoRandom(simpleHash(gameID));
  const game = createGame(
    [
      new PlayerInfo(
        player,
        PlayerType.Human,
        "headless",
        random.nextID(),
        false,
        null,
        [],
        null,
        null,
        player,
      ),
    ],
    coreRoster(pack, player)(random),
    map,
    mini,
    new Config(gameConfig, new UserSettings(), false),
  );
  const session = VeritableSession.create(game, {
    coreStart,
    pack,
    config,
    autopilot,
  });
  new GameRunner(game, new Executor(game, gameID, undefined), () => {}).init();
  // The first ticks load the scenario; campaign time starts with the first
  // tick that advances the simulation, which belongs to the first day.
  // J6c: a tick as the GameRunner of the game runs it, with the buffers of
  // packed updates emptied every tick (the renderer's side). Left full, the
  // player updates of 208 nations outgrew the longest array V8 allows after
  // about thirty years of the world, and every headless heap measure grew
  // with them.
  const tick = () => {
    game.executeNextTick();
    game.drainPackedTileUpdates();
    game.drainPackedMotionPlans();
    game.drainPackedPlayerUpdates();
    game.drainPackedAttackUpdates();
    game.drainNukeImpacts();
  };
  let pending: SimEvent[] = [];
  while (session.sim.read().elapsedGameMinutes === 0) {
    tick();
    pending = session.onCoreTick();
  }
  let ticksIntoDay = 1;
  const ticksPerDay = Math.round((24 * 60) / config.time.gameMinutesPerTick);
  let coreMs = 0;
  let coreTicks = 0;
  return {
    read: () => session.sim.read(),
    apply: (command) => session.sim.apply(command),
    advanceDay: () => {
      const events: SimEvent[] = pending;
      pending = [];
      for (let i = ticksIntoDay; i < ticksPerDay; i++) {
        const t0 = performance.now();
        tick();
        const t1 = performance.now();
        coreMs += t1 - t0;
        coreTicks++;
        events.push(...session.onCoreTick());
        onTick?.(performance.now() - t0);
      }
      ticksIntoDay = 0;
      return events;
    },
    perf: () => ({
      ...Object.fromEntries(
        Object.entries(session.perf()).map(([k, v]) => [
          k,
          { calls: v.calls, totalMs: v.totalMs, maxMs: v.maxMs },
        ]),
      ),
      "core:tick": { calls: coreTicks, totalMs: coreMs },
    }),
    snapshot: () => session.snapshot().bytes,
    sim: session.sim,
  };
}
