import { Config } from "../../src/core/configuration/Config";
import { Executor } from "../../src/core/execution/ExecutionManager";
import { PlayerExecution } from "../../src/core/execution/PlayerExecution";
import { WinCheckExecution } from "../../src/core/execution/WinCheckExecution";
import {
  Game,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
} from "../../src/core/game/Game";
import { GameImpl } from "../../src/core/game/GameImpl";
import { GameRunner } from "../../src/core/GameRunner";
import { GameConfig } from "../../src/core/Schemas";
import { setup } from "../util/Setup";
import { executeTicks } from "../util/utils";

// VERITABLE: tests of every src/core change made for Véritable. All of them
// sit behind GameConfig.veritable; the OpenFront behaviour is the control.

const humans = () => [
  new PlayerInfo("state", PlayerType.Human, "client_id1", "state_id"),
  new PlayerInfo("rival", PlayerType.Human, "client_id2", "rival_id"),
];

async function twoPlayerGame(veritable: boolean) {
  const game = await setup(
    "big_plains",
    { veritable, infiniteGold: false, instantBuild: true },
    humans(),
    undefined,
  );
  const state = game.player("state_id");
  const rival = game.player("rival_id");
  const home = [game.ref(50, 50), game.ref(51, 50), game.ref(52, 50)];
  home.forEach((t) => state.conquer(t));
  state.setSpawnTile(home[0]);
  rival.conquer(game.ref(60, 60));
  rival.setSpawnTile(game.ref(60, 60));
  game.addExecution(new PlayerExecution(state), new PlayerExecution(rival));
  executeTicks(game, 2);
  return { game, state, rival, home };
}

function annex(victim: Player, by: Player) {
  for (const t of [...victim.tiles()]) by.conquer(t);
}

describe("Véritable: no elimination at zero tiles", () => {
  it("a nation that loses every tile stays alive, keeps its assets and can return", async () => {
    const { game, state, rival, home } = await twoPlayerGame(true);
    state.addGold(1000n);
    const goldBefore = state.gold();

    annex(state, rival);
    executeTicks(game, 50);

    expect(state.numTilesOwned()).toBe(0);
    expect(state.isAlive()).toBe(true);
    expect(game.players()).toContain(state);
    expect(state.gold()).toBeGreaterThanOrEqual(goldBefore);

    // Its PlayerExecution is still running: it can take territory back and
    // behaves like any other player afterwards.
    state.conquer(home[0]);
    const troops = state.troops();
    executeTicks(game, 20);
    expect(state.numTilesOwned()).toBe(1);
    expect(state.troops()).toBeGreaterThan(troops);
  });

  it("control: without the flag OpenFront still eliminates at zero tiles", async () => {
    const { game, state, rival } = await twoPlayerGame(false);
    state.addGold(1000n);
    annex(state, rival);
    executeTicks(game, 5);

    expect(state.isAlive()).toBe(false);
    expect(game.players()).not.toContain(state);
    expect(state.gold()).toBe(0n);
  });

  it("a player that never entered the world is not alive", async () => {
    const game = await setup("big_plains", { veritable: true }, humans());
    expect(game.player("state_id").isAlive()).toBe(false);
    expect(game.players()).toHaveLength(0);
  });

  it("bots are map fill, not nations: they still die", async () => {
    const game = await setup("big_plains", { veritable: true }, [
      new PlayerInfo("tribe", PlayerType.Bot, null, "bot_id"),
      ...humans(),
    ]);
    const bot = game.player("bot_id");
    const rival = game.player("rival_id");
    bot.conquer(game.ref(10, 10));
    bot.setSpawnTile(game.ref(10, 10));
    expect(bot.isAlive()).toBe(true);
    annex(bot, rival);
    expect(bot.isAlive()).toBe(false);
  });
});

describe("Véritable: no win condition, no timer, no 170-minute cap, no Overtime", () => {
  async function dominatedGame(veritable: boolean) {
    const game = await setup(
      "big_plains",
      { veritable, maxTimerValue: 1, overtime: { enabled: true } },
      humans(),
    );
    const state = game.player("state_id");
    state.setSpawnTile(game.ref(50, 50));
    game.forEachTile((t) => {
      if (game.isLand(t) && !game.isImpassable(t)) state.conquer(t);
    });
    return game;
  }

  function runWinCheck(game: Game, elapsedSeconds: number) {
    const mg = game as any;
    mg.elapsedGameSeconds = () => elapsedSeconds;
    const setWinner = vi.spyOn(mg, "setWinner");
    const winCheck = new WinCheckExecution();
    winCheck.init(game, 0);
    winCheck.tick(10);
    return { winCheck, setWinner };
  }

  it("never declares a winner, even owning the whole map after 171 minutes", async () => {
    const game = await dominatedGame(true);
    const { winCheck, setWinner } = runWinCheck(game, 171 * 60);
    expect(setWinner).not.toHaveBeenCalled();
    expect(winCheck.isActive()).toBe(false);
    expect(game.getWinner()).toBeNull();
  });

  it("control: without the flag the same situation is won", async () => {
    const game = await dominatedGame(false);
    const { setWinner } = runWinCheck(game, 171 * 60);
    expect(setWinner).toHaveBeenCalled();
  });

  it("GameRunner does not register the win check in a campaign", async () => {
    for (const veritable of [true, false]) {
      const game = await setup(
        "big_plains",
        { veritable, gameType: GameType.Singleplayer },
        humans(),
      );
      const runner = new GameRunner(
        game,
        new Executor(game, "game_id", undefined),
        () => {},
      );
      runner.init();
      executeTicks(game, 1);
      const hasWinCheck = (game as unknown as GameImpl)
        .executions()
        .some((e) => e instanceof WinCheckExecution);
      expect(hasWinCheck).toBe(!veritable);
    }
  });

  it("Overtime cannot be enabled and the win threshold never shrinks", () => {
    const base = {
      overtime: { enabled: true, startMinutes: 1 },
    } as unknown as GameConfig;
    const campaign = new Config({ ...base, veritable: true }, null, false);
    const legacy = new Config(base, null, false);

    expect(campaign.isVeritable()).toBe(true);
    expect(legacy.isVeritable()).toBe(false);
    expect(campaign.overtimeConfig().enabled).toBe(false);
    expect(legacy.overtimeConfig().enabled).toBe(true);
    expect(campaign.percentageTilesOwnedToWin(100 * 60)).toBe(
      campaign.percentageTilesOwnedToWin(0),
    );
    expect(legacy.percentageTilesOwnedToWin(100 * 60)).toBeLessThan(
      legacy.percentageTilesOwnedToWin(0),
    );
  });
});
