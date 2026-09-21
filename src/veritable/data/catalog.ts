import { Borders } from "./bordersFile";
import { BordersMeta, createDataSource, DataSource } from "./DataSource";
import { viteDataFiles } from "./files.vite";
import { NationId } from "./schemas/common";
import { NationData } from "./schemas/nation";
import { Scenario } from "./schemas/scenario";

// The Vite-side DataSource (client, game worker, Vitest). The headless runner
// builds its own with files.fs.ts. The simulation imports neither.
export const dataSource: DataSource = createDataSource(viteDataFiles());

export type { BordersMeta };

export const scenarioIds = (): string[] => dataSource.scenarioIds();
export const loadScenario = (id: string): Scenario => dataSource.scenario(id);
export const loadNation = (id: NationId): NationData => dataSource.nation(id);
export const loadBordersMeta = (scenario: Scenario): BordersMeta =>
  dataSource.bordersMeta(scenario);
export const loadBorders = (scenario: Scenario): Promise<Borders> =>
  dataSource.borders(scenario);
