import { getDefaultKeybinds } from "../../core/game/UserSettings";
import {
  defaultBloc,
  densityColor,
  intelColor,
  MapColors,
  MODE_KEYS,
  nationColors,
  relationColor,
} from "./mapModes";

// The modes of the map (J7b): the colour of each nation by mode.

const COLORS: MapColors = {
  player: "AAA",
  relations: { BBB: 80, CCC: -90, DDD: 0 },
  wars: [
    { aggressors: ["CCC"], defenders: ["AAA", "BBB"] },
    { aggressors: ["EEE"], defenders: ["FFF"] },
  ],
  blocs: [{ id: "union", members: ["AAA", "BBB"], candidates: ["DDD"] }],
  intel: { BBB: 3, CCC: 0, DDD: 1 },
};
const NATIONS = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG"];

describe("the modes of the map (J7b)", () => {
  it("keeps the nations' own colours on the political map", () => {
    expect(nationColors("political", COLORS, NATIONS, null)).toBeNull();
  });

  it("colours the relations on a diverging scale: hostile orange, friendly blue", () => {
    const [r1, , b1] = relationColor(-100);
    const [r2, , b2] = relationColor(100);
    expect(r1).toBeGreaterThan(b1); // orange
    expect(b2).toBeGreaterThan(r2); // blue
    const c = nationColors("relations", COLORS, NATIONS, null)!;
    expect(c.get("BBB")).toEqual(relationColor(80));
    expect(c.get("CCC")).toEqual(relationColor(-90));
    expect(c.get("AAA")).not.toEqual(relationColor(0));
  });

  it("orders the levels of intelligence from pale to deep", () => {
    const lum = (rgb: readonly number[]) => rgb[0] + rgb[1] + rgb[2];
    for (let level = 1; level <= 3; level++) {
      expect(lum(intelColor(level))).toBeLessThan(lum(intelColor(level - 1)));
    }
    const c = nationColors("intel", COLORS, NATIONS, null)!;
    expect(c.get("BBB")).toEqual(intelColor(3));
    expect(c.get("GGG")).toEqual(intelColor(0));
  });

  it("tells the player's enemies, its allies at war, the other belligerents", () => {
    const c = nationColors("wars", COLORS, NATIONS, null)!;
    expect(c.get("CCC")).not.toEqual(c.get("BBB"));
    expect(c.get("EEE")).toEqual(c.get("FFF"));
    expect(c.get("EEE")).not.toEqual(c.get("CCC"));
    expect(c.get("GGG")).not.toEqual(c.get("EEE"));
  });

  it("shows the members and candidates of the bloc chosen", () => {
    const c = nationColors("blocs", COLORS, NATIONS, "union")!;
    expect(c.get("AAA")).toEqual(c.get("BBB"));
    expect(c.get("DDD")).not.toEqual(c.get("AAA"));
    expect(c.get("CCC")).not.toEqual(c.get("DDD"));
  });

  it("ramps the density on the levels of the grid, nothing for empty land", () => {
    expect(densityColor(0, 100)).toBeNull();
    const low = densityColor(10, 100)!;
    const high = densityColor(100, 100)!;
    expect(high[0] + high[1] + high[2]).toBeLessThan(low[0] + low[1] + low[2]);
  });

  it("gives every mode its own key, none of OpenFront's", () => {
    const keys = Object.values(MODE_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
    for (const mac of [false, true]) {
      const taken = Object.values(getDefaultKeybinds(mac));
      for (const key of keys) expect(taken).not.toContain(key);
    }
  });
});

describe("defaultBloc", () => {
  const colors: MapColors = {
    player: "FRA",
    relations: {},
    wars: [],
    blocs: [
      { id: "arab-league", members: ["EGY"], candidates: [] },
      { id: "eu", members: ["FRA", "DEU"], candidates: [] },
      { id: "g7", members: ["FRA", "USA"], candidates: [] },
      { id: "nato", members: ["FRA", "USA"], candidates: [] },
    ],
    intel: {},
  };
  const types: Record<string, string> = {
    "arab-league": "forum",
    eu: "economic-union",
    g7: "forum",
    nato: "military-alliance",
  };

  it("opens on the player's alliance, then union, then forum", () => {
    expect(defaultBloc(colors, (id) => types[id])).toBe("nato");
    expect(
      defaultBloc(
        { ...colors, blocs: colors.blocs.slice(0, 3) },
        (id) => types[id],
      ),
    ).toBe("eu");
  });

  it("falls back on the first bloc without a player or a bloc of its own", () => {
    expect(defaultBloc({ ...colors, player: null }, (id) => types[id])).toBe(
      "arab-league",
    );
  });
});
