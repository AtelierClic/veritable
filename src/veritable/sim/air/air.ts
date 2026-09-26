import { NationId } from "../../data/schemas/common";
import {
  DiplomacyState,
  EconomyState,
  MilitaryState,
} from "../../data/schemas/save";
import { enemiesOf } from "../diplomacy/diplomacy";
import { EconomyContext } from "../economy/context";
import { addDays, daysBetweenDates } from "../time";

// Air (J3b). Between two belligerents a = air_a / (air_a + air_b), from the
// air power of the sheets scaled by the arms coverage (military.ts). On the
// segments of their front, the force of a is multiplied by
// 1 + segmentWeight x (a - 0.5). Every month, strikes cost the enemy
// strikeShare x a of its industrial capacity and of its supply (strike
// damage, which decays once the war is over).

export function airSuperiority(
  military: MilitaryState,
  a: NationId,
  b: NationId,
): number {
  const pa = military.nations[a]?.airPower ?? 0;
  const pb = military.nations[b]?.airPower ?? 0;
  return pa + pb > 0 ? pa / (pa + pb) : 0.5;
}

export function airMultiplier(
  ctx: EconomyContext,
  military: MilitaryState,
  nation: NationId,
  enemy: NationId,
): number {
  const a = airSuperiority(military, nation, enemy);
  return 1 + ctx.config.air.segmentWeight * (a - 0.5);
}

// Once a month: the damage of the strikes of the strongest enemy in the air.
export function stepAirMonth(
  ctx: EconomyContext,
  diplomacy: DiplomacyState,
  military: MilitaryState,
  economy: EconomyState,
): void {
  const cfg = ctx.config.air;
  for (const id of ctx.nationIds) {
    const nation = economy.nations[id];
    let worst = 0;
    for (const enemy of enemiesOf(diplomacy, id)) {
      worst = Math.max(worst, airSuperiority(military, enemy, id));
    }
    const decayed = nation.strikeDamage * cfg.strikeDecayPerMonth;
    nation.strikeDamage = Math.min(
      1,
      Math.max(decayed, worst > 0 ? cfg.strikeShare * worst : 0),
    );
  }
}

// J7b: an air strike ordered on an enemy (the action menu of the map, the
// Fronts screen) adds targetedShare x a to its damage at once; at most once
// every cooldownDays on the same enemy.

// The first day the nation may strike the enemy again (null: any day).
export function nextAirStrike(
  ctx: EconomyContext,
  military: MilitaryState,
  by: NationId,
  target: NationId,
): string | null {
  const last = military.nations[by]?.airStrikes[target];
  return last === undefined ? null : addDays(last, ctx.config.air.cooldownDays);
}

// Returns the damage added.
export function orderAirStrike(
  ctx: EconomyContext,
  military: MilitaryState,
  economy: EconomyState,
  by: NationId,
  target: NationId,
  date: string,
): number {
  const next = nextAirStrike(ctx, military, by, target);
  if (next !== null && daysBetweenDates(date, next) > 0) {
    throw new Error(`air-strike: next strike on ${target} on ${next}`);
  }
  const nation = economy.nations[target];
  if (nation === undefined) throw new Error(`air-strike: unknown ${target}`);
  const before = nation.strikeDamage;
  nation.strikeDamage = Math.min(
    1,
    before +
      ctx.config.air.targetedShare * airSuperiority(military, by, target),
  );
  military.nations[by].airStrikes[target] = date;
  return nation.strikeDamage - before;
}
