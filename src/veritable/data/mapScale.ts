import { VeritableConfig } from "./schemas/config";

// The war constants in tiles are calibrated on the Europe map (J3, about
// 2.7 km a tile); the world map has tiles of about 9.4 km (J6c). With f the
// ratio of the tile sizes (reference / map, from the scales of the two
// georeferencings), a distance in tiles is multiplied by f and an area — a
// speed of conquest, in tiles a tick along a segment of scaled length —
// by f², so that a front takes the same land a day on either map; the war
// score of a tile is divided by f². The Europe map is its own reference:
// its constants are returned untouched, bit for bit.
export function configForMap(
  config: VeritableConfig,
  georefScale: number | undefined,
): VeritableConfig {
  if (georefScale === undefined) return config;
  const f = georefScale / config.mapScale.referenceGeorefScale;
  if (f === 1) return config;
  const scaled = structuredClone(config);
  const distance = (tiles: number, min: number) =>
    Math.max(min, Math.round(tiles * f));
  scaled.war.segmentTiles = distance(config.war.segmentTiles, 8);
  scaled.war.v0 = config.war.v0 * f * f;
  scaled.war.vMax = config.war.vMax * f * f;
  scaled.war.cityDefenseRange = distance(config.war.cityDefenseRange, 1);
  scaled.war.warScore.tileValue = config.war.warScore.tileValue / (f * f);
  scaled.logistics.range = distance(config.logistics.range, 1);
  scaled.naval.landingRadius = distance(config.naval.landingRadius, 1);
  scaled.nuclear.capitalFrontTiles = distance(
    config.nuclear.capitalFrontTiles,
    1,
  );
  return scaled;
}
