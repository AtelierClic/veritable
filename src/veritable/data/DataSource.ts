import { Borders, decodeBorders } from "./bordersFile";
import { Bloc, BlocSchema } from "./schemas/bloc";
import { NationId } from "./schemas/common";
import { VeritableConfig, VeritableConfigSchema } from "./schemas/config";
import { EventSchema, VeritableEvent } from "./schemas/event";
import { Good, GoodsSchema } from "./schemas/goods";
import { Law, LawsSchema } from "./schemas/laws";
import { LeadersData, LeadersDataSchema } from "./schemas/leaders";
import { NationData, NationDataSchema } from "./schemas/nation";
import {
  IdeologyTable,
  IdeologyTableSchema,
  NamePool,
  NamePoolSchema,
  Objective,
  ObjectivesSchema,
  RegimeData,
  RegimesSchema,
} from "./schemas/politics";
import { RowData, RowSchema } from "./schemas/row";
import { Scenario, ScenarioSchema } from "./schemas/scenario";
import { Seas, SeasSchema } from "./schemas/seas";
import { TechFileSchema, TechNode } from "./schemas/tech";
import {
  CasusBelli,
  CasusBelliCatalogueSchema,
  DivisionTemplate,
  DivisionTemplatesSchema,
} from "./schemas/war";
import { decodeZones, Zones } from "./zonesFile";

// Access to data/veritable/, validated. Two implementations of the raw file
// access exist behind it:
//   - files.vite.ts  (import.meta.glob: client, game worker, Vitest)
//   - files.fs.ts    (node fs: the headless runner and the tools, under tsx)
// The simulation imports neither: it receives plain validated objects.

export interface BordersMeta {
  scenario: string;
  map: string;
  width: number;
  height: number;
  capitals: Record<NationId, [number, number]>;
  // Pairs of nations sharing a land border on the map, and the nations that
  // touch neutral land (i.e. the rest of the world).
  landNeighbours: [NationId, NationId][];
  bordersNeutralLand: NationId[];
}

// Paths are relative to data/veritable/, with forward slashes.
export interface RawDataFiles {
  json(path: string): unknown;
  list(directory: string, suffix: string): string[];
  bytes(path: string): Promise<Uint8Array>;
}

export interface DataSource {
  config(): VeritableConfig;
  goods(): Good[];
  row(): RowData;
  blocs(): Bloc[];
  divisions(): DivisionTemplate[];
  casusBelli(): CasusBelli[];
  scenarioIds(): string[];
  scenario(id: string): Scenario;
  nation(id: NationId): NationData;
  bordersMeta(scenario: Scenario): BordersMeta;
  borders(scenario: Scenario): Promise<Borders>;
  // Maritime zones (J3b): the seeds of the map, and their rasterization.
  seas(map: string): Seas;
  zones(scenario: Scenario): Promise<Zones>;
  // The political engine (J4).
  regimes(): RegimeData[];
  ideologies(): IdeologyTable;
  objectives(): Objective[];
  laws(): Law[];
  names(id: NationId): NamePool;
  leaders(id: NationId): LeadersData;
  // Technology and events (J5).
  tech(): TechNode[];
  events(): VeritableEvent[];
}

export function createDataSource(files: RawDataFiles): DataSource {
  const cache = new Map<string, unknown>();
  const once = <T>(key: string, load: () => T): T => {
    if (!cache.has(key)) cache.set(key, load());
    return cache.get(key) as T;
  };
  const nameOf = (path: string, suffix: string) =>
    path.slice(path.lastIndexOf("/") + 1, -suffix.length);

  return {
    config: () =>
      once("config", () =>
        VeritableConfigSchema.parse(files.json("config.json")),
      ),
    goods: () =>
      once("goods", () => GoodsSchema.parse(files.json("goods/goods.json"))),
    row: () => once("row", () => RowSchema.parse(files.json("row.json"))),
    blocs: () =>
      once("blocs", () =>
        files
          .list("blocs", ".json")
          .sort()
          .map((path) => BlocSchema.parse(files.json(path))),
      ),
    divisions: () =>
      once("divisions", () =>
        DivisionTemplatesSchema.parse(files.json("war/divisions.json")),
      ),
    casusBelli: () =>
      once("casusBelli", () =>
        CasusBelliCatalogueSchema.parse(files.json("war/casus-belli.json")),
      ),
    scenarioIds: () =>
      files
        .list("scenarios", ".json")
        .map((path) => nameOf(path, ".json"))
        .sort(),
    scenario: (id) =>
      once(`scenario:${id}`, () =>
        ScenarioSchema.parse(files.json(`scenarios/${id}.json`)),
      ),
    nation: (id) =>
      once(`nation:${id}`, () => {
        const data = NationDataSchema.parse(
          files.json(`nations/${id.toLowerCase()}.json`),
        );
        if (data.id !== id)
          throw new Error(`nation file ${id}: id is ${data.id}`);
        return data;
      }),
    bordersMeta: (scenario) =>
      once(
        `meta:${scenario.id}`,
        () => files.json(`borders/${scenario.id}.meta.json`) as BordersMeta,
      ),
    borders: async (scenario) =>
      decodeBorders(await files.bytes(scenario.borders.rasterized)),
    seas: (map) =>
      once(`seas:${map}`, () =>
        SeasSchema.parse(files.json(`maps/${map}.seas.json`)),
      ),
    regimes: () =>
      once("regimes", () =>
        RegimesSchema.parse(files.json("politics/regimes.json")),
      ),
    ideologies: () =>
      once("ideologies", () =>
        IdeologyTableSchema.parse(files.json("politics/ideologies.json")),
      ),
    objectives: () =>
      once("objectives", () =>
        ObjectivesSchema.parse(files.json("politics/objectives.json")),
      ),
    laws: () =>
      once("laws", () =>
        files
          .list("laws", ".json")
          .sort()
          .flatMap((path) => LawsSchema.parse(files.json(path))),
      ),
    names: (id) =>
      once(`names:${id}`, () =>
        NamePoolSchema.parse(files.json(`names/${id.toLowerCase()}.json`)),
      ),
    leaders: (id) =>
      once(`leaders:${id}`, () => {
        const data = LeadersDataSchema.parse(
          files.json(`leaders/${id.toLowerCase()}.json`),
        );
        if (data.nation !== id)
          throw new Error(`leaders file ${id}: nation is ${data.nation}`);
        return data;
      }),
    zones: async (scenario) =>
      decodeZones(await files.bytes(`borders/${scenario.id}.zones.bin`)),
    // The trunk, then the branches in file order.
    tech: () =>
      once("tech", () => [
        ...TechFileSchema.parse(files.json("tech/trunk.json")),
        ...files
          .list("tech/branches", ".json")
          .sort()
          .flatMap((path) => TechFileSchema.parse(files.json(path))),
      ]),
    events: () =>
      once("events", () =>
        ["events/scripted", "events/templates"].flatMap((dir) =>
          files
            .list(dir, ".json")
            .sort()
            .map((path) => EventSchema.parse(files.json(path))),
        ),
      ),
  };
}

export class DataFileNotFound extends Error {
  constructor(path: string) {
    super(`data/veritable: ${path} not found`);
  }
}
