import { loadVeritableConfig } from "../../data/loadConfig";
import { NationData } from "../../data/schemas/nation";
import { decodeSave, encodeSave } from "../../save/serialize";
import { MemoryWorld } from "../testing/MemoryWorld";
import { testNation, testScenario } from "../testing/nations";
import { testSimData } from "../testing/simData";
import { VeritableSimImpl } from "../VeritableSimImpl";

const DAY = 1440;

// J5: the legacy gold is no resource in a campaign; what a nation builds on
// the map is paid by its national budget the month after.
describe("structures built on the map are paid by the national budget", () => {
  function setup() {
    const config = structuredClone(loadVeritableConfig());
    config.economy.growth.noiseMonthlySd = 0;
    config.economy.rowSupplyNoise.monthlySd = 0;
    config.politics.aiShock.sd = 0;
    const ids = ["AAA", "BBB"];
    const sheets = new Map<string, NationData>(
      ids.map((id) => [id, testNation(id)]),
    );
    const world = new MemoryWorld(4, 4);
    world.built.set("AAA", { City: 1 });
    world.built.set("BBB", { City: 1 });
    const sim = new VeritableSimImpl({
      config,
      world,
      data: testSimData(ids),
      nationData: (id) => sheets.get(id),
    });
    sim.init(testScenario(ids), 3);
    const month = () => {
      for (let d = 0; d < 31; d++) sim.advance(DAY);
    };
    return { sim, world, config, month };
  }

  it("charges the new structures and levels once, at their price, and nothing for those of the first day", () => {
    const { sim, world, config, month } = setup();
    month();
    expect(sim.read().constructionCost).toEqual({ AAA: 0, BBB: 0 });

    // AAA builds a port and raises its city one level.
    world.built.set("AAA", { City: 2, Port: 1 });
    const debtBefore = sim.read().economies.AAA.debt;
    month();
    const prices = config.budget.structureCostUsd;
    expect(sim.read().constructionCost.AAA).toBe(prices.City + prices.Port);
    expect(sim.read().constructionCost.BBB).toBe(0);
    // The twin nation that built nothing has the same budget otherwise: the
    // debt of AAA grows by the cost more than it would have.
    expect(sim.read().economies.AAA.debt).toBeGreaterThan(debtBefore);

    // Nothing new: nothing charged; a structure lost then rebuilt is paid
    // again.
    month();
    expect(sim.read().constructionCost.AAA).toBe(0);
    world.built.set("AAA", { City: 2 });
    month();
    world.built.set("AAA", { City: 2, Port: 1 });
    month();
    expect(sim.read().constructionCost.AAA).toBe(prices.Port);
  });

  it("the counts survive a save", () => {
    const { sim, world, month } = setup();
    world.built.set("AAA", { City: 3 });
    month();
    const again = decodeSave(encodeSave(sim.snapshot()));
    expect(again.territory.structures.AAA).toEqual({ City: 3 });
    expect(again.territory.constructionCost.AAA).toBeGreaterThan(0);
  });
});
