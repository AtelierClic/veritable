import { loadVeritableConfig } from "../../data/loadConfig";
import { VeritableConfig } from "../../data/schemas/config";
import { NationData } from "../../data/schemas/nation";
import { MemoryWorld } from "../testing/MemoryWorld";
import { testNation, testScenario } from "../testing/nations";
import { testSimData } from "../testing/simData";
import { VeritableSimImpl } from "../VeritableSimImpl";

const DAY = 1440;

function quietConfig(): VeritableConfig {
  const config = structuredClone(loadVeritableConfig());
  config.economy.growth.noiseMonthlySd = 0;
  config.economy.rowSupplyNoise.monthlySd = 0;
  return config;
}

function campaign(personnel: number, population = 10_000_000) {
  const sheet = testNation("AAA");
  sheet.military.activePersonnel = personnel;
  sheet.population.value = population;
  const other = testNation("BBB");
  const sheets = new Map<string, NationData>([
    ["AAA", sheet],
    ["BBB", other],
  ]);
  const sim = new VeritableSimImpl({
    config: quietConfig(),
    world: new MemoryWorld(4, 4),
    data: testSimData(["AAA", "BBB"]),
    nationData: (id) => sheets.get(id),
  });
  sim.init(testScenario(["AAA", "BBB"]), 3);
  const months = (n: number) => {
    for (let d = 0; d < 31 * n; d++) sim.advance(DAY);
  };
  return { sim, months };
}

describe("divisions and manpower", () => {
  it("the standing army of the sheet becomes divisions by the starting mix; the pool holds the rest", () => {
    const { sim } = campaign(150_000);
    const m = sim.read().military.nations.AAA;
    // 150 000 men: 75 000 infantry (5), 37 500 mechanised (2), 22 500
    // armoured (1), 15 000 artillery (1).
    expect(m.divisions.map((d) => d.template)).toEqual([
      "infantry",
      "infantry",
      "infantry",
      "infantry",
      "infantry",
      "mechanized",
      "mechanized",
      "armored",
      "artillery",
    ]);
    expect(m.conscription).toBe("partial"); // 0.5 % of 10 M < 150 000
    const manned = 5 * 15000 + 2 * 15000 + 12000 + 10000;
    expect(m.manpower).toBe(150_000 - manned);
    expect(
      m.divisions.every((d) => d.equipment === 1 && d.front === null),
    ).toBe(true);
  });

  it("raising takes men from the pool, disbanding gives them back; conscription sets the ceiling", () => {
    const { sim, months } = campaign(30_000);
    const before = sim.read().military.nations.AAA;
    expect(before.conscription).toBe("peace");
    // 30 000 men: one infantry division (15 000), the rest in the pool.
    expect(before.divisions.map((d) => d.template)).toEqual(["infantry"]);
    expect(before.manpower).toBe(50_000 - 15_000);
    sim.apply({ type: "raise-division", template: "armored" });
    sim.apply({ type: "raise-division", template: "armored" });
    let m = sim.read().military.nations.AAA;
    expect(m.divisions[m.divisions.length - 1]).toMatchObject({
      template: "armored",
      men: 12000,
      equipment: 0.5,
    });
    expect(m.manpower).toBe(35_000 - 24_000);
    expect(() =>
      sim.apply({ type: "raise-division", template: "mechanized" }),
    ).toThrow(/manpower/);
    // A higher conscription level raises the ceiling; the pool refills monthly.
    sim.apply({ type: "set-conscription", level: "total" });
    expect(sim.read().military.nations.AAA.manpower).toBe(11_000);
    months(1);
    expect(sim.read().military.nations.AAA.manpower).toBe(11_000 + 20_000);
    sim.apply({ type: "raise-division", template: "mechanized" });
    m = sim.read().military.nations.AAA;
    sim.apply({
      type: "disband-division",
      division: m.divisions[m.divisions.length - 1].id,
    });
    m = sim.read().military.nations.AAA;
    expect(m.conscription).toBe("total");
    expect(m.divisions.map((d) => d.template)).toEqual([
      "infantry",
      "armored",
      "armored",
    ]);
    expect(m.manpower).toBe(31_000);
  });

  it("orders: assignment to a front or segment, posture", () => {
    const { sim } = campaign(30_000);
    const id = sim.read().military.nations.AAA.divisions[0].id;
    sim.apply({
      type: "assign-division",
      division: id,
      front: "AAA|BBB",
      segment: 2,
    });
    sim.apply({ type: "set-posture", division: id, posture: "attack" });
    expect(sim.read().military.nations.AAA.divisions[0]).toMatchObject({
      front: "AAA|BBB",
      segment: 2,
      posture: "attack",
    });
    sim.apply({
      type: "assign-division",
      division: id,
      front: null,
      segment: 4,
    });
    expect(sim.read().military.nations.AAA.divisions[0]).toMatchObject({
      front: null,
      segment: null,
    });
    expect(() =>
      sim.apply({ type: "set-posture", division: 999, posture: "defend" }),
    ).toThrow(/no division/);
  });

  it("every month the pool refills, arms re-equip the divisions, exhaustion recovers in peace", () => {
    const { sim, months } = campaign(30_000);
    sim.apply({ type: "raise-division", template: "infantry" });
    expect(
      sim.read().military.nations.AAA.divisions.slice(-1)[0].equipment,
    ).toBe(0.5);
    months(1);
    const m = sim.read().military.nations.AAA;
    // 5 % of the 50 000 ceiling would come in, but the pool is capped by the
    // ceiling minus the men in the divisions.
    expect(m.manpower).toBe(50_000 - 30_000);
    expect(m.divisions[m.divisions.length - 1].equipment).toBeGreaterThan(0.5);
    expect(m.exhaustion).toBe(0);
    expect(m.airPower).toBeCloseTo(0.5, 6);
  });

  it("defence spending above the first day trains the army", () => {
    const { sim, months } = campaign(30_000);
    sim.apply({ type: "set-spending", post: "defense", share: 0.05 }); // +3 points
    // The slider ramps over months (J4): wait for it to settle.
    months(30);
    const m = sim.read().military.nations.AAA;
    expect(m.training).toBeCloseTo(1.3, 1);
    expect(m.divisions[0].training).toBeGreaterThan(1);
  });
});
