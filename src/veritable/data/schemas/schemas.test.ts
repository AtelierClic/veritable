import { hasTextKey, vt } from "../i18n";
import { loadVeritableConfig } from "../loadConfig";
import { REGIMES } from "./common";
import { VeritableConfigSchema } from "./config";
import { NationDataSchema } from "./nation";
import { JOURNAL_KINDS, NATION_STATUSES, SaveHeaderV1Schema } from "./save";
import { ScenarioSchema } from "./scenario";

// Fixture taken from docs/veritable/DATA-SCHEMAS.md. Real sheets arrive at J2.
const fra = {
  id: "FRA",
  name: "nation.fra.name",
  capital: { tileHint: [10, 20] },
  regime: "semi-presidential",
  blocs: ["eu", "nato", "g7", "g20"],
  nuclear: { warheads: 290, doctrine: "first-use-possible" },
  territory: { kind: "tiles" },
  contested: [],
  population: { value: 68.5e6, source: "worldbank", asOf: "2025" },
  gdp: { value: 3.1e12, source: "worldbank", asOf: "2025" },
  debtToGdp: { value: 1.1, source: "worldbank", asOf: "2025" },
  production: { oil: 0.02, gas: 0.01, electricity: 1.0, food: 1.2 },
  military: {
    spendingPctGdp: 2.0,
    activePersonnel: 200000,
    airPower: 0.6,
    navalPower: 0.7,
    source: "sipri",
    asOf: "2025",
  },
  startingTech: ["energy-nuclear-3", "air-4"],
  interestGroups: {
    business: 0.15,
    workers: 0.2,
    farmers: 0.05,
    military: 0.05,
    religious: 0.05,
    youth: 0.15,
    retirees: 0.2,
    minorities: 0.15,
  },
  aiAgenda: [
    { goal: "security", weight: 0.4 },
    { goal: "growth", weight: 0.3 },
  ],
};

const scenario = {
  id: "test",
  map: "world",
  startDate: "2026-01-01",
  nations: ["FRA", "DEU"],
  contested: [
    {
      region: "crimea",
      controller: "RUS",
      claimants: ["UKR"],
      recognizedBy: [],
    },
  ],
  wars: [],
  playerDefault: "FRA",
};

describe("nation schema", () => {
  it("accepts the reference sheet", () => {
    expect(NationDataSchema.parse(fra).id).toBe("FRA");
  });

  it("accepts a microstate without tiles", () => {
    const vat = {
      ...fra,
      id: "VAT",
      nuclear: null,
      territory: { kind: "microstate", hostTile: [5, 5] },
    };
    expect(NationDataSchema.parse(vat).territory.kind).toBe("microstate");
  });

  it("rejects an unknown regime and an unsourced figure", () => {
    expect(() =>
      NationDataSchema.parse({ ...fra, regime: "republic" }),
    ).toThrow();
    expect(() =>
      NationDataSchema.parse({ ...fra, gdp: { value: 1 } }),
    ).toThrow();
  });
});

describe("scenario schema", () => {
  it("accepts a valid scenario", () => {
    expect(ScenarioSchema.parse(scenario).nations).toHaveLength(2);
  });

  it("rejects a player nation outside the scenario", () => {
    expect(() =>
      ScenarioSchema.parse({ ...scenario, playerDefault: "USA" }),
    ).toThrow();
  });

  it("rejects duplicate nation ids, ad-hoc ones included", () => {
    expect(() =>
      ScenarioSchema.parse({
        ...scenario,
        adHocNations: [{ id: "FRA", literalName: "France" }],
      }),
    ).toThrow();
  });
});

describe("config", () => {
  it("data/veritable/config.json is valid", () => {
    const config = loadVeritableConfig();
    expect(config.time.gameMinutesPerTick).toBeGreaterThan(0);
  });

  it("rejects a non-positive tick duration", () => {
    expect(() =>
      VeritableConfigSchema.parse({
        leaderNames: "parody",
        time: { gameMinutesPerTick: 0 },
      }),
    ).toThrow();
  });
});

describe("save header schema", () => {
  const header = {
    schemaVersion: 1 as const,
    seed: 42,
    rngState: [1, 2, 3, 4] as [number, number, number, number],
    calendar: {
      startDate: "2026-01-01",
      elapsedGameMinutes: 1440.5,
      date: "2026-01-02",
      speed: 1,
    },
    nations: [
      {
        id: "FRA",
        name: { kind: "key" as const, key: "nation.fra.name" },
        regime: "semi-presidential" as const,
        territory: { kind: "tiles" as const },
        status: "active" as const,
        tileCount: 12,
        isPlayer: true,
      },
      {
        id: "VAT",
        name: { kind: "literal" as const, text: "Vatican" },
        regime: null,
        territory: {
          kind: "microstate" as const,
          hostTile: [3, 4] as [number, number],
        },
        status: "active" as const,
        tileCount: 0,
        isPlayer: false,
      },
    ],
    blocs: [],
    world: {
      coreStart: { gameID: "abc", nested: { a: [1, 2] } },
      players: [
        {
          nation: "FRA",
          troops: 1234.5,
          gold: 5_000_000_000_000n,
          spawnTile: 17,
          structures: [{ type: "City", tile: 17, level: 2 }],
        },
      ],
    },
    journal: [
      { date: "2026-01-01", kind: "campaign-started" as const, params: {} },
    ],
    metrics: { ticks: 20 },
    tilesInfo: { width: 4, height: 2 },
  };

  it("round-trips through zbin byte for byte", () => {
    const bytes = SaveHeaderV1Schema.serialize(header);
    const back = SaveHeaderV1Schema.parseBytes(bytes);
    expect(back).toEqual(header);
    expect(SaveHeaderV1Schema.serialize(back)).toEqual(bytes);
  });

  it("rejects another schemaVersion", () => {
    expect(() =>
      SaveHeaderV1Schema.parse({ ...header, schemaVersion: 2 }),
    ).toThrow();
  });
});

describe("i18n fr.json", () => {
  it("has a label for every regime, status and journal kind", () => {
    for (const r of REGIMES) expect(hasTextKey(`regime.${r}`)).toBe(true);
    for (const s of NATION_STATUSES)
      expect(hasTextKey(`nation.status.${s}`)).toBe(true);
    for (const k of JOURNAL_KINDS)
      expect(hasTextKey(`journal.${k}`)).toBe(true);
  });

  it("interpolates parameters and exposes missing keys", () => {
    expect(vt("save.panel.date", { date: "2026-01-01" })).toBe(
      "Date : 2026-01-01",
    );
    expect(vt("no.such.key")).toBe("no.such.key");
  });
});
