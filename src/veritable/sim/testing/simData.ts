import { Bloc } from "../../data/schemas/bloc";
import { NationId } from "../../data/schemas/common";
import { Good, GOOD_IDS, GoodId } from "../../data/schemas/goods";
import { RowData } from "../../data/schemas/row";
import { SeaZone } from "../../data/schemas/seas";
import { CasusBelli, DivisionTemplate } from "../../data/schemas/war";
import { SimData } from "../economy/context";

// The real templates and catalogue: they are data, not balancing of a test.
export const TEST_DIVISIONS: DivisionTemplate[] = [
  {
    id: "infantry",
    name: "division.infantry",
    attack: 1,
    defense: 1.5,
    men: 15000,
    arms: 1,
  },
  {
    id: "mechanized",
    name: "division.mechanized",
    attack: 2,
    defense: 2,
    men: 15000,
    arms: 3,
  },
  {
    id: "armored",
    name: "division.armored",
    attack: 3,
    defense: 1.5,
    men: 12000,
    arms: 5,
  },
  {
    id: "artillery",
    name: "division.artillery",
    attack: 2.5,
    defense: 1,
    men: 10000,
    arms: 3,
  },
];
export const TEST_CASUS_BELLI: CasusBelli[] = [
  {
    id: "contested-territory",
    name: "casus.contested-territory",
    check: "contested-territory",
    relationsCost: 5,
  },
  {
    id: "ally-attacked",
    name: "casus.ally-attacked",
    check: "ally-attacked",
    relationsCost: 5,
  },
  {
    id: "humanitarian",
    name: "casus.humanitarian",
    check: "humanitarian",
    relationsCost: 5,
  },
  { id: "none", name: "casus.none", check: "none", relationsCost: 15 },
];

const RENT: GoodId[] = ["oil", "gas", "coal", "critical-minerals"];
const INDUSTRIAL: GoodId[] = [
  "steel",
  "consumer-goods",
  "electronics",
  "arms",
  "pharma",
];

export function testGoods(overrides: Partial<Good> = {}): Good[] {
  return GOOD_IDS.map((id) => ({
    id,
    name: `good.${id}`,
    tier: 1,
    unit: "unit",
    transport:
      id === "electricity"
        ? ("neighbors-only" as const)
        : id === "services"
          ? ("free" as const)
          : ("normal" as const),
    storable: id !== "electricity" && id !== "services",
    basePrice: 100,
    basePriceSource: { source: "test", asOf: "2026-01-01" },
    epsilon: 0.3,
    eta: 0.3,
    shortageWeight: 1 / GOOD_IDS.length,
    rent: RENT.includes(id),
    industrial: INDUSTRIAL.includes(id),
    ...overrides,
  }));
}

export function testRow(
  production = 1000,
  consumption = 1000,
  overrides: Partial<Record<GoodId, [number, number]>> = {},
): RowData {
  const sourced = (value: number) => ({
    value,
    source: "test",
    asOf: "2026-01-01",
  });
  return {
    id: "ROW",
    name: "nation.row.name",
    scenario: "test",
    gdp: sourced(50e12),
    goods: Object.fromEntries(
      GOOD_IDS.map((g) => [
        g,
        {
          production: sourced(overrides[g]?.[0] ?? production),
          consumption: sourced(overrides[g]?.[1] ?? consumption),
        },
      ]),
    ) as RowData["goods"],
  };
}

// Simple world: every nation touches neutral land (so it can trade
// electricity with the rest of the world), no land neighbours, no blocs.
export function testSimData(
  nations: NationId[],
  options: {
    goods?: Good[];
    row?: RowData;
    blocs?: Bloc[];
    landNeighbours?: [NationId, NationId][];
    bordersNeutralLand?: NationId[];
    seas?: SeaZone[];
  } = {},
): SimData {
  return {
    goods: options.goods ?? testGoods(),
    row: options.row ?? testRow(),
    blocs: options.blocs ?? [],
    divisions: TEST_DIVISIONS,
    casusBelli: TEST_CASUS_BELLI,
    seas: options.seas ?? [],
    geography: {
      landNeighbours: options.landNeighbours ?? [],
      bordersNeutralLand: options.bordersNeutralLand ?? nations,
    },
  };
}
