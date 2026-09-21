import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../core/game/Game";
import { GameConfig } from "../../core/Schemas";
import { loadVeritableConfig } from "../data/loadConfig";
import { encodeSave } from "../save/serialize";
import { MemoryWorld } from "../sim/testing/MemoryWorld";
import { testNation, testScenario } from "../sim/testing/nations";
import { VeritableSimImpl } from "../sim/VeritableSimImpl";
import { LEGACY_SAVE_ERROR } from "./campaign";
import { gameStartInfoFromSave, veritableSoloConfig } from "./soloConfig";

const legacy: GameConfig = {
  gameMap: GameMapType.World,
  gameMapSize: GameMapSize.Compact,
  gameMode: GameMode.FFA,
  gameType: GameType.Singleplayer,
  difficulty: Difficulty.Medium,
  nations: "default",
  donateGold: false,
  donateTroops: false,
  bots: 400,
  infiniteGold: false,
  infiniteTroops: false,
  instantBuild: false,
  randomSpawn: true,
  maxTimerValue: 30,
  overtime: { enabled: true },
  doomsdayClock: { enabled: true },
};

function saveWith(coreStart: unknown): Uint8Array {
  const world = new MemoryWorld(4, 4);
  world.coreStart = coreStart;
  const sim = new VeritableSimImpl({
    config: loadVeritableConfig(),
    world,
    nationData: testNation,
  });
  sim.init(testScenario(["alpha"]), 1);
  return encodeSave(sim.snapshot());
}

describe("veritableSoloConfig", () => {
  it("turns any solo game into a campaign on the scenario's map", () => {
    const config = veritableSoloConfig(legacy);
    expect(config).toMatchObject({
      veritable: true,
      veritableScenario: "europe-10",
      veritablePlayerNation: "FRA",
      gameMap: GameMapType.Europe,
      gameMapSize: GameMapSize.Normal,
      bots: 0,
      nations: "disabled",
      randomSpawn: false,
    });
    expect(config.maxTimerValue).toBeUndefined();
    expect(config.overtime).toBeUndefined();
    expect(config.doomsdayClock).toBeUndefined();
  });

  it("keeps the chosen nation and is idempotent", () => {
    const once = veritableSoloConfig(legacy, "europe-10", "UKR");
    expect(once.veritablePlayerNation).toBe("UKR");
    expect(veritableSoloConfig(once)).toEqual(once);
  });
});

describe("gameStartInfoFromSave", () => {
  const start = (config: GameConfig) => ({
    gameID: "abcd1234",
    lobbyCreatedAt: 1,
    players: [],
    config,
  });

  it("recreates the campaign of a J1 save", () => {
    const info = gameStartInfoFromSave(
      saveWith(start(veritableSoloConfig(legacy, "europe-10", "POL"))),
    );
    expect(info.config.veritablePlayerNation).toBe("POL");
    expect(info.gameID).toBe("abcd1234");
  });

  it("refuses a J0 save with the explicit message key", () => {
    expect(() =>
      gameStartInfoFromSave(saveWith(start({ ...legacy, veritable: true }))),
    ).toThrow(LEGACY_SAVE_ERROR);
  });
});
