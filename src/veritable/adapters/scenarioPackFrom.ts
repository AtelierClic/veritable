import { DataSource } from "../data/DataSource";
import { Scenario } from "../data/schemas/scenario";
import { SimData } from "../sim/economy/context";
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
  const regions = await source.regions(scenario);
  if (
    regions !== null &&
    (regions.width !== borders.width || regions.height !== borders.height)
  ) {
    throw new Error(
      `regions of ${scenarioId} are stale: re-run veritable:borders rasterize`,
    );
  }
  return {
    scenario,
    nations: scenario.nations.map((id) => source.nation(id)),
    borders,
    meta,
    zones,
    regions: regions?.regions ?? new Map(),
    data: simDataFrom(source, scenario),
  };
}

// The static data of a campaign, from a data source (also what a migration
// needs).
export function simDataFrom(source: DataSource, scenario: Scenario): SimData {
  const meta = source.bordersMeta(scenario);
  const seas = source.seas(scenario.map);
  return {
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
    regimes: source.regimes(),
    laws: source.laws(),
    objectives: source.objectives(),
    leaders: Object.fromEntries(
      scenario.nations.map((id) => [id, source.leaders(id)]),
    ),
    names: Object.fromEntries(
      scenario.nations.map((id) => [id, source.names(id)]),
    ),
    tech: source.tech(),
    events: source.events(),
  };
}
