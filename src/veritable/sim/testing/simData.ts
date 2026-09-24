import rawDefense from "../../../../data/veritable/laws/defense.json";
import rawEconomy from "../../../../data/veritable/laws/economy.json";
import rawEnvironment from "../../../../data/veritable/laws/environment.json";
import rawInstitutions from "../../../../data/veritable/laws/institutions.json";
import rawSecurity from "../../../../data/veritable/laws/security.json";
import rawSocial from "../../../../data/veritable/laws/social.json";
import rawObjectives from "../../../../data/veritable/politics/objectives.json";
import rawRegimes from "../../../../data/veritable/politics/regimes.json";
import { Bloc } from "../../data/schemas/bloc";
import { NationId } from "../../data/schemas/common";
import { VeritableEvent } from "../../data/schemas/event";
import { Good, GOOD_IDS, GoodId } from "../../data/schemas/goods";
import { Law, LawsSchema } from "../../data/schemas/laws";
import { LeadersData } from "../../data/schemas/leaders";
import {
  NamePool,
  Objective,
  ObjectivesSchema,
  RegimeData,
  RegimesSchema,
} from "../../data/schemas/politics";
import { RowData } from "../../data/schemas/row";
import { SeaZone } from "../../data/schemas/seas";
import { TechNode } from "../../data/schemas/tech";
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
  {
    id: "grievance",
    name: "casus.grievance",
    check: "grievance",
    relationsCost: 8,
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
// The real regimes, laws and objectives: they are data, not balancing of a
// test.
export const TEST_REGIMES: RegimeData[] = RegimesSchema.parse(rawRegimes);
export const TEST_LAWS: Law[] = LawsSchema.parse([
  ...rawDefense,
  ...rawEconomy,
  ...rawEnvironment,
  ...rawInstitutions,
  ...rawSecurity,
  ...rawSocial,
]);
export const TEST_OBJECTIVES: Objective[] =
  ObjectivesSchema.parse(rawObjectives);

// Two parties per nation (a left one in power, a right one in opposition),
// a head of government leading the first, a head of state, and a military
// chief. Ideologies and traits are plain numbers a test can reason about.
export function testLeaders(
  id: NationId,
  options: {
    incumbentSupport?: number;
    incumbentIdeology?: {
      economic: number;
      authority: number;
      sovereignty: number;
    };
    oppositionIdeology?: {
      economic: number;
      authority: number;
      sovereignty: number;
    };
    charisma?: number;
  } = {},
): LeadersData {
  const lower = id.toLowerCase();
  const left = options.incumbentIdeology ?? {
    economic: -0.4,
    authority: -0.2,
    sovereignty: -0.2,
  };
  const right = options.oppositionIdeology ?? {
    economic: 0.5,
    authority: 0.3,
    sovereignty: 0.3,
  };
  const traits = (ideology: typeof left, charisma: number) => ({
    ...ideology,
    aggressiveness: 0.3,
    corruption: 0.2,
    charisma,
    competence: 0.5,
  });
  const support = options.incumbentSupport ?? 0.55;
  return {
    nation: id,
    actors: [
      {
        id: `${lower}-pm`,
        role: "head-of-government",
        names: {
          parody: `leader.${lower}.pm.parody`,
          fictional: `leader.${lower}.pm.fictional`,
        },
        born: "1970-06-15",
        party: `${lower}-left`,
        traits: traits(left, options.charisma ?? 0.5),
        wikidata: null,
        source: "test",
        asOf: "2026-01-01",
      },
      {
        id: `${lower}-president`,
        role: "head-of-state",
        names: {
          parody: `leader.${lower}.president.parody`,
          fictional: `leader.${lower}.president.fictional`,
        },
        born: "1960-03-01",
        party: null,
        traits: traits(left, 0.5),
        wikidata: null,
        source: "test",
        asOf: "2026-01-01",
      },
      {
        id: `${lower}-opposition`,
        role: "party-leader",
        names: {
          parody: `leader.${lower}.opposition.parody`,
          fictional: `leader.${lower}.opposition.fictional`,
        },
        born: "1975-09-20",
        party: `${lower}-right`,
        traits: traits(right, 0.5),
        wikidata: null,
        source: "test",
        asOf: "2026-01-01",
      },
    ],
    parties: [
      {
        id: `${lower}-left`,
        name: `party.${lower}.left`,
        wikidata: null,
        ideologies: [],
        ideology: left,
        ideologySource: "test",
        support,
        supportSource: { source: "test", asOf: "2026-01-01" },
        leader: `${lower}-pm`,
      },
      {
        id: `${lower}-right`,
        name: `party.${lower}.right`,
        wikidata: null,
        ideologies: [],
        ideology: right,
        ideologySource: "test",
        support: 1 - support,
        supportSource: { source: "test", asOf: "2026-01-01" },
        leader: `${lower}-opposition`,
      },
    ],
  };
}

export function testNames(id: NationId): NamePool {
  return {
    nation: id,
    first: ["Alex", "Bo", "Cam", "Dana", "Eli", "Fay"],
    last: ["Adler", "Brook", "Cole", "Dorn", "Elm", "Frost"],
  };
}

export function testSimData(
  nations: NationId[],
  options: {
    goods?: Good[];
    row?: RowData;
    blocs?: Bloc[];
    landNeighbours?: [NationId, NationId][];
    bordersNeutralLand?: NationId[];
    seas?: SeaZone[];
    laws?: Law[];
    leaders?: Record<NationId, LeadersData>;
    tech?: TechNode[];
    events?: VeritableEvent[];
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
    regimes: TEST_REGIMES,
    laws: options.laws ?? TEST_LAWS,
    objectives: TEST_OBJECTIVES,
    leaders: Object.fromEntries(
      nations.map((id) => [id, options.leaders?.[id] ?? testLeaders(id)]),
    ),
    names: Object.fromEntries(nations.map((id) => [id, testNames(id)])),
    tech: options.tech ?? [],
    events: options.events ?? [],
  };
}

// A bloc for the tests: the layers 2 and 3 fields filled with defaults
// (consensus everywhere, a short accession, a free exit, rotating
// leadership in the order of the members).
export function testBloc(
  bloc: Pick<Bloc, "id" | "members"> & Partial<Bloc>,
): Bloc {
  return {
    name: `bloc.${bloc.id}`,
    layer: 1,
    decisionRules: {
      sanctions: "consensus",
      lift: "consensus",
      accession: "consensus",
      suspension: "consensus",
      budget: "consensus",
      defense: "consensus",
      tech: "consensus",
      trade: "consensus",
    },
    accession: { monthsMin: 12, monthsMax: 24 },
    exit: { delayMonths: 12, tradeCostPctGdp: 0 },
    leadership: { kind: "rotating", termMonths: 6 },
    ...bloc,
  };
}
