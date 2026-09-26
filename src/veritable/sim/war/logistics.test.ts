import { loadVeritableConfig } from "../../data/loadConfig";
import { VeritableConfig } from "../../data/schemas/config";
import { NationData } from "../../data/schemas/nation";
import { MemoryWorld } from "../testing/MemoryWorld";
import { testNation, testScenario } from "../testing/nations";
import { testSimData } from "../testing/simData";
import { VeritableSimImpl } from "../VeritableSimImpl";

const TICK = 72;
const DAY = 1440;

// Logistics (J3b): a segment supports base + perStructure x structures +
// infrastructureScale x infrastructure share divisions; beyond it the force
// is scaled down. Piling twenty divisions on one segment does not give
// twenty divisions of force.
function campaign(structures: number, infrastructure: number) {
  const world = new MemoryWorld(40, 40);
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 40; x++)
      world.setOwner(y * 40 + x, x < 20 ? "AAA" : "BBB");
  }
  for (let i = 0; i < structures; i++) world.setStructure(i * 40, 1); // AAA cities
  const sheets = new Map<string, NationData>();
  for (const id of ["AAA", "BBB"]) {
    const sheet = testNation(id, { spending: { infrastructure } });
    sheet.military.activePersonnel = id === "AAA" ? 300_000 : 30_000;
    sheets.set(id, sheet);
  }
  const config: VeritableConfig = structuredClone(loadVeritableConfig());
  config.economy.growth.noiseMonthlySd = 0;
  config.economy.rowSupplyNoise.monthlySd = 0;
  config.war.segmentTiles = 80; // one segment
  const scenario = testScenario(["AAA", "BBB"]);
  const sim = new VeritableSimImpl({
    config,
    world,
    data: testSimData(["AAA", "BBB"]),
    nationData: (id) => sheets.get(id),
    scenario,
  });
  sim.init(scenario, 2);
  sim.apply({ type: "declare-war", target: "BBB", casusBelli: "none" });
  sim.advance(TICK);
  for (const d of sim.read().military.nations.AAA.divisions) {
    sim.apply({
      type: "assign-division",
      division: d.id,
      front: "AAA|BBB",
      segment: 0,
    });
    sim.apply({ type: "set-posture", division: d.id, posture: "attack" });
  }
  sim.advance(DAY);
  const view = sim.read();
  // J7: the strikes of the enemy air force start with the war (they waited
  // for the 1st of the month until the J6) and take their share of the
  // capacity.
  const struck = 1 - view.economies.AAA.strikeDamage;
  return { ...view.fronts[0].segments[0].sides.AAA, struck };
}

describe("logistics", () => {
  it("a bare segment supports the base capacity: twenty divisions fight at a fraction", () => {
    const side = campaign(0, 0);
    expect(side.divisions).toBe(21); // 300 000 men in the starting mix
    // capacity = 2 + 0 + 50 x 0 = 2 divisions (less the strikes)
    expect(side.supply).toBeCloseTo((2 * side.struck) / 21, 6);
  });

  it("cities nearby and infrastructure spending raise the capacity", () => {
    const bare = campaign(0, 0);
    const served = campaign(3, 0.04);
    // capacity = 2 + 2 x 3 + 50 x 0.04 = 10 divisions (less the strikes)
    expect(served.supply).toBeCloseTo((10 * served.struck) / 21, 6);
    expect(served.force).toBeGreaterThan(bare.force * 4);
  });

  it("is a ceiling, never a bonus", () => {
    const side = campaign(20, 0.1);
    expect(side.supply).toBe(1);
  });
});
