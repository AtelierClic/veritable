import {
  loadBorders,
  loadBordersMeta,
  loadNation,
  loadScenario,
} from "../data/catalog";
import { ScenarioPack } from "./scenarioWorld";

// Everything a campaign needs from data/veritable/ for one scenario.
export async function loadScenarioPack(
  scenarioId: string,
): Promise<ScenarioPack> {
  const scenario = loadScenario(scenarioId);
  const borders = await loadBorders(scenario);
  if (borders.nations.join() !== scenario.nations.join()) {
    throw new Error(
      `borders of ${scenarioId} are stale: re-run veritable:borders rasterize`,
    );
  }
  return {
    scenario,
    nations: scenario.nations.map(loadNation),
    borders,
    meta: loadBordersMeta(scenario),
  };
}
