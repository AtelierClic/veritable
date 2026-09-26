import { vt } from "../data/i18n";
import { NationId } from "../data/schemas/common";
import { addDays } from "../sim/time";
import { ReadonlyWorldView } from "../sim/VeritableSim";
import { longDate } from "./format";
import { own } from "./intel";

// What the player may order against an enemy (J7b), the same for the
// screens and for the action menu of the map: the reason an order cannot
// be given now, or null. The simulation refuses the same orders.

export function playerEnemies(view: ReadonlyWorldView): NationId[] {
  const me = view.playerNation;
  if (me === null) return [];
  const out = new Set<NationId>();
  for (const w of view.diplomacy.wars) {
    if (w.aggressors.includes(me)) w.defenders.forEach((n) => out.add(n));
    else if (w.defenders.includes(me)) w.aggressors.forEach((n) => out.add(n));
  }
  return [...out];
}

// The day of the next air strike on the enemy, when it is not today.
export function airStrikeNext(
  view: ReadonlyWorldView,
  cooldownDays: number,
  enemy: NationId,
): string | null {
  const last = own(view)?.military?.airStrikes[enemy];
  if (last === undefined) return null;
  const next = addDays(last, cooldownDays);
  return next > view.date ? next : null;
}

export function airStrikeBlock(
  view: ReadonlyWorldView,
  cooldownDays: number,
  enemy: NationId,
): string | null {
  if (!playerEnemies(view).includes(enemy)) return vt("menu.no-enemy");
  const next = airStrikeNext(view, cooldownDays, enemy);
  return next === null
    ? null
    : vt("menu.air-strike-wait", { date: longDate(next) });
}

export function nuclearBlock(
  view: ReadonlyWorldView,
  enemy: NationId,
): string | null {
  const arsenal = own(view)?.nuclear;
  if (arsenal === undefined || arsenal.warheads <= 0) {
    return vt("menu.no-warhead");
  }
  return playerEnemies(view).includes(enemy) ? null : vt("menu.no-enemy");
}
