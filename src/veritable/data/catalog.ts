/// <reference types="vite/client" />
import { Borders, decodeBorders } from "./bordersFile";
import { NationId } from "./schemas/common";
import { NationData, NationDataSchema } from "./schemas/nation";
import { Scenario, ScenarioSchema } from "./schemas/scenario";

// The data of data/veritable/, bundled by Vite (client, worker, Vitest) and
// validated on first access. The simulation never imports this module: it
// receives data by injection, so that a runner outside Vite (headless, J2) can
// read the same files from disk.

const nationFiles = import.meta.glob<unknown>(
  "../../../data/veritable/nations/*.json",
  { eager: true, import: "default" },
);
const scenarioFiles = import.meta.glob<unknown>(
  "../../../data/veritable/scenarios/*.json",
  { eager: true, import: "default" },
);
const metaFiles = import.meta.glob<BordersMeta>(
  "../../../data/veritable/borders/*.meta.json",
  { eager: true, import: "default" },
);
// Inlined as a data: URL — the game worker runs from a blob: URL, where
// relative asset URLs do not resolve.
const borderFiles = import.meta.glob<string>(
  "../../../data/veritable/borders/*.bin",
  { query: "?inline", import: "default" },
);

export interface BordersMeta {
  scenario: string;
  map: string;
  width: number;
  height: number;
  capitals: Record<NationId, [number, number]>;
}

function find<T>(files: Record<string, T>, name: string): T {
  const key = Object.keys(files).find((k) => k.endsWith(`/${name}`));
  if (key === undefined) throw new Error(`data/veritable: ${name} not found`);
  return files[key];
}

export function scenarioIds(): string[] {
  return Object.keys(scenarioFiles)
    .map((k) => k.slice(k.lastIndexOf("/") + 1, -".json".length))
    .sort();
}

export function loadScenario(id: string): Scenario {
  return ScenarioSchema.parse(find(scenarioFiles, `${id}.json`));
}

export function loadNation(id: NationId): NationData {
  const data = NationDataSchema.parse(
    find(nationFiles, `${id.toLowerCase()}.json`),
  );
  if (data.id !== id) throw new Error(`nation file ${id}: id is ${data.id}`);
  return data;
}

export function loadBordersMeta(scenario: Scenario): BordersMeta {
  return find(metaFiles, `${scenario.id}.meta.json`);
}

export async function loadBorders(scenario: Scenario): Promise<Borders> {
  if (scenario.borders === undefined) {
    throw new Error(`scenario ${scenario.id} has no rasterized borders`);
  }
  const file = scenario.borders.rasterized;
  const load = find(borderFiles, file.slice(file.lastIndexOf("/") + 1));
  const dataUrl = await load();
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return decodeBorders(bytes);
}
