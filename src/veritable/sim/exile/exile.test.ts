import { loadVeritableConfig } from "../../data/loadConfig";
import {
  DiplomacyState,
  EconomyState,
  NationState,
} from "../../data/schemas/save";
import { setRelation } from "../diplomacy/diplomacy";
import {
  acceptsReturn,
  ExileEnv,
  measureExile,
  openExile,
  resistanceMalus,
  stepExile,
} from "./exile";

// Collapse, exile and dissolution (J7c).

const RULES = loadVeritableConfig().exile;

// EXL annexed by ANX; the others weigh their GDP in the world.
function world(
  gdp: Record<string, number>,
  relations: [string, string, number][],
  blocs: Record<string, string[]> = {},
): ExileEnv {
  const ids = Object.keys(gdp);
  const nations = ids.map(
    (id) =>
      ({
        id,
        name: { kind: "literal", text: id },
        regime: null,
        territory: { kind: "tiles" },
        status: id === "EXL" ? "exiled" : "active",
        tileCount: id === "EXL" ? 0 : 10,
        isPlayer: false,
      }) as unknown as NationState,
  );
  const diplomacy = { relations: {} } as unknown as DiplomacyState;
  for (const [a, b, r] of relations) setRelation(diplomacy, a, b, r);
  const economy = {
    nations: Object.fromEntries(ids.map((id) => [id, { gdp: gdp[id] }])),
  } as unknown as EconomyState;
  return {
    rules: RULES,
    diplomacy,
    economy,
    nations,
    blocsOf: (n) =>
      Object.entries(blocs)
        .filter(([, members]) => members.includes(n))
        .map(([b]) => b),
    membersOf: (b) => blocs[b] ?? [],
    date: "2030-01-01",
  };
}

describe("a government in exile", () => {
  it("is recognized at first by the nations closer to it than to its annexer, and supported by its friends hostile to the annexer", () => {
    const env = world({ EXL: 1, ANX: 30, FRD: 20, NEU: 40, PAL: 10 }, [
      ["FRD", "EXL", 60],
      ["FRD", "ANX", -30],
      ["NEU", "EXL", 10],
      ["NEU", "ANX", 0],
      ["PAL", "ANX", 50],
    ]);
    const state = openExile(env, "EXL", "ANX");
    // PAL is closer to the annexer: it does not recognize the exile.
    expect(state.recognizers).toEqual(["FRD", "NEU"]);
    expect(state.recognition).toBeCloseTo(0.6, 12);
    expect(state.support).toBeCloseTo(0.2, 12);
    // The annexer and PAL (not hostile to it) recognize the annexation.
    expect(state.annexation).toBeCloseTo(0.4, 12);
  });

  it("erodes by 0.02 x (1 - S) a month, the least attached first, and lives while R + S >= 0.6", () => {
    const env = world({ EXL: 1, ANX: 20, FRD: 30, A: 10, B: 10, C: 30 }, [
      ["FRD", "EXL", 60],
      ["FRD", "ANX", -30],
      ["A", "EXL", 5],
      ["B", "EXL", 10],
      ["C", "EXL", 20],
      ["A", "ANX", -10],
      ["B", "ANX", -10],
      ["C", "ANX", -10],
    ]);
    const state = openExile(env, "EXL", "ANX");
    expect(state.recognizers).toEqual(["A", "B", "C", "FRD"]);
    // S = 0.3: 0.014 a month; A (0.1 of the world, the least attached)
    // withdraws after a little over seven months.
    for (let m = 0; m < 7; m++) stepExile(env, "EXL", state, 1);
    expect(state.recognizers).toEqual(["A", "B", "C", "FRD"]);
    stepExile(env, "EXL", state, 1);
    expect(state.recognizers).toEqual(["B", "C", "FRD"]);
    expect(state.recognition + state.support).toBeGreaterThan(0.6);
    // Hostile to the annexer, A does not recognize the annexation either.
    expect(state.annexation).toBeCloseTo(0.2, 12);
    // Four more years: it lives on, above the threshold with its friend.
    let outcome = { kind: "lives" } as ReturnType<typeof stepExile>;
    for (let m = 0; m < 48 && outcome.kind === "lives"; m++) {
      outcome = stepExile(env, "EXL", state, 1);
    }
    expect(outcome.kind).toBe("lives");
    expect(state.recognizers).toContain("FRD");
  });

  it("without support, is dissolved within three years: a year under the threshold, or the annexation recognized", () => {
    const env = world({ EXL: 1, ANX: 20, A: 30, B: 30, C: 20 }, [
      ["A", "EXL", 20],
      ["B", "EXL", 20],
      ["C", "EXL", 20],
      ["A", "ANX", 10],
      ["B", "ANX", 10],
      ["C", "ANX", 10],
    ]);
    const state = openExile(env, "EXL", "ANX");
    expect(state.recognition).toBeCloseTo(0.8, 12);
    let months = 0;
    let outcome = { kind: "lives" } as ReturnType<typeof stepExile>;
    while (outcome.kind === "lives" && months < 60) {
      outcome = stepExile(env, "EXL", state, 1);
      months++;
    }
    expect(outcome.kind).toBe("dissolved");
    expect(months).toBeGreaterThanOrEqual(12);
    expect(months).toBeLessThanOrEqual(36);
  });

  it("erodes faster when the blocs it belonged to recognize the annexation", () => {
    const relations: [string, string, number][] = [
      ["A", "EXL", 20],
      ["B", "EXL", 20],
      ["C", "EXL", 20],
      ["A", "ANX", 30],
      ["B", "ANX", -10],
      ["C", "ANX", -10],
    ];
    const gdp = { EXL: 1, ANX: 10, A: 40, B: 25, C: 25 };
    const alone = world(gdp, relations);
    const inBloc = world(gdp, relations, { club: ["EXL", "ANX", "A"] });
    const s1 = openExile(alone, "EXL", "ANX");
    const s2 = openExile(inBloc, "EXL", "ANX");
    // A, closer to the annexer, never recognized it; the club (ANX and A:
    // all its other members) recognizes the annexation from the start, and
    // the exile erodes twice as fast: B and C gone within 13 months, only B
    // alone.
    for (let m = 0; m < 15; m++) {
      stepExile(alone, "EXL", s1, 1);
      stepExile(inBloc, "EXL", s2, 1);
    }
    expect(s1.recognition).toBeCloseTo(0.25, 12);
    expect(s2.recognition).toBe(0);
    expect(measureExile(inBloc, "EXL", s2).annexation).toBeGreaterThan(0.4);
  });

  it("nobody holds its land: no annexation, nothing erodes", () => {
    const env = world({ EXL: 1, A: 10 }, []);
    const state = openExile(env, "EXL", null);
    for (let m = 0; m < 100; m++) {
      expect(stepExile(env, "EXL", state, 1).kind).toBe("lives");
    }
  });
});

describe("resistance and negotiation", () => {
  it("an occupant loses stability with the people of the exile it holds, at most the cap", () => {
    expect(resistanceMalus(RULES, 0, 100)).toBe(0);
    expect(resistanceMalus(RULES, 10, 100)).toBeCloseTo(
      RULES.resistance.weight * 0.1,
      12,
    );
    expect(resistanceMalus(RULES, 100, 100)).toBe(RULES.resistance.cap);
  });

  it("the annexer gives the land back when the resistance weighs on it and it is weak or sanctioned", () => {
    const heavy = RULES.negotiation.resistanceMin;
    expect(acceptsReturn(RULES, heavy, 0.3, 0)).toBe(true);
    expect(acceptsReturn(RULES, heavy, 0.8, 0.5)).toBe(true);
    expect(acceptsReturn(RULES, heavy, 0.8, 0)).toBe(false);
    expect(acceptsReturn(RULES, heavy / 2, 0.1, 1)).toBe(false);
  });
});
