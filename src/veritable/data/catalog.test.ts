import {
  loadBorders,
  loadBordersMeta,
  loadNation,
  loadScenario,
  scenarioIds,
} from "./catalog";
import { hasTextKey } from "./i18n";

describe("data/veritable catalog", () => {
  it("lists and validates every scenario with its nations", () => {
    expect(scenarioIds()).toContain("europe-10");
    for (const id of scenarioIds()) {
      const scenario = loadScenario(id);
      for (const nationId of scenario.nations) {
        const nation = loadNation(nationId);
        expect(hasTextKey(nation.name)).toBe(true);
        expect(hasTextKey(nation.capital.name)).toBe(true);
      }
      expect(hasTextKey(`scenario.${id}.name`)).toBe(true);
      for (const region of scenario.contested) {
        expect(scenario.nations).toContain(region.controller);
      }
    }
  });

  it("europe-10 is the ten nations decided for J1, with their regimes", () => {
    const scenario = loadScenario("europe-10");
    expect(scenario.startDate).toBe("2026-01-01");
    const regimes = Object.fromEntries(
      scenario.nations.map((id) => [id, loadNation(id).regime]),
    );
    expect(regimes).toEqual({
      FRA: "semi-presidential",
      DEU: "parliamentary",
      GBR: "parliamentary",
      ITA: "parliamentary",
      ESP: "parliamentary",
      POL: "semi-presidential",
      UKR: "semi-presidential",
      RUS: "electoral-authoritarian",
      TUR: "electoral-authoritarian",
      NOR: "parliamentary",
    });
  });

  it("borders and capitals agree with the scenario", async () => {
    const scenario = loadScenario("europe-10");
    const borders = await loadBorders(scenario);
    const meta = loadBordersMeta(scenario);
    expect(borders.nations).toEqual(scenario.nations);
    expect([meta.width, meta.height]).toEqual([borders.width, borders.height]);
    scenario.nations.forEach((id, n) => {
      const [x, y] = meta.capitals[id];
      expect(borders.tiles[y * borders.width + x]).toBe(n + 1);
    });
  });

  it("fails clearly on unknown data", () => {
    expect(() => loadScenario("atlantis")).toThrow(/not found/);
    expect(() => loadNation("XXX")).toThrow(/not found/);
  });
});
