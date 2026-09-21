import { Nation } from "../../core/game/Game";
import { PseudoRandom } from "../../core/PseudoRandom";
import { GameStartInfo } from "../../core/Schemas";
import { loadScenarioPack } from "./scenarioPack";
import { coreRoster, playerNationOf, ScenarioPack } from "./scenarioWorld";

export interface Campaign {
  pack: ScenarioPack;
  roster: (random: PseudoRandom) => Nation[];
}

// i18n key of the message shown by the campaign panel.
export const LEGACY_SAVE_ERROR = "save.error.legacy-j0";

// What the game worker needs before it creates the core game. Returns null
// when the game is not a Véritable campaign (legacy multiplayer, replays).
export async function loadCampaign(
  gameStartInfo: GameStartInfo,
): Promise<Campaign | null> {
  const { veritable, veritableScenario, veritablePlayerNation } =
    gameStartInfo.config;
  if (veritable !== true) return null;
  // J0 campaigns had no scenario (nations came from the map manifest): that
  // world can no longer be recreated.
  if (veritableScenario === undefined) throw new Error(LEGACY_SAVE_ERROR);
  const pack = await loadScenarioPack(veritableScenario);
  return {
    pack,
    roster: coreRoster(pack, playerNationOf(pack, veritablePlayerNation)),
  };
}
