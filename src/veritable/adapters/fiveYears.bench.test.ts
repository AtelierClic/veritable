import fs from "fs";
import path from "path";
import { TestConfig } from "../../../tests/util/TestConfig";
import { Executor } from "../../core/execution/ExecutionManager";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "../../core/game/Game";
import { createGame } from "../../core/game/GameImpl";
import { genTerrainFromBin } from "../../core/game/TerrainMapLoader";
import { UserSettings } from "../../core/game/UserSettings";
import { GameRunner } from "../../core/GameRunner";
import { PseudoRandom } from "../../core/PseudoRandom";
import { decodeSave } from "../save/serialize";
import { loadScenarioPack } from "./scenarioPack";
import { coreRoster } from "./scenarioWorld";
import { VeritableSession } from "./VeritableSession";

// Opt-in measurement (VERITABLE_BENCH=1): five game years of europe-10 on the
// real Europe map, core + simulation, no rendering. x5 needs 50 ticks/s, i.e.
// a tick budget of 20 ms.
const enabled = process.env.VERITABLE_BENCH === "1";

describe.runIf(enabled)("bench: five game years on the Europe map", () => {
  it("plays 2026-01-01 -> 2031-01-01, saves, reloads", async () => {
    const dir = path.join(__dirname, "../../../resources/maps/europe");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
    );
    const load = async () => ({
      map: await genTerrainFromBin(
        manifest.map,
        fs.readFileSync(path.join(dir, "map.bin")),
      ),
      mini: await genTerrainFromBin(
        manifest.map4x,
        fs.readFileSync(path.join(dir, "map4x.bin")),
      ),
    });
    const pack = await loadScenarioPack("europe-10");
    const coreStart = {
      gameID: "bench",
      config: { veritablePlayerNation: "FRA" },
    };
    const config = () =>
      new TestConfig(
        {
          gameMap: GameMapType.Europe,
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
        },
        new UserSettings(),
        false,
      );
    const start = async (saveBytes?: Uint8Array) => {
      const { map, mini } = await load();
      const game = createGame(
        [new PlayerInfo("France", PlayerType.Human, "c1", "human_id")],
        coreRoster(pack, "FRA")(new PseudoRandom(3)),
        map,
        mini,
        config(),
      );
      const session = VeritableSession.create(game, {
        coreStart,
        pack,
        saveBytes,
      });
      new GameRunner(game, new Executor(game, "bench", undefined), () => {}).init();
      return { game, session };
    };

    const { game, session } = await start();
    const durations: number[] = [];
    let months = 0;
    while (session.sim.read().date < "2031-01-01") {
      const t0 = performance.now();
      game.executeNextTick();
      for (const e of session.onCoreTick()) {
        if (e.type === "month-started") months++;
      }
      durations.push(performance.now() - t0);
    }
    const play = durations.slice(2); // the first two ticks load the scenario
    const sorted = [...play].sort((a, b) => a - b);
    const total = play.reduce((a, b) => a + b, 0);

    const t0 = performance.now();
    const saved = session.snapshot();
    const saveMs = performance.now() - t0;
    const reloaded = await start(saved.bytes);
    const t1 = performance.now();
    reloaded.game.executeNextTick();
    reloaded.session.onCoreTick();
    reloaded.game.executeNextTick();
    reloaded.session.onCoreTick();
    const reloadMs = performance.now() - t1;
    expect(reloaded.session.snapshot().bytes).toEqual(saved.bytes);
    expect(decodeSave(saved.bytes).calendar.date).toBe("2031-01-01");
    expect(months).toBe(60);
    expect(session.sim.read().nations.every((n) => n.status === "active")).toBe(
      true,
    );

    const result = {
      ticks: play.length,
      gameDays: play.length / 20,
      loadScenarioMs: Math.round(durations[0] + durations[1]),
      meanTickMs: +(total / play.length).toFixed(3),
      p50TickMs: +sorted[Math.floor(sorted.length * 0.5)].toFixed(3),
      p99TickMs: +sorted[Math.floor(sorted.length * 0.99)].toFixed(3),
      maxTickMs: +sorted[sorted.length - 1].toFixed(3),
      tickBudgetAtX5Ms: 20,
      saveMs: Math.round(saveMs),
      saveBytes: saved.bytes.length,
      tileBlockBytes: saved.stats.tileBytes,
      reloadMs: Math.round(reloadMs),
      perf: session.perf(),
    };
    fs.writeFileSync(
      path.join(__dirname, "../../../tools/veritable/borders/cache/bench.json"),
      JSON.stringify(result, null, 2),
    );
  }, 1_800_000);
});
