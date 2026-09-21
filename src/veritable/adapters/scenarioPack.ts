import { dataSource } from "../data/catalog";
import { loadScenarioPackFrom } from "./scenarioPackFrom";
import { ScenarioPack } from "./scenarioWorld";

// The scenario pack from the Vite-bundled data (client, game worker, Vitest).
// The headless runner uses loadScenarioPackFrom with the fs DataSource.
export const loadScenarioPack = (scenarioId: string): Promise<ScenarioPack> =>
  loadScenarioPackFrom(dataSource, scenarioId);
