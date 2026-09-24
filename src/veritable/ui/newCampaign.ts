import {
  Difficulty,
  GameMapSize,
  GameMode,
  GameType,
} from "../../core/game/Game";
import { GameStartInfo } from "../../core/Schemas";
import { generateID } from "../../core/Util";
import { gameMapOf } from "../adapters/scenarioMap";
import { veritableSoloConfig } from "../adapters/soloConfig";
import { loadNation, loadScenario, scenarioIds } from "../data/catalog";
import { vt } from "../data/i18n";

export interface ScenarioChoice {
  id: string;
  label: string;
  playerDefault: string;
  nations: { id: string; label: string }[];
}

// What the start screen offers: the scenarios of data/veritable/ and, for
// each, the nations the player can embody.
export function scenarioChoices(): ScenarioChoice[] {
  return scenarioIds().map((id) => {
    const scenario = loadScenario(id);
    return {
      id,
      label: vt(`scenario.${id}.name`),
      playerDefault: scenario.playerDefault,
      nations: scenario.nations.map((nationId) => ({
        id: nationId,
        label: vt(loadNation(nationId).name),
      })),
    };
  });
}

// GameStartInfo of a new campaign. The player is the State: they carry the
// name of their nation. Everything OpenFront-specific is fixed by
// veritableSoloConfig; none of the legacy solo settings apply.
export function newCampaignStartInfo(
  scenarioId: string,
  playerNation: string,
  createdAt: number,
): GameStartInfo {
  return {
    gameID: generateID(),
    lobbyCreatedAt: createdAt,
    players: [
      {
        clientID: generateID(),
        username: vt(loadNation(playerNation).name),
        clanTag: null,
        cosmetics: {},
      },
    ],
    config: veritableSoloConfig(
      {
        // J6: the map of the scenario (europe-10: Europe; world-2026: the
        // world map).
        gameMap: gameMapOf(loadScenario(scenarioId).map),
        gameMapSize: GameMapSize.Normal,
        gameType: GameType.Singleplayer,
        gameMode: GameMode.FFA,
        difficulty: Difficulty.Medium,
        nations: "disabled",
        bots: 0,
        donateGold: false,
        donateTroops: false,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
      },
      scenarioId,
      playerNation,
    ),
  };
}
