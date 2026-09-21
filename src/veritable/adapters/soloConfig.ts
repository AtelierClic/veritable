import {
  GameConfig,
  GameStartInfo,
  GameStartInfoSchema,
} from "../../core/Schemas";
import { GameMapSize, GameMapType } from "../../core/game/Game";
import { loadScenario } from "../data/catalog";
import { decodeSave } from "../save/serialize";
import { LEGACY_SAVE_ERROR } from "./campaign";

export const DEFAULT_SCENARIO = "europe-10";

// OpenFront map of a scenario (`scenario.map` is the folder name of the map).
function mapOf(scenarioMap: string): GameMapType {
  const match = Object.values(GameMapType).find(
    (m) => m.toLowerCase().replace(/\s+/g, "") === scenarioMap.toLowerCase(),
  );
  if (match === undefined) throw new Error(`unknown map: ${scenarioMap}`);
  return match;
}

// Every solo game is a Véritable campaign (DECISIONS.md, 2026-09-21). These
// are mode rules, not balancing: the legacy mechanics below contradict the
// design (no victory, no elimination, fixed borders from a scenario).
export function veritableSoloConfig(
  config: GameConfig,
  scenarioId: string = config.veritableScenario ?? DEFAULT_SCENARIO,
  playerNation: string | undefined = config.veritablePlayerNation,
): GameConfig {
  const scenario = loadScenario(scenarioId);
  return {
    ...config,
    veritable: true,
    veritableScenario: scenario.id,
    veritablePlayerNation: playerNation ?? scenario.playerDefault,
    // The scenario is rasterized for the full-size map.
    gameMap: mapOf(scenario.map),
    gameMapSize: GameMapSize.Normal,
    // The roster is the scenario's: no tribes, no manifest nations.
    bots: 0,
    nations: "disabled",
    randomSpawn: false,
    // No win condition: no lobby timer, no Overtime.
    maxTimerValue: undefined,
    overtime: undefined,
    // The Doomsday Clock is an elimination mechanic.
    doomsdayClock: undefined,
  };
}

// The GameStartInfo stored in a save, validated: it recreates the core game
// the save was made in. Saves of the J0 (no scenario) are refused.
export function gameStartInfoFromSave(bytes: Uint8Array): GameStartInfo {
  const save = decodeSave(bytes);
  const start = GameStartInfoSchema.parse(save.world.coreStart);
  if (start.config.veritableScenario === undefined) {
    throw new Error(LEGACY_SAVE_ERROR);
  }
  return { ...start, config: veritableSoloConfig(start.config) };
}
