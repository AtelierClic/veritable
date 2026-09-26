import { INTEREST_GROUPS, NationId } from "../../data/schemas/common";
import { NationData } from "../../data/schemas/nation";
import { NationEconomy, NationPolitics } from "../../data/schemas/save";
import { EconomyContext } from "../economy/context";
import { debtHealthOf } from "../economy/init";
import { relaxed } from "../time";

// Political core, at each update of the nation (J7; once a game week until
// the J6): the convergence per week is compounded over the weeks elapsed.
//
// Player's nation: eight interest groups. Satisfaction s_k in [0, 1] converges
// at `convergencePerWeek` towards
//     target = 0.5 + sum of weight x driver
// where a driver is growth, the price index, a tax rate, a spending post that
// matters to the group, or shortages, each scaled to [-1, 1] and signed so
// that positive = good news. Opinion = sum of w_k x s_k.
//
// Other nations (asymmetric simulation): no groups, opinion converges towards
// a proxy of growth, shortages and prices.
//
//   stability = wO x opinion + wS x (1 - shortage) + wD x debt health
//             + wL x legitimacy            (a variable since the J4)
// Unrest when stability < threshold. The laws in force shift the target of
// each group (J4).

export type PoliticsEvent = {
  type: "unrest-started" | "unrest-ended";
  nation: NationId;
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export function driverValue(
  ctx: EconomyContext,
  key: string,
  economy: NationEconomy,
): number {
  const scales = ctx.config.politics.driverScales;
  if (key === "growth") {
    return clamp(
      (economy.growthAnnual - economy.growthBase) / scales.growth,
      -1,
      1,
    );
  }
  if (key === "prices") {
    return clamp(-(economy.priceIndex - 1) / scales.prices, -1, 1);
  }
  if (key === "shortage") {
    return clamp(-economy.shortage / scales.shortage, -1, 0);
  }
  // J7: taxes and spending as announced (the targets of the sliders): a
  // people reacts to a reform when it is announced, not six months later
  // when the slider has reached it.
  if (key.startsWith("tax.")) {
    const tax = key.slice(4);
    const rate = economy.taxTargets[tax] ?? economy.taxes[tax];
    return clamp(-(rate - economy.taxes0[tax]) / scales.taxRate, -1, 1);
  }
  if (key.startsWith("spending.")) {
    const post = key.slice(9);
    const reference = economy.spending0[post];
    if (reference <= 0) return 0;
    const share = economy.spendingTargets[post] ?? economy.spending[post];
    return clamp((share - reference) / reference / scales.spending, -1, 1);
  }
  throw new Error(`unknown political driver: ${key}`);
}

// Stability a nation loses to the internal conflicts of the scenario (J6b):
// intensity x stabilityMalus, halving every halfLifeYears from the start of
// the campaign; several conflicts add up, capped at stabilityMalus.
export function internalConflictMalus(
  ctx: EconomyContext,
  conflicts: readonly { nation: NationId; intensity: number }[],
  id: NationId,
  yearsSinceStart: number,
): number {
  const cfg = ctx.config.politics.internalConflict;
  let intensity = 0;
  for (const c of conflicts) if (c.nation === id) intensity += c.intensity;
  if (intensity <= 0) return 0;
  return (
    cfg.stabilityMalus *
    Math.min(1, intensity) *
    Math.pow(2, -yearsSinceStart / cfg.halfLifeYears)
  );
}

export function stepPolitics(
  ctx: EconomyContext,
  id: NationId,
  data: NationData | undefined,
  economy: NationEconomy,
  politics: NationPolitics,
  // War exhaustion of the nation, 0..1 (war/military.ts).
  exhaustion = 0,
  // Share of the nation's trade partners that sanction it, 0..1: a
  // sanctioned aggressor does not recover while the sanctions last.
  sanctionedShare = 0,
  // Offsets of the satisfaction targets from the laws in force (J4).
  lawOffsets: Record<string, number> = {},
  // Stability lost to internal conflicts of the scenario (J6b,
  // internalConflictMalus).
  conflictMalus = 0,
  // Game weeks since the last update (J7).
  weeks = 1,
): PoliticsEvent[] {
  const cfg = ctx.config.politics;
  const converge = relaxed(cfg.convergencePerWeek, weeks);
  // Bloc reprimand in force, or fading out (blocs/fiscalRule.ts); a war and
  // the sanctions weigh on every group and on the AI proxy alike.
  const malus =
    politics.reprimandMalus +
    ctx.config.war.exhaustion.opinionWeight * exhaustion +
    cfg.sanctionsOpinionWeight * sanctionedShare;

  if (politics.groups !== null) {
    const weights = data?.interestGroups ?? cfg.groupWeights;
    let opinion = 0;
    let totalWeight = 0;
    for (const group of INTEREST_GROUPS) {
      let target = 0.5 - malus + (lawOffsets[group] ?? 0);
      for (const [key, weight] of Object.entries(cfg.drivers[group])) {
        target += weight * driverValue(ctx, key, economy);
      }
      const s = politics.groups[group];
      politics.groups[group] = clamp(
        s + converge * (clamp(target, 0, 1) - s),
        0,
        1,
      );
      opinion += weights[group] * politics.groups[group];
      totalWeight += weights[group];
    }
    politics.opinion = totalWeight > 0 ? opinion / totalWeight : 0.5;
  } else {
    const ai = cfg.aiOpinion;
    let offsets = 0;
    for (const v of Object.values(lawOffsets)) offsets += v;
    const target = clamp(
      0.5 +
        ai.growth * (economy.growthAnnual - economy.growthBase) -
        ai.shortage * economy.shortage -
        ai.prices * (economy.priceIndex - 1) -
        malus +
        offsets / INTEREST_GROUPS.length,
      0,
      1,
    );
    politics.opinion += converge * (target - politics.opinion);
  }

  // Food weighs more than its share in the shortage index: hunger is unrest.
  const food = ctx.good("food");
  const shortage = clamp(
    economy.shortage +
      (cfg.stability.foodShortageWeight - 1) *
        food.shortageWeight *
        (1 - economy.coverage.food),
    0,
    1,
  );
  const s = cfg.stability;
  politics.stability = clamp(
    s.opinion * politics.opinion +
      s.shortage * (1 - shortage) +
      s.debt * debtHealthOf(ctx, economy.debt / economy.gdp) +
      s.legitimacy * politics.legitimacy -
      conflictMalus,
    0,
    1,
  );

  const unrest = politics.stability < s.unrestThreshold;
  if (unrest === politics.unrest) return [];
  politics.unrest = unrest;
  return [{ type: unrest ? "unrest-started" : "unrest-ended", nation: id }];
}
