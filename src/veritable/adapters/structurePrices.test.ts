import { UnitType } from "../../core/game/Game";
import { loadVeritableConfig } from "../data/loadConfig";

// J7b: CoreBridge.structureCounts keys the structures of a nation by the
// unit types of the core ("Defense Post", "SAM Launcher", "Missile Silo"):
// the prices of the national budget must use the same keys, or the
// structure is never charged (the J5a keyed three of them without spaces).
describe("prices of the structures", () => {
  it("are keyed by the unit types of the core", () => {
    const types = Object.values(UnitType) as string[];
    const prices = loadVeritableConfig().budget.structureCostUsd;
    for (const type of Object.keys(prices)) expect(types).toContain(type);
    for (const type of [
      UnitType.City,
      UnitType.Port,
      UnitType.DefensePost,
      UnitType.SAMLauncher,
      UnitType.MissileSilo,
      UnitType.Warship,
    ]) {
      expect(prices[type], type).toBeGreaterThan(0);
    }
  });
});
