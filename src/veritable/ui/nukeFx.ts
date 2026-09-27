import type { RenderSettings } from "../../client/render/gl/RenderSettings";
import { dataSource } from "../data/catalog";

// J7c: the flash, the shockwave and the debris of a burst in a campaign, at
// the radii of the Véritable weapons. The renderer of OpenFront scatters
// them over its own radii (a hydrogen bomb: 160 tiles, fires over 750 km of
// the world map around Moscow) while a Véritable burst contaminates 35 km
// and changes no tile. The radius of the effects is twice the contaminated
// one in tiles of the map (the debris fall within half of it), never less
// than MIN_TILES so that the flash stays visible on the world map.

const EARTH_KM = 6371;
const MIN_TILES = 6;

export function campaignNukeFx(
  settings: RenderSettings,
  scenarioId: string | undefined,
): void {
  if (scenarioId === undefined) return;
  const scenario = dataSource.scenario(scenarioId);
  const kmPerTile = EARTH_KM / dataSource.georef(scenario.map).scale;
  const weapons = dataSource.config().nuclear.weapons;
  const tiles = (km: number) =>
    Math.max(MIN_TILES, Math.round((2 * km) / kmPerTile));
  settings.fx.nukeRadiusAtom = tiles(weapons.atom.contaminationKm);
  settings.fx.nukeRadiusHydro = tiles(weapons.hydrogen.contaminationKm);
  settings.fx.nukeRadiusMirv = tiles(weapons.mirv.contaminationKm);
}
