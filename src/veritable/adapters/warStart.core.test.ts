import fs from "fs";
import path from "path";
import { TestConfig } from "../../../tests/util/TestConfig";
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
import { PseudoRandom } from "../../core/PseudoRandom";
import { loadScenarioPack } from "./scenarioPack";
import { coreRoster } from "./scenarioWorld";
import { VeritableSession } from "./VeritableSession";

// J7a.7, on the real core and the Europe map: the war of the scenario. The
// rolling queue first spread the first updates of the nations over a week:
// Ukraine took its war orders before Russia, found its segments empty and
// took land the scenario gives Russia, which then stood at the nuclear
// threat of level 2 for the whole war. The belligerents of the scenario
// now take their first orders together, once the fronts are known, and the
// orders of an AI nation come every ordersDays of its own time.

async function europe() {
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
    },
    new UserSettings(),
    false,
  );
  const game = createGame(
    [new PlayerInfo("L'État", PlayerType.Human, "client_1", "human_id")],
    coreRoster(pack, "FRA")(new PseudoRandom(3)),
    gameMap,
    miniMap,
    config,
  );
  const session = VeritableSession.create(game, {
    coreStart: { gameID: "warstart", config: { veritablePlayerNation: "FRA" } },
    pack,
    autopilot: true,
  });
  const tick = (n: number) => {
    for (let i = 0; i < n; i++) {
      game.executeNextTick();
      session.onCoreTick();
    }
  };
  return { session, tick };
}

describe("the war of the scenario on the real core (J7a.7)", () => {
  it("starts with the orders of both sides together, Ukraine takes no Russian land, orders come monthly", async () => {
    const { session, tick } = await europe();
    const ticksPerDay = 20;
    // Past the loading ticks, into the first day.
    while (session.sim.read().elapsedGameMinutes === 0) tick(1);
    tick(4);
    const early = session.sim.read();
    const first = {
      RUS: early.ai.nations.RUS.lastOrders,
      UKR: early.ai.nations.UKR.lastOrders,
    };
    expect(first.RUS).toBe(early.date);
    expect(first.UKR).toBe(first.RUS);
    const onFront = (id: string) =>
      early.military.nations[id].divisions.filter((d) => d.front !== null)
        .length;
    expect(onFront("RUS")).toBeGreaterThan(0);
    expect(onFront("UKR")).toBeGreaterThan(0);

    tick(31 * ticksPerDay);
    const view = session.sim.read();
    const war = view.diplomacy.wars.find(
      (w) => w.aggressors.includes("RUS") && w.defenders.includes("UKR"),
    )!;
    expect(war.tilesTaken.UKR ?? 0).toBe(0);
    expect(view.nuclear.nations.RUS.threat).toBe(1);
    // The next orders, a month of its own time after the first (at its
    // first update 30 days on: it is updated every week at war).
    expect(view.ai.nations.RUS.lastOrders).toBe(first.RUS);
    tick(10 * ticksPerDay);
    const later = session.sim.read().ai.nations.RUS.lastOrders!;
    expect(later > first.RUS!).toBe(true);
  }, 240_000);
});
