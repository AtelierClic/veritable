import fs from "fs";
import path from "path";
import { setup } from "../../../tests/util/Setup";
import { TestConfig } from "../../../tests/util/TestConfig";
import { Executor } from "../../core/execution/ExecutionManager";
import {
  Difficulty,
  Game,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../core/game/Game";
import { createGame } from "../../core/game/GameImpl";
import { genTerrainFromBin } from "../../core/game/TerrainMapLoader";
import { UserSettings } from "../../core/game/UserSettings";
import { GameRunner } from "../../core/GameRunner";
import { PseudoRandom } from "../../core/PseudoRandom";
import { GameConfig, GameStartInfo } from "../../core/Schemas";
import { decodeSave } from "../save/serialize";
import { testNation, testScenario } from "../sim/testing/nations";
import { testSimData } from "../sim/testing/simData";
import { LEGACY_SAVE_ERROR, loadCampaign } from "./campaign";
import { loadScenarioPack } from "./scenarioPack";
import { coreRoster, ScenarioPack } from "./scenarioWorld";
import { VeritableSession } from "./VeritableSession";

// Integration: a real OpenFront core game (GameRunner included) + the
// Véritable simulation, started from a scenario.

const SETUP_DIR = path.join(__dirname, "../../../tests/util");
const human = () => [
  new PlayerInfo("L'État", PlayerType.Human, "client_1", "human_id"),
];

// Three nations on big_plains (200 x 200): vertical bands, the east is neutral.
//   AAA x 20..59   BBB x 60..99   CCC x 100..129   neutral beyond
const BANDS: [string, number, number][] = [
  ["AAA", 20, 60],
  ["BBB", 60, 100],
  ["CCC", 100, 130],
];

function testPack(width = 200, height = 200): ScenarioPack {
  const tiles = new Uint16Array(width * height);
  BANDS.forEach(([, x0, x1], n) => {
    for (let y = 20; y < 180; y++) {
      for (let x = x0; x < x1; x++) tiles[y * width + x] = n + 1;
    }
  });
  const ids = BANDS.map(([id]) => id);
  return {
    scenario: testScenario(ids),
    nations: ids.map((id) => testNation(id)),
    borders: { width, height, nations: ids, tiles },
    data: testSimData(ids),
    meta: {
      scenario: "test",
      map: "big_plains",
      width,
      height,
      capitals: { AAA: [40, 100], BBB: [80, 100], CCC: [115, 100] },
      landNeighbours: [
        ["AAA", "BBB"],
        ["BBB", "CCC"],
      ],
      bordersNeutralLand: ["CCC"],
    },
  };
}

const coreStart = (playerNation = "AAA") => ({
  gameID: "j1-test-game",
  config: {
    veritable: true,
    veritableScenario: "test",
    veritablePlayerNation: playerNation,
  },
});

async function campaign(saveBytes?: Uint8Array, playerNation = "AAA") {
  const pack = testPack();
  const game = await setup(
    "big_plains",
    { veritable: true, instantBuild: true },
    human(),
    SETUP_DIR,
    undefined,
    false, // the spawn phase is ended by the scenario loader, not by the test
    coreRoster(pack, playerNation)(new PseudoRandom(7)),
  );
  const session = VeritableSession.create(game, {
    coreStart: coreStart(playerNation),
    pack,
    saveBytes,
  });
  // After the session, like createGameRunner does.
  new GameRunner(
    game,
    new Executor(game, "j1-test-game", undefined),
    () => {},
  ).init();
  return { game, session, pack };
}

function tick(game: Game, session: VeritableSession, n = 1) {
  const events = [];
  for (let i = 0; i < n; i++) {
    game.executeNextTick();
    events.push(...session.onCoreTick());
  }
  return events;
}

const playerOf = (game: Game, name: string) =>
  game.allPlayers().find((p) => p.name() === name)!;

describe("scenario loader", () => {
  it("every nation holds its borders from the first day: nobody starts exiled", async () => {
    const { game, session } = await campaign();

    // Even before the first core tick the simulation sees the borders.
    expect(
      session.sim.read().nations.map((n) => [n.id, n.tileCount, n.status]),
    ).toEqual([
      ["AAA", 40 * 160, "active"],
      ["BBB", 40 * 160, "active"],
      ["CCC", 30 * 160, "active"],
    ]);

    const events = tick(game, session, 40);
    expect(events.filter((e) => e.type === "nation-status-changed")).toEqual(
      [],
    );
    expect(session.sim.read().journal.map((j) => j.kind)).toEqual([
      "campaign-started",
    ]);
    expect(session.sim.read().nations.every((n) => n.status === "active")).toBe(
      true,
    );
  });

  it("replaces the spawn phase: tiles, capital city, spawn tile, no click needed", async () => {
    const { game, session } = await campaign();
    expect(game.inSpawnPhase()).toBe(true);
    tick(game, session, 2);
    expect(game.inSpawnPhase()).toBe(false);

    const state = game.player("human_id");
    expect(state.numTilesOwned()).toBe(40 * 160);
    expect(state.spawnTile()).toBe(game.ref(40, 100));
    expect(state.units(UnitType.City).map((u) => u.tile())).toEqual([
      game.ref(40, 100),
    ]);
    const bbb = playerOf(game, "nation.BBB.name");
    expect(bbb.type()).toBe(PlayerType.Nation);
    expect(bbb.numTilesOwned()).toBe(40 * 160);
    expect(game.owner(game.ref(80, 100))).toBe(bbb);
    expect(game.players()).toHaveLength(3);
  });

  it("the player embodies the nation they chose", async () => {
    const { game, session } = await campaign(undefined, "CCC");
    tick(game, session, 2);
    expect(session.sim.read().playerNation).toBe("CCC");
    expect(game.owner(game.ref(115, 100))).toBe(game.player("human_id"));
    expect(game.owner(game.ref(40, 100))).toBe(
      playerOf(game, "nation.AAA.name"),
    );
  });

  it("land outside the scenario is neutral and cannot be conquered", async () => {
    const { game, session } = await campaign(undefined, "CCC");
    tick(game, session, 2);
    const state = game.player("human_id");
    expect(game.hasOwner(game.ref(150, 100))).toBe(false);
    expect(game.isUnclaimable(game.ref(150, 100))).toBe(true);
    expect(state.canAttack(game.ref(131, 100))).toBe(false);
    expect(state.canAttack(game.ref(99, 100))).toBe(true); // a neighbour's land
  });

  it("nations are inert: five game years later the borders have not moved", async () => {
    const { game, session } = await campaign();
    tick(game, session, 2);
    // 5 years = 1 826 days x 20 ticks; ticking the sim alone is enough to
    // cover the calendar, the core is ticked for a while to show inertia.
    tick(game, session, 1500);
    expect(session.sim.read().nations.map((n) => n.tileCount)).toEqual([
      6400, 6400, 4800,
    ]);
  });

  it("campaign time: 72 game minutes per core tick once the world is in place", async () => {
    const { game, session } = await campaign();
    tick(game, session, 2); // init + load: not campaign time
    expect(session.sim.read().elapsedGameMinutes).toBe(0);
    const events = tick(game, session, 20 * 31);
    expect(session.sim.read().date).toBe("2026-02-01");
    expect(events.filter((e) => e.type === "day-started")).toHaveLength(31);
    expect(events.filter((e) => e.type === "month-started")).toEqual([
      { type: "month-started", date: "2026-02-01" },
    ]);
    expect(Object.keys(session.perf())).toContain("veritable:economy:day");
    expect(session.perf()["veritable:save:month"].calls).toBe(1);
  });
});

describe("zero tiles and saves, from a scenario", () => {
  async function played() {
    const c = await campaign();
    tick(c.game, c.session, 2);
    const state = c.game.player("human_id");
    const ccc = playerOf(c.game, "nation.CCC.name");
    state.buildUnit(UnitType.DefensePost, c.game.ref(45, 45), {});
    state.addGold(123_456n);
    c.game.setFallout(c.game.ref(150, 50), true);
    tick(c.game, c.session, 30);
    for (const t of [...ccc.tiles()]) state.conquer(t); // CCC is annexed
    const events = tick(c.game, c.session, 25);
    return { ...c, events, state, ccc };
  }

  it("an annexed nation survives with zero tiles, in the core and in the sim", async () => {
    const { game, session, events, ccc } = await played();
    expect(
      events.filter((e) => e.type === "nation-status-changed"),
    ).toMatchObject([{ nation: "CCC", from: "active", to: "exiled" }]);
    tick(game, session, 200);
    const view = session.sim.read().nations.find((n) => n.id === "CCC")!;
    expect([view.tileCount, view.status]).toEqual([0, "exiled"]);
    expect(ccc.isAlive()).toBe(true);
    expect(game.players()).toContain(ccc);
  });

  it("save -> reload in a fresh core game -> save: same bytes, under a real GameRunner", async () => {
    const { game, session } = await played();
    const saved = session.snapshot();

    const reloaded = await campaign(saved.bytes);
    expect(reloaded.session.snapshot().bytes).toEqual(saved.bytes); // pending
    tick(reloaded.game, reloaded.session, 2);
    expect(reloaded.game.inSpawnPhase()).toBe(false);
    expect(reloaded.session.snapshot().bytes).toEqual(saved.bytes);
    expect(reloaded.session.sim.read()).toEqual(session.sim.read());

    // No legacy AI any more: both campaigns stay identical as time goes on.
    tick(game, session, 100);
    tick(reloaded.game, reloaded.session, 100);
    expect(reloaded.session.snapshot().bytes).toEqual(session.snapshot().bytes);
  });

  it("the reloaded core game really holds the saved world and keeps running", async () => {
    const { game, session } = await played();
    const saved = session.snapshot();
    const { game: game2, session: session2 } = await campaign(saved.bytes);
    tick(game2, session2, 2);

    for (const p of game.allPlayers()) {
      const after = playerOf(game2, p.name());
      expect(after.numTilesOwned()).toBe(p.numTilesOwned());
      expect(after.troops()).toBe(p.troops());
      expect(after.gold()).toBe(p.gold());
      expect(after.spawnTile()).toBe(p.spawnTile());
    }
    const state = game2.player("human_id");
    expect(game2.owner(game2.ref(115, 100))).toBe(state); // annexed land
    expect(state.units(UnitType.DefensePost)).toHaveLength(1);
    expect(state.units(UnitType.City).length).toBeGreaterThanOrEqual(1);
    expect(game2.hasFallout(game2.ref(150, 50))).toBe(true);
    expect(game2.isUnclaimable(game2.ref(150, 100))).toBe(true);
    expect(playerOf(game2, "nation.CCC.name").isAlive()).toBe(true);

    const before = session2.sim.read().elapsedGameMinutes;
    tick(game2, session2, 50);
    expect(session2.sim.read().elapsedGameMinutes).toBe(before + 50 * 72);
    expect(
      session2.sim.read().nations.find((n) => n.id === "CCC")!.status,
    ).toBe("exiled");
  });

  it("the save stores nation indices, keys and the scenario in coreStart", async () => {
    const { session } = await played();
    const save = decodeSave(session.snapshot().bytes);
    expect(save.nations.map((n) => n.name)).toEqual([
      { kind: "key", key: "nation.AAA.name" },
      { kind: "key", key: "nation.BBB.name" },
      { kind: "key", key: "nation.CCC.name" },
    ]);
    expect(save.nations.every((n) => n.regime === "parliamentary")).toBe(true);
    expect(save.world.coreStart).toMatchObject({
      config: { veritableScenario: "test", veritablePlayerNation: "AAA" },
    });
  });

  it("refuses a map that is not the one the scenario was rasterized for", async () => {
    const pack = testPack();
    const other = await setup(
      "plains",
      { veritable: true },
      human(),
      SETUP_DIR,
    );
    if (other.width() !== 200 || other.height() !== 200) {
      expect(() =>
        VeritableSession.create(other, { coreStart: coreStart(), pack }),
      ).toThrow(/rasterized for/);
    }
  });
});

describe("loadCampaign", () => {
  const start = (config: Partial<GameConfig>) =>
    ({ gameID: "g", players: [], config }) as unknown as GameStartInfo;

  it("is null outside a campaign", async () => {
    expect(await loadCampaign(start({}))).toBeNull();
  });

  it("refuses a J0 campaign (no scenario) with an explicit message key", async () => {
    await expect(loadCampaign(start({ veritable: true }))).rejects.toThrow(
      LEGACY_SAVE_ERROR,
    );
  });

  it("loads europe-10 and builds the roster of the nine other nations", async () => {
    const loaded = await loadCampaign(
      start({
        veritable: true,
        veritableScenario: "europe-10",
        veritablePlayerNation: "POL",
      }),
    );
    const roster = loaded!.roster(new PseudoRandom(1));
    expect(roster.map((n) => n.playerInfo.name)).toEqual([
      "France",
      "Allemagne",
      "Royaume-Uni",
      "Italie",
      "Espagne",
      "Ukraine",
      "Russie",
      "Turquie",
      "Norvège",
    ]);
    await expect(
      loadCampaign(
        start({
          veritable: true,
          veritableScenario: "europe-10",
          veritablePlayerNation: "USA",
        }),
      ),
    ).rejects.toThrow(/not a nation/);
  });
});

describe("europe-10 on the real Europe map", () => {
  it("loads: ten active nations on their Natural Earth borders, the rest neutral", async () => {
    const dir = path.join(__dirname, "../../../resources/maps/europe");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
    );
    const gameMap = await genTerrainFromBin(
      manifest.map,
      fs.readFileSync(path.join(dir, "map.bin")),
    );
    const miniMap = await genTerrainFromBin(
      manifest.map4x,
      fs.readFileSync(path.join(dir, "map4x.bin")),
    );
    const pack = await loadScenarioPack("europe-10");
    const config = new TestConfig(
      {
        gameMap: GameMapType.Europe,
        gameMapSize: GameMapSize.Normal,
        gameMode: GameMode.FFA,
        gameType: GameType.Singleplayer,
        difficulty: Difficulty.Medium,
        nations: "default",
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
    const game = createGame(
      human(),
      coreRoster(pack, "FRA")(new PseudoRandom(3)),
      gameMap,
      miniMap,
      config,
    );
    const session = VeritableSession.create(game, {
      coreStart: {
        gameID: "europe",
        config: { veritablePlayerNation: "FRA" },
      },
      pack,
    });
    const started = performance.now();
    tick(game, session, 2);
    const loadMs = performance.now() - started;

    const report = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          "../../../data/veritable/borders/europe-10.report.json",
        ),
        "utf8",
      ),
    );
    const view = session.sim.read();
    expect(view.playerNation).toBe("FRA");
    expect(view.nations.map((n) => [n.id, n.tileCount, n.status])).toEqual(
      report.nations.map((n: { nation: string; total: number }) => [
        n.nation,
        n.total,
        "active",
      ]),
    );
    expect(game.player("human_id").units(UnitType.City)).toHaveLength(1);
    expect(game.inSpawnPhase()).toBe(false);
    expect(loadMs).toBeLessThan(60_000);
    fs.writeFileSync(
      path.join(
        __dirname,
        "../../../tools/veritable/borders/cache/load-ms.txt",
      ),
      `${Math.round(loadMs)}`,
    );
  }, 180_000);
});
