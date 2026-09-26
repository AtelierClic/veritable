import { loadVeritableConfig } from "../../data/loadConfig";
import { Bloc } from "../../data/schemas/bloc";
import { NationData } from "../../data/schemas/nation";
import { DiplomacyState } from "../../data/schemas/save";
import { Scenario } from "../../data/schemas/scenario";
import { decodeSave, encodeSave } from "../../save/serialize";
import { setRelation } from "../diplomacy/diplomacy";
import { MemoryWorld } from "../testing/MemoryWorld";
import { testNation, testScenario } from "../testing/nations";
import { testBloc, testSimData } from "../testing/simData";
import { VeritableSimImpl } from "../VeritableSimImpl";
import { perceive } from "./intel";
import { intelRead } from "./state";

// Intelligence in the simulation (J7b): the levels of the player on every
// other nation in the view, the terms of the affinity, the snapshots of the
// month, quarter and year, the relations kept for the trend, the save.

const DAY = 1440;

// AAA (the player) and BBB share an alliance; AAA and CCC a union; DDD is
// alone, a closed regime; AAA guarantees DDD.
const BLOCS: Bloc[] = [
  testBloc({
    id: "alliance",
    type: "military-alliance",
    members: [
      { nation: "AAA", status: "full" },
      { nation: "BBB", status: "full" },
    ],
  }),
  testBloc({
    id: "union",
    type: "economic-union",
    members: [
      { nation: "AAA", status: "full" },
      { nation: "CCC", status: "full" },
    ],
  }),
];

function campaign(guarantees: Scenario["guarantees"] = []) {
  const config = structuredClone(loadVeritableConfig());
  config.economy.growth.noiseMonthlySd = 0;
  config.politics.aiShock.sd = 0;
  config.politics.coups.militaryScale = 0;
  const ids = ["AAA", "BBB", "CCC", "DDD"];
  const sheets = new Map<string, NationData>(
    ids.map((id) => [
      id,
      testNation(id, id === "DDD" ? { regime: "single-party" } : {}),
    ]),
  );
  const scenario = testScenario(ids);
  const sim = new VeritableSimImpl({
    config,
    world: new MemoryWorld(4, 4),
    data: { ...testSimData(ids, { blocs: BLOCS }), guarantees },
    nationData: (id) => sheets.get(id),
    scenario,
  });
  sim.init(scenario, 5);
  const diplomacy = (sim as unknown as { diplomacy: DiplomacyState }).diplomacy;
  return { sim, diplomacy };
}

describe("intelligence in the simulation (J7b)", () => {
  it("gives the levels of the player on every other nation", () => {
    const { sim, diplomacy } = campaign();
    setRelation(diplomacy, "AAA", "CCC", -30);
    setRelation(diplomacy, "AAA", "DDD", 50);
    const view = sim.read();
    expect(view.playerNation).toBe("AAA");
    const levels = view.intel.levels;
    expect(levels.AAA).toBeUndefined();
    expect(Object.values(levels.BBB).every((l) => l === 3)).toBe(true);
    // A union partner: at least 2 whatever the relation.
    expect(levels.CCC.economy).toBe(2);
    expect(levels.CCC.intentions).toBe(2);
    // A closed regime: its economy at most 1.
    expect(levels.DDD.politics).toBe(2);
    expect(levels.DDD.economy).toBe(1);
  });

  it("breaks the affinity into its terms, a guarantee included", () => {
    const { sim } = campaign([
      { guarantor: "AAA", protected: "DDD", probability: 0.5, note: "t" },
    ]);
    const terms = sim.read().intel.relationTerms;
    expect(terms.BBB.blocs).toBeGreaterThan(0);
    expect(terms.DDD.guarantee).toBe(
      loadVeritableConfig().diplomacy.affinityGuarantee,
    );
    const t = terms.BBB;
    const sum =
      t.blocs +
      t.ideology +
      t.sanctions +
      t.allyAtWar +
      t.mistrust +
      t.claims +
      t.guarantee;
    expect(t.total).toBeCloseTo(Math.max(-100, Math.min(100, sum)), 9);
  });

  it("takes the snapshots of the month, quarter and year, and the relations of the player", () => {
    const { sim } = campaign();
    const first = sim.read().intel.state;
    expect(first.month.date).toBe("2026-01-01");
    expect(first.year.date).toBe("2026-01-01");
    for (let d = 0; d < 95; d++) sim.advance(DAY);
    const view = sim.read();
    const s = view.intel.state;
    expect(s.month.date).toBe("2026-04-01");
    expect(s.quarter.date).toBe("2026-04-01");
    expect(s.year.date).toBe("2026-01-01");
    expect(s.relations.viewer).toBe("AAA");
    expect(s.relations.dates).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
    ]);
    // A level-1 figure reads the start of the quarter.
    const read = intelRead(s, view, view.date, "BBB", "gdp", "quarter");
    expect(read?.asOf).toBe("2026-04-01");
    // Through perceive, a range around it.
    const p = perceive(
      {
        seed: view.seed,
        date: view.date,
        omniscient: false,
        rules: view.intel.rules,
        levels: () => ({ ...view.intel.levels.DDD, economy: 1 }),
        value: (target, metric, at) =>
          intelRead(s, view, view.date, target, metric, at),
      },
      "AAA",
      "DDD",
      "gdp",
    );
    expect(p.kind).toBe("range");
  });

  it("keeps its intelligence through a save", () => {
    const { sim } = campaign();
    for (let d = 0; d < 40; d++) sim.advance(DAY);
    const bytes = encodeSave(sim.snapshot());
    const again = new VeritableSimImpl({
      config: loadVeritableConfig(),
      world: new MemoryWorld(4, 4),
      data: testSimData(["AAA", "BBB", "CCC", "DDD"], { blocs: BLOCS }),
      nationData: (id) => testNation(id, {}),
    });
    again.restore(decodeSave(bytes));
    expect(again.read().intel.state).toEqual(sim.read().intel.state);
    expect(encodeSave(again.snapshot())).toEqual(bytes);
  });
});
