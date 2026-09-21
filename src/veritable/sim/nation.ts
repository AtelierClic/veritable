import { NationData } from "../data/schemas/nation";
import { NationState, NationStatus } from "../data/schemas/save";
import { AdHocNation } from "../data/schemas/scenario";

// A nation is NOT its tiles: nothing here (or anywhere in the simulation) may
// end a nation because its tile count reached zero. Zero tiles only means
// "exiled" for a territorial nation, and nothing at all for a microstate.

export function nationFromData(
  data: NationData,
  isPlayer: boolean,
): NationState {
  return {
    id: data.id,
    name: { kind: "key", key: data.name },
    regime: data.regime,
    territory: data.territory,
    status: "active",
    tileCount: 0,
    isPlayer,
  };
}

export function nationFromAdHoc(
  adHoc: AdHocNation,
  isPlayer: boolean,
): NationState {
  return {
    id: adHoc.id,
    name: { kind: "literal", text: adHoc.literalName },
    regime: null,
    territory: { kind: "tiles" },
    status: "active",
    tileCount: 0,
    isPlayer,
  };
}

// Status that follows from territory alone. "dissolved" is never derived: it
// is a political outcome (J7), not a tile count.
export function statusFromTerritory(nation: NationState): NationStatus {
  if (nation.status === "dissolved") return "dissolved";
  if (nation.territory.kind === "microstate") return "active";
  return nation.tileCount > 0 ? "active" : "exiled";
}
