import fs from "fs";
import path from "path";
import { TestConfig } from "../../../tests/util/TestConfig";
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
import { PseudoRandom } from "../../core/PseudoRandom";
import { loadScenarioPack } from "./scenarioPack";
import { coreRoster } from "./scenarioWorld";
import { VeritableSession } from "./VeritableSession";

// J5, on the real OpenFront core and the Europe map: the nuclear nations have
// a silo near their capital from the first day, and a warhead of the
// Véritable system flies through NukeExecution, lands, and leaves fallout
// that the simulation reads (tiles lost, production and GDP hit).

async function europe(player: string) {
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
      infiniteGold: true,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
      veritable: true,
      // As in a real campaign (soloConfig): warheads are no legacy build.
      disabledUnits: [
        UnitType.Factory,
        UnitType.AtomBomb,
        UnitType.HydrogenBomb,
        UnitType.MIRV,
      ],
    },
    new UserSettings(),
    false,
  );
  const game = createGame(
    [new PlayerInfo("L'État", PlayerType.Human, "client_1", "human_id")],
    coreRoster(pack, player)(new PseudoRandom(3)),
    gameMap,
    miniMap,
    config,
  );
  const session = VeritableSession.create(game, {
    coreStart: { gameID: "nuclear", config: { veritablePlayerNation: player } },
    pack,
  });
  const tick = (n: number) => {
    for (let i = 0; i < n; i++) {
      game.executeNextTick();
      session.onCoreTick();
    }
  };
  return { game, session, tick };
}

// The player's nation is the human; the others carry their nation id.
const nameOf = (game: Game, id: string) =>
  id === "FRA"
    ? game.player("human_id")
    : game.allPlayers().find((p) => p.info().nationId === id)!;

describe("nuclear weapons on the real core (Europe map)", () => {
  it("France, Britain and Russia have a silo from the first day; a French warhead lands on Madrid", async () => {
    const { game, session, tick } = await europe("FRA");
    tick(2);
    for (const id of ["FRA", "GBR", "RUS"]) {
      expect(nameOf(game, id).units(UnitType.MissileSilo), id).toHaveLength(1);
    }
    expect(nameOf(game, "ESP").units(UnitType.MissileSilo)).toHaveLength(0);
    // Past the spawn immunity of the core.
    tick(game.config().spawnImmunityDuration() + 20);

    session.sim.apply({
      type: "declare-war",
      target: "ESP",
      casusBelli: "none",
    });
    const before = session.sim.read();
    const gdp = before.economies.ESP.gdp;
    const tiles = before.nations.find((n) => n.id === "ESP")!.tileCount;
    session.sim.apply({
      type: "nuclear-launch",
      target: "ESP",
      aim: "capital",
      confirmed: true,
    });
    expect(session.sim.read().nuclear.nations.FRA.warheads).toBe(289);

    // The flight takes some ticks; the outcome is read once a day.
    let strike = session.sim.read().nuclear.strikes[0];
    for (let i = 0; i < 40 && strike.status === "in-flight"; i++) {
      tick(20);
      strike = session.sim.read().nuclear.strikes[0];
    }
    expect(strike.status).toBe("detonated");
    // TestConfig of OpenFront: warheads of radius 1 (a real game: 80 to 100
    // tiles for a hydrogen bomb).
    expect(strike.hits.ESP).toBeGreaterThan(0);
    const after = session.sim.read();
    const lost = strike.hits.ESP / tiles;
    expect(after.nations.find((n) => n.id === "ESP")!.tileCount).toBeLessThan(
      tiles,
    );
    expect(after.economies.ESP.gdp).toBeLessThan(gdp * (1 - 0.8 * lost));
    expect(after.nuclear.fallout.ESP).toBeLessThan(1);
    // Everyone turned against France.
    expect(after.diplomacy.pariahs).toEqual(["FRA"]);
    expect(
      after.diplomacy.sanctions.filter((s) => s.against === "FRA").length,
    ).toBeGreaterThanOrEqual(8);
  }, 300_000);
});
