import { BordersWorld } from "../../../src/veritable/adapters/BordersWorld";
import { loadScenarioPackFrom } from "../../../src/veritable/adapters/scenarioPackFrom";
import { ScenarioPack } from "../../../src/veritable/adapters/scenarioWorld";
import { createDataSource } from "../../../src/veritable/data/DataSource";
import { fsDataFiles } from "../../../src/veritable/data/files.fs";
import { VeritableConfig } from "../../../src/veritable/data/schemas/config";
import { ReadonlyWorldView } from "../../../src/veritable/sim/VeritableSim";
import { VeritableSimImpl } from "../../../src/veritable/sim/VeritableSimImpl";

// J7: every update of a nation integrates the time elapsed since the one
// before; nothing assumes « one step = one month » any more. The same year of
// europe-10 with every nation updated every day, or once a month, ends with
// the same GDP, debt and population to 1 %, and the same opinion to 1 point.
// Without the noise, the events, the political shocks and the decisions
// drawn (coups, wars, bloc programmes, trade agreements, applications): the
// draws of the Rng differ between the two cadences, and a decision drawn in
// one run and not in the other would part them for reasons that are not
// time. The nations updated once a month are read up to a month after
// their last update: the gap left is that lag.

const source = createDataSource(fsDataFiles());
let pack: ScenarioPack;
let config: VeritableConfig;

beforeAll(async () => {
  pack = await loadScenarioPackFrom(source, "europe-10");
  config = source.config();
});

function year(days: number): ReadonlyWorldView {
  const c = structuredClone(config);
  c.economy.growth.noiseMonthlySd = 0;
  c.economy.rowSupplyNoise.monthlySd = 0;
  c.politics.aiShock.sd = 0;
  c.politics.coups.militaryScale = 0;
  c.ai.nations.war.declareProbability = 0;
  c.blocs.ai.techProgramProbability = 0;
  c.blocs.ai.tradeAgreementProbability = 0;
  c.blocs.ai.applyProbability = 0;
  c.schedule.playerDays = days;
  c.schedule.interactionDays = days;
  c.schedule.stakesDays = days;
  c.schedule.calmDays = days;
  const sim = new VeritableSimImpl({
    config: c,
    world: new BordersWorld(pack.borders, pack.zones, undefined, pack.regions),
    data: { ...pack.data, events: [] },
    nationData: (id) => pack.nations.find((n) => n.id === id),
    scenario: pack.scenario,
    autopilot: true,
  });
  sim.init(pack.scenario, 42);
  for (let d = 0; d < 365; d++) sim.advance(1440);
  return sim.read();
}

describe("the time elapsed, integrated (J7)", () => {
  it("30 daily updates or 1 monthly one: after a year, the same GDP, debt and population to 1 %, the same opinion to 1 point", () => {
    const daily = year(1);
    const monthly = year(30);
    expect(daily.date).toBe("2027-01-01");
    const close = (a: number, b: number) => Math.abs(a / b - 1);
    for (const id of pack.scenario.nations) {
      const d = daily.economies[id];
      const m = monthly.economies[id];
      expect(close(d.gdp, m.gdp), `${id} GDP`).toBeLessThan(0.01);
      // The debt to 1 % of GDP: the Russian and Norwegian debts are close
      // to zero, where a relative gap means nothing.
      expect(
        Math.abs(d.debt / d.gdp - m.debt / m.gdp),
        `${id} debt`,
      ).toBeLessThan(0.01);
      expect(
        close(d.population, m.population),
        `${id} population`,
      ).toBeLessThan(0.01);
      expect(
        Math.abs(daily.politics[id].opinion - monthly.politics[id].opinion),
        `${id} opinion`,
      ).toBeLessThan(0.01);
    }
  }, 120_000);
});
