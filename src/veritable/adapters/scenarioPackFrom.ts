import { DataSource } from "../data/DataSource";
import { ScenarioPack } from "./scenarioWorld";

// Everything a campaign needs from data/veritable/ for one scenario. Works
// with either DataSource: Vite (client, worker) or fs (headless runner).
export async function loadScenarioPackFrom(
  source: DataSource,
  scenarioId: string,
): Promise<ScenarioPack> {
  const scenario = source.scenario(scenarioId);
  const borders = await source.borders(scenario);
  if (borders.nations.join() !== scenario.nations.join()) {
    throw new Error(
      `borders of ${scenarioId} are stale: re-run veritable:borders rasterize`,
    );
  }
  const meta = source.bordersMeta(scenario);
  const zones = await source.zones(scenario);
  if (zones.width !== borders.width || zones.height !== borders.height) {
    throw new Error(
      `zones of ${scenarioId} are stale: re-run veritable:borders zones`,
    );
  }
  const seas = source.seas(scenario.map);
  return {
    scenario,
    nations: scenario.nations.map((id) => source.nation(id)),
    borders,
    meta,
    zones,
    data: {
      goods: source.goods(),
      row: source.row(),
      blocs: source.blocs(),
      divisions: source.divisions(),
      casusBelli: source.casusBelli(),
      seas: seas.zones,
      geography: {
        landNeighbours: meta.landNeighbours,
        bordersNeutralLand: meta.bordersNeutralLand,
      },
    },
  };
}
