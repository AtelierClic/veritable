import { NationId } from "../../data/schemas/common";
import {
  DiplomacyState,
  MilitaryState,
  NavalState,
} from "../../data/schemas/save";
import { enemiesOf } from "../diplomacy/diplomacy";
import { EconomyContext } from "../economy/context";
import { NavalSnapshot } from "../VeritableSim";

// Navy (J3b). The sea is cut into zones (data/veritable/maps/<map>.seas.json,
// rasterized by tools/veritable/borders). Once a game day:
//   presence of a nation in a zone = its naval power x the share of its fleet
//     deployed there (its coastal zones by default, evenly) + shipWeight per
//     warship in the zone + portWeight per port on the zone;
//   control of a zone = share of the presence;
//   blockade of a nation = mean enemy control of its coastal zones (and the
//     zones of its ports): its maritime flows are multiplied by 1 - blockade.
// A landing needs the zone of the landing tile to be controlled at
// landingControl at least.

export type NavalEvent = {
  type: "landing-refused" | "landing";
  nation: NationId;
  target: NationId;
};

export function initNaval(): NavalState {
  return { deployments: {}, control: {}, blockade: {} };
}

// Zones a nation reaches from its coast and its ports.
export function homeZones(snapshot: NavalSnapshot, id: NationId): string[] {
  const zones = new Set<string>([
    ...(snapshot.coast[id] ?? []),
    ...(snapshot.ports[id] ?? []),
  ]);
  return [...zones].sort();
}

// Where a nation projects its fleet: its deployment, or its home zones.
export function deploymentOf(
  naval: NavalState,
  snapshot: NavalSnapshot,
  id: NationId,
): Record<string, number> {
  const chosen = naval.deployments[id];
  if (chosen !== undefined && Object.keys(chosen).length > 0) return chosen;
  const home = homeZones(snapshot, id);
  if (home.length === 0) return {};
  return Object.fromEntries(home.map((z) => [z, 1 / home.length]));
}

export function stepNavalDay(
  ctx: EconomyContext,
  naval: NavalState,
  snapshot: NavalSnapshot,
  diplomacy: DiplomacyState,
  military: MilitaryState,
): void {
  const cfg = ctx.config.naval;
  const zones = ctx.seas.map((z) => z.id);
  const presence: Record<string, Record<NationId, number>> = {};
  for (const zone of zones) presence[zone] = {};
  for (const id of ctx.nationIds) {
    const power = military.nations[id]?.navalPower ?? 0;
    for (const [zone, share] of Object.entries(
      deploymentOf(naval, snapshot, id),
    )) {
      if (presence[zone] === undefined) continue;
      presence[zone][id] = (presence[zone][id] ?? 0) + power * share;
    }
    for (const zone of snapshot.ports[id] ?? []) {
      if (presence[zone] === undefined) continue;
      presence[zone][id] = (presence[zone][id] ?? 0) + cfg.portWeight;
    }
  }
  for (const [zone, ships] of Object.entries(snapshot.ships)) {
    if (presence[zone] === undefined) continue;
    for (const [id, count] of Object.entries(ships)) {
      presence[zone][id] = (presence[zone][id] ?? 0) + cfg.shipWeight * count;
    }
  }
  const control: NavalState["control"] = {};
  for (const zone of zones) {
    const total = Object.values(presence[zone]).reduce((a, b) => a + b, 0);
    control[zone] = {};
    for (const id of ctx.nationIds) {
      const p = presence[zone][id] ?? 0;
      if (p > 0) control[zone][id] = total > 0 ? p / total : 0;
    }
  }
  naval.control = control;
  const blockade: NavalState["blockade"] = {};
  for (const id of ctx.nationIds) {
    const home = homeZones(snapshot, id);
    const enemies = enemiesOf(diplomacy, id);
    let sum = 0;
    for (const zone of home) {
      for (const enemy of enemies) sum += control[zone]?.[enemy] ?? 0;
    }
    blockade[id] = home.length === 0 ? 0 : Math.min(1, sum / home.length);
  }
  naval.blockade = blockade;
}

// Multiplier of the flows between two participants that trade by sea.
export function maritimeFactor(
  ctx: EconomyContext,
  naval: NavalState,
  exporter: string,
  importer: string,
): number {
  if (ctx.landNeighbours(exporter, importer)) return 1;
  return (
    (1 - (naval.blockade[exporter] ?? 0)) *
    (1 - (naval.blockade[importer] ?? 0))
  );
}

// The player's fleet goes to the coastal zones of the target (a blockade), or
// back home.
export function setBlockade(
  naval: NavalState,
  snapshot: NavalSnapshot,
  by: NationId,
  target: NationId,
  active: boolean,
): void {
  if (!active) {
    delete naval.deployments[by];
    return;
  }
  const zones = homeZones(snapshot, target);
  if (zones.length === 0) throw new Error(`${target} has no coast to blockade`);
  naval.deployments[by] = Object.fromEntries(
    zones.map((z) => [z, 1 / zones.length]),
  );
}

export function controlOf(
  naval: NavalState,
  zone: string,
  id: NationId,
): number {
  return naval.control[zone]?.[id] ?? 0;
}
