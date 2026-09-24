import { createDataSource } from "./DataSource";
import { fsDataFiles } from "./files.fs";
import { loadVeritableConfig } from "./loadConfig";
import { configForMap } from "./mapScale";

// J6c: the war constants in tiles follow the size of the tiles of the map.
describe("the war constants at the scale of the map", () => {
  const config = loadVeritableConfig();
  const source = createDataSource(fsDataFiles());

  it("leave the Europe map, their reference, untouched", () => {
    const scale = source.georef("europe").scale;
    expect(scale).toBe(config.mapScale.referenceGeorefScale);
    expect(configForMap(config, scale)).toBe(config);
    expect(configForMap(config, undefined)).toBe(config);
  });

  it("convert distances by the ratio of the tile sizes and areas by its square on the world map", () => {
    const scale = source.georef("giantworldmap").scale;
    const f = scale / config.mapScale.referenceGeorefScale;
    expect(f).toBeGreaterThan(0.28);
    expect(f).toBeLessThan(0.3);
    const world = configForMap(config, scale);
    expect(world.war.segmentTiles).toBe(Math.round(200 * f));
    expect(world.logistics.range).toBe(Math.round(40 * f));
    expect(world.nuclear.capitalFrontTiles).toBe(Math.round(100 * f));
    expect(world.naval.landingRadius).toBe(Math.max(1, Math.round(6 * f)));
    expect(world.war.vMax).toBeCloseTo(config.war.vMax * f * f, 12);
    expect(world.war.v0).toBeCloseTo(config.war.v0 * f * f, 12);
    expect(world.war.warScore.tileValue).toBeCloseTo(
      config.war.warScore.tileValue / (f * f),
      12,
    );
    // The config itself is not touched.
    expect(config.war.segmentTiles).toBe(200);
  });
});
