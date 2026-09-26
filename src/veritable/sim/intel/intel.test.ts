import {
  IntelFacts,
  IntelLevels,
  IntelMetric,
  IntelRules,
  IntelSource,
  intelLevels,
  perceive,
  unitHash,
} from "./intel";

const RULES: IntelRules = {
  relationLevels: [0, 40, 70],
  precision: [0.4, 0.2, 0.05],
  openRegimes: ["parliamentary", "presidential", "semi-presidential"],
  closedRegimes: [
    "single-party",
    "junta",
    "absolute-monarchy",
    "theocracy",
    "failed-state",
  ],
};

const facts = (over: Partial<IntelFacts>): IntelFacts => ({
  relation: 10,
  alliance: false,
  union: false,
  neighbour: false,
  atWar: false,
  regime: "electoral-authoritarian",
  ...over,
});

describe("intelligence levels (J7)", () => {
  it("follow the relation", () => {
    expect(intelLevels(RULES, facts({ relation: 75 })).politics).toBe(3);
    expect(intelLevels(RULES, facts({ relation: 45 })).politics).toBe(2);
    expect(intelLevels(RULES, facts({ relation: 5 })).politics).toBe(1);
    expect(intelLevels(RULES, facts({ relation: -5 })).politics).toBe(0);
  });

  it("open up to an ally and, partly, to a partner of a union", () => {
    const ally = intelLevels(RULES, facts({ relation: -20, alliance: true }));
    expect(Object.values(ally).every((l) => l === 3)).toBe(true);
    const union = intelLevels(RULES, facts({ relation: -20, union: true }));
    expect(union.economy).toBe(2);
    expect(union.army).toBe(2);
  });

  it("see the forces in contact of a neighbour or an enemy", () => {
    expect(intelLevels(RULES, facts({ relation: -80 })).army).toBe(0);
    expect(
      intelLevels(RULES, facts({ relation: -80, neighbour: true })).army,
    ).toBe(1);
    expect(
      intelLevels(RULES, facts({ relation: -100, atWar: true })).army,
    ).toBe(1);
  });

  it("read public statistics in a democracy, little behind a closed regime", () => {
    expect(
      intelLevels(RULES, facts({ relation: -50, regime: "parliamentary" }))
        .economy,
    ).toBe(2);
    expect(
      intelLevels(RULES, facts({ relation: 60, regime: "single-party" }))
        .economy,
    ).toBe(1);
    expect(
      intelLevels(
        RULES,
        facts({ relation: 60, regime: "single-party", alliance: true }),
      ).economy,
    ).toBe(3);
    expect(intelLevels(RULES, facts({ relation: -90 })).general).toBe(3);
  });
});

function source(
  levels: IntelLevels,
  values: Partial<Record<IntelMetric, number>>,
  over: Partial<IntelSource> = {},
): IntelSource {
  return {
    seed: 42,
    date: "2031-05-17",
    omniscient: false,
    rules: RULES,
    levels: () => levels,
    value: (_target, metric, at) => {
      const v = values[metric];
      if (v === undefined) return null;
      const asOf =
        at === "live"
          ? "2031-05-17"
          : at === "month"
            ? "2031-05-01"
            : at === "quarter"
              ? "2031-04-01"
              : "2031-01-01";
      return { value: v, asOf };
    },
    ...over,
  };
}

const at = (level: 0 | 1 | 2 | 3): IntelLevels => ({
  general: 3,
  economy: level,
  politics: level,
  army: level,
  nuclear: level,
  intentions: level,
});

describe("perceive (J7)", () => {
  it("gives the exact value live at level 3, to the omniscient, and of one's own nation", () => {
    expect(perceive(source(at(3), { gdp: 5e11 }), "FRA", "DEU", "gdp")).toEqual(
      { kind: "exact", value: 5e11, asOf: "2031-05-17", level: 3 },
    );
    const blind = source(at(0), { gdp: 5e11 }, { omniscient: true });
    expect(perceive(blind, "FRA", "DEU", "gdp").kind).toBe("exact");
    expect(
      perceive(source(at(0), { gdp: 5e11 }), "FRA", "FRA", "gdp").kind,
    ).toBe("exact");
  });

  it("gives a range that holds the truth, of the width of the level, dated by its freshness", () => {
    for (const [level, width, asOf] of [
      [2, 0.1, "2031-05-01"],
      [1, 0.4, "2031-04-01"],
      [0, 0.8, "2031-01-01"],
    ] as const) {
      for (const target of ["DEU", "ITA", "ESP", "POL", "RUS", "TUR"]) {
        const p = perceive(
          source(at(level), { gdp: 1e12 }),
          "FRA",
          target,
          "gdp",
        );
        expect(p.kind).toBe("range");
        if (p.kind !== "range") continue;
        expect(p.low).toBeLessThanOrEqual(1e12);
        expect(p.high).toBeGreaterThanOrEqual(1e12);
        expect((p.high - p.low) / 1e12).toBeCloseTo(width, 6);
        expect(p.asOf).toBe(asOf);
      }
    }
  });

  it("does not centre its ranges on the truth, and moves them each year", () => {
    const middles = [
      "DEU",
      "ITA",
      "ESP",
      "POL",
      "RUS",
      "TUR",
      "NOR",
      "GBR",
    ].map((target) => {
      const p = perceive(source(at(1), { gdp: 1e12 }), "FRA", target, "gdp");
      return p.kind === "range" ? (p.low + p.high) / 2 / 1e12 : 1;
    });
    expect(new Set(middles.map((m) => m.toFixed(6))).size).toBe(8);
    expect(middles.some((m) => Math.abs(m - 1) > 0.05)).toBe(true);
    const later = perceive(
      source(at(1), { gdp: 1e12 }, { date: "2032-05-17" }),
      "FRA",
      "DEU",
      "gdp",
    );
    const now = perceive(source(at(1), { gdp: 1e12 }), "FRA", "DEU", "gdp");
    expect(later).not.toEqual(now);
  });

  it("hides armies, arsenals and intentions at level 0, intentions below 3", () => {
    expect(
      perceive(source(at(0), { divisions: 40 }), "FRA", "RUS", "divisions")
        .kind,
    ).toBe("unknown");
    expect(
      perceive(source(at(0), { warheads: 5000 }), "FRA", "RUS", "warheads")
        .kind,
    ).toBe("unknown");
    expect(
      perceive(source(at(2), { coupRisk: 0.01 }), "FRA", "RUS", "coupRisk")
        .kind,
    ).toBe("unknown");
    expect(
      perceive(source(at(3), { coupRisk: 0.01 }), "FRA", "RUS", "coupRisk")
        .kind,
    ).toBe("exact");
  });

  it("keeps shares within [0, 1] and counts whole", () => {
    const p = perceive(
      source(at(0), { stability: 0.97 }),
      "FRA",
      "DEU",
      "stability",
    );
    expect(p.kind === "range" && p.high <= 1 && p.low >= 0).toBe(true);
    const d = perceive(
      source(at(1), { divisions: 13 }),
      "FRA",
      "DEU",
      "divisions",
    );
    expect(
      d.kind === "range" && Number.isInteger(d.low) && Number.isInteger(d.high),
    ).toBe(true);
  });

  it("gives the population to within 5 % whatever the level", () => {
    const p = perceive(
      source(at(0), { population: 1e8 }),
      "FRA",
      "RUS",
      "population",
    );
    expect(p.kind).toBe("range");
    if (p.kind === "range") expect((p.high - p.low) / 1e8).toBeCloseTo(0.1, 6);
  });

  it("hashes to the unit interval", () => {
    for (const text of ["", "a", "42|FRA|DEU|gdp|2031"]) {
      const u = unitHash(text);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
});
