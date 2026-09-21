import path from "path";
import { setup } from "../../../tests/util/Setup";
import { Executor } from "../../core/execution/ExecutionManager";
import { SpawnExecution } from "../../core/execution/SpawnExecution";
import {
  Cell,
  Game,
  Nation,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../core/game/Game";
import { GameRunner } from "../../core/GameRunner";
import { decodeSave } from "../save/serialize";
import { VeritableSession } from "./VeritableSession";

// Integration: a real OpenFront core game + the Véritable simulation.

const CORE_START = {
  gameID: "j0-test-game",
  config: { gameMap: "big_plains" },
};
const SETUP_DIR = path.join(__dirname, "../../../tests/util");

function newCoreGame(autoEndSpawnPhase = true): Promise<Game> {
  return setup(
    "big_plains",
    { veritable: true, instantBuild: true },
    [new PlayerInfo("L'État", PlayerType.Human, "client_1", "human_id")],
    SETUP_DIR,
    undefined,
    autoEndSpawnPhase,
    [
      new Nation(
        new Cell(120, 60),
        new PlayerInfo("Syldavie", PlayerType.Nation, null, "syl_id"),
      ),
      new Nation(
        new Cell(60, 120),
        new PlayerInfo("Bordurie", PlayerType.Nation, null, "bor_id"),
      ),
    ],
  );
}

function tick(game: Game, session: VeritableSession, n = 1) {
  const events = [];
  for (let i = 0; i < n; i++) {
    game.executeNextTick();
    events.push(...session.onCoreTick());
  }
  return events;
}

function claimBlock(
  game: Game,
  id: string,
  x0: number,
  y0: number,
  size: number,
) {
  const player = game.player(id);
  for (let x = x0; x < x0 + size; x++) {
    for (let y = y0; y < y0 + size; y++) player.conquer(game.ref(x, y));
  }
  player.setSpawnTile(game.ref(x0, y0));
  return player;
}

async function playedCampaign() {
  const game = await newCoreGame();
  const session = VeritableSession.create(game, CORE_START);
  const human = claimBlock(game, "human_id", 40, 40, 12);
  const syldavie = claimBlock(game, "syl_id", 120, 60, 8);
  const bordurie = claimBlock(game, "bor_id", 60, 120, 6);

  const city = human.buildUnit(UnitType.City, game.ref(42, 42), {});
  city.increaseLevel();
  human.buildUnit(UnitType.DefensePost, game.ref(45, 45), {});
  syldavie.buildUnit(UnitType.City, game.ref(121, 61), {});
  human.addGold(123_456n);
  game.setFallout(game.ref(10, 10), true);
  game.setFallout(game.ref(11, 10), true);
  tick(game, session, 30);

  // Bordurie is annexed down to its last tile.
  for (const t of [...bordurie.tiles()]) human.conquer(t);
  const events = tick(game, session, 5);
  return { game, session, events };
}

describe("VeritableSession on a real core game", () => {
  it("binds the roster to nations with stable ids", async () => {
    const game = await newCoreGame();
    const view = VeritableSession.create(game, CORE_START).sim.read();
    expect(view.nations.map((n) => n.id)).toEqual([
      "player",
      "syldavie",
      "bordurie",
    ]);
    expect(view.playerNation).toBe("player");
    expect(view.nations[0].name).toEqual({ kind: "literal", text: "L'État" });
    expect(view.date).toBe("2026-01-01");
  });

  it("campaign time follows core ticks (72 game minutes each)", async () => {
    const game = await newCoreGame();
    const session = VeritableSession.create(game, CORE_START);
    claimBlock(game, "human_id", 40, 40, 4);
    tick(game, session, 20);
    expect(session.sim.read().elapsedGameMinutes).toBe(20 * 72);
    expect(session.sim.read().date).toBe("2026-01-02");
  });

  it("an annexed nation survives with zero tiles, in the core and in the sim", async () => {
    const { game, session, events } = await playedCampaign();
    expect(events).toMatchObject([
      { type: "nation-status-changed", nation: "bordurie", to: "exiled" },
    ]);

    tick(game, session, 200);
    const bordurie = session.sim
      .read()
      .nations.find((n) => n.id === "bordurie")!;
    expect(bordurie.tileCount).toBe(0);
    expect(bordurie.status).toBe("exiled");
    expect(game.player("bor_id").isAlive()).toBe(true);
    expect(game.players().map((p) => p.id())).toContain("bor_id");
  });

  it("save -> reload in a fresh core game -> save gives the same bytes", async () => {
    const { session } = await playedCampaign();
    const saved = session.snapshot();

    const game2 = await newCoreGame();
    const session2 = VeritableSession.create(game2, CORE_START, saved.bytes);
    // Before the restore tick the world is the pending save itself.
    expect(session2.snapshot().bytes).toEqual(saved.bytes);

    // The restore is applied inside the second core tick (the first one
    // initializes the execution); neither is campaign time.
    tick(game2, session2, 2);
    expect(game2.inSpawnPhase()).toBe(false);
    expect(session2.snapshot().bytes).toEqual(saved.bytes);
    expect(session2.sim.read()).toEqual(session.sim.read());
  });

  it("the reloaded core game really holds the saved world", async () => {
    const { game, session } = await playedCampaign();
    const saved = session.snapshot();
    const game2 = await newCoreGame();
    const session2 = VeritableSession.create(game2, CORE_START, saved.bytes);
    tick(game2, session2, 2);

    for (const id of ["human_id", "syl_id", "bor_id"]) {
      const before = game.player(id);
      const after = game2.player(id);
      expect(after.numTilesOwned()).toBe(before.numTilesOwned());
      expect(after.troops()).toBe(before.troops());
      expect(after.gold()).toBe(before.gold());
      expect(after.spawnTile()).toBe(before.spawnTile());
    }
    const human = game2.player("human_id");
    expect(game2.owner(game2.ref(60, 120))).toBe(human); // annexed land
    expect(human.units(UnitType.City)).toHaveLength(1);
    expect(human.units(UnitType.City)[0].level()).toBe(2);
    expect(human.units(UnitType.DefensePost)).toHaveLength(1);
    expect(game2.hasFallout(game2.ref(10, 10))).toBe(true);
    expect(game2.hasFallout(game2.ref(12, 10))).toBe(false);
    expect(game2.player("bor_id").isAlive()).toBe(true);

    // And it keeps running: time flows, income comes in, the exile persists.
    const gold = human.gold();
    tick(game2, session2, 50);
    expect(human.gold()).toBeGreaterThan(gold);
    expect(session2.sim.read().elapsedGameMinutes).toBe(
      session.sim.read().elapsedGameMinutes + 50 * 72,
    );
    expect(
      session2.sim.read().nations.find((n) => n.id === "bordurie")!.status,
    ).toBe("exiled");
  });

  it("refuses a save made on another map size", async () => {
    const { session } = await playedCampaign();
    const save = decodeSave(session.snapshot().bytes);
    const other = await setup(
      "plains",
      { veritable: true },
      [new PlayerInfo("L'État", PlayerType.Human, "client_1", "human_id")],
      SETUP_DIR,
    );
    if (other.width() !== save.tilesInfo.width) {
      expect(() =>
        VeritableSession.create(other, CORE_START, session.snapshot().bytes),
      ).toThrow(/map is/);
    }
  });

  // The real thing: GameRunner with the legacy nation AI, spawn phase included.
  async function runnerGame(saveBytes?: Uint8Array) {
    const game = await newCoreGame(false);
    const session = VeritableSession.create(game, CORE_START, saveBytes);
    const runner = new GameRunner(
      game,
      new Executor(game, CORE_START.gameID, undefined),
      () => {},
    );
    runner.init(); // after the session, like createGameRunner's onGameCreated
    return { game, session };
  }

  it("reloads under a real GameRunner: nations are not re-spawned over the save", async () => {
    const { game, session } = await runnerGame();
    tick(game, session, 5); // nations pick their spawn
    game.addExecution(
      new SpawnExecution(
        CORE_START.gameID,
        game.player("human_id").info(),
        game.ref(40, 40),
      ),
    );
    tick(game, session, 400);
    expect(game.inSpawnPhase()).toBe(false);
    expect(session.sim.read().elapsedGameMinutes).toBeGreaterThan(0);
    const saved = session.snapshot();
    const tilesBefore = decodeSave(saved.bytes).tiles;
    expect(tilesBefore.some((v) => v !== 0)).toBe(true);

    const { game: game2, session: session2 } = await runnerGame(saved.bytes);
    expect(game2.inSpawnPhase()).toBe(true);
    tick(game2, session2, 2);
    expect(game2.inSpawnPhase()).toBe(false);
    // Tiles, nations, calendar and the player's own state are identical. The
    // legacy nation AI already acts during the restore tick (it commits troops
    // to an attack at once): in-flight state, outside the save by decision.
    const before = decodeSave(saved.bytes);
    const after = decodeSave(session2.snapshot().bytes);
    expect(Array.from(after.tiles)).toEqual(Array.from(before.tiles));
    expect(after.nations).toEqual(before.nations);
    expect(after.calendar).toEqual(before.calendar);
    expect(after.rngState).toEqual(before.rngState);
    expect(after.world.players[0]).toEqual(before.world.players[0]);
    expect(
      after.world.players.map((p) => [p.nation, p.gold, p.spawnTile]),
    ).toEqual(before.world.players.map((p) => [p.nation, p.gold, p.spawnTile]));

    // A few ticks later every nation still sits where the save put it.
    tick(game2, session2, 3);
    for (const id of ["human_id", "syl_id", "bor_id"]) {
      const before = game.player(id).numTilesOwned();
      const after = game2.player(id).numTilesOwned();
      expect(Math.abs(after - before)).toBeLessThan(before * 0.2 + 20);
    }
  });
});
