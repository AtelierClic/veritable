import { SPENDING_POSTS } from "../data/schemas/nation";
import { NationEconomy } from "../data/schemas/save";
import { deficitToGdp, spendingCeiling } from "../sim/economy/budget";
import { EconomyContext } from "../sim/economy/context";

// Minimal fiscal rule of the nations nobody plays (and of the player's nation
// in a headless run). NOT the J5 AI: no agenda, no traits. It only keeps a
// twenty-year run from diverging.
//
// GDP is real (no inflation in the model), so a 3 % deficit alone would let
// debt/GDP climb for ever. The rule therefore consolidates in two cases:
//   - the deficit is above the limit;
//   - debt/GDP is above the prudent mark and has been rising for a year.
// Consolidating = every post trimmed a little each month; income tax and VAT
// also go up when the deficit is more than twice the limit. Once the deficit
// is small and debt no longer rises, posts and taxes drift back towards their
// values of the first day, never beyond. Since the J4 the sliders have
// targets; the rule sets them and applies them at once (a technocratic
// consolidation does not wait for the ramp: with the six-month lag the loop
// under-reacted and Italian debt diverged over fifty years).
export function stepFiscalRule(
  ctx: EconomyContext,
  nation: NationEconomy,
): void {
  adjustTargets(ctx, nation);
  for (const post of SPENDING_POSTS) {
    nation.spending[post] = nation.spendingTargets[post];
  }
  for (const tax of Object.keys(nation.taxTargets)) {
    nation.taxes[tax] = nation.taxTargets[tax];
  }
}

function adjustTargets(ctx: EconomyContext, nation: NationEconomy): void {
  const rule = ctx.config.ai.fiscal;
  const deficit = deficitToGdp(nation);
  const step = rule.adjustPerMonth;
  const debtToGdp = nation.debt / nation.gdp;
  const debtDrifting =
    debtToGdp > rule.prudentDebtToGdp &&
    nation.debtRisingMonths >= rule.debtRisingMonths;

  if (deficit > rule.maxDeficitToGdp || debtDrifting) {
    for (const post of SPENDING_POSTS) {
      if (rule.sparedPosts.includes(post)) continue;
      nation.spendingTargets[post] *= 1 - step;
    }
    if (deficit > 2 * rule.maxDeficitToGdp) {
      for (const tax of ["income", "vat"] as const) {
        nation.taxTargets[tax] = Math.min(
          ctx.config.budget.maxTaxRate[tax],
          nation.taxTargets[tax] * (1 + step),
        );
      }
    }
    return;
  }
  if (deficit < rule.relaxBelowDeficit && nation.debtRisingMonths === 0) {
    for (const post of SPENDING_POSTS) {
      nation.spendingTargets[post] = Math.min(
        nation.spending0[post],
        spendingCeiling(ctx, nation, post),
        nation.spendingTargets[post] * (1 + step / 2),
      );
    }
    for (const tax of ["income", "vat"] as const) {
      nation.taxTargets[tax] = Math.max(
        nation.taxes0[tax],
        nation.taxTargets[tax] * (1 - step / 2),
      );
    }
  }
}
