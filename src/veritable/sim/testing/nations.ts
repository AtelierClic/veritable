import { NationId } from "../../data/schemas/common";
import { NationData } from "../../data/schemas/nation";
import { Scenario } from "../../data/schemas/scenario";

// Minimal nation sheets and scenario for tests that do not need real data.
export function testNation(id: NationId): NationData {
  return {
    id,
    name: `nation.${id}.name`,
    capital: {
      name: `nation.${id}.capital`,
      lon: 0,
      lat: 0,
      source: "test",
      asOf: "2026-01-01",
    },
    regime: "parliamentary",
    regimeSource: { source: "test", asOf: "2026-01-01" },
    blocs: [],
    territory: { kind: "tiles" },
    contested: [],
  };
}

export function testScenario(nations: NationId[]): Scenario {
  return {
    id: "test",
    map: "memory",
    startDate: "2026-01-01",
    nations,
    borders: { source: "test", rasterized: "borders/test.bin" },
    contested: [],
    wars: [],
    playerDefault: nations[0],
  };
}
