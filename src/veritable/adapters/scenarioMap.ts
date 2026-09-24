import { GameMapType } from "../../core/game/Game";

// The OpenFront map of a scenario: its `map` field is the folder name of the
// map in resources/maps ("europe", "giantworldmap"), the core wants the
// GameMapType ("Europe", "Giant World Map").
export function gameMapOf(map: string): GameMapType {
  const match = Object.values(GameMapType).find(
    (m) => m.toLowerCase().replace(/\s+/g, "") === map.toLowerCase(),
  );
  if (match === undefined) throw new Error(`unknown map: ${map}`);
  return match;
}
