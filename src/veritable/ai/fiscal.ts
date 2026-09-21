import { SPENDING_POSTS } from "../data/schemas/nation";
import { NationEconomy } from "../data/schemas/save";
import { deficitToGdp, spendingCeiling } from "../sim/economy/budget";
import { EconomyContext } from "../sim/economy/context";

// Minimal fiscal rule of the nations nobody plays (and of the player's nation
// in a headless run). NOT the J5 AI: no agenda, no traits. It only keeps a
// twenty-year run from diverging:
//   - deficit above the limit: every post is trimmed a little each month; if
//     the deficit is more than twice the limit, income tax and VAT go up too;
//   - deficit back under the relax mark: posts and taxes drift back towards
//     their values of the first day, never beyond.
export function stepFiscalRule(
  ctx: EconomyContext,
  nation: NationEconomy,
): void {
  const rule = ctx.config.ai.fiscal;
  const deficit = deficitToGdp(nation);
  const step = rule.adjustPerMonth;

  if (deficit > rule.maxDeficitToGdp) {
    for (const post of SPENDING_POSTS) nation.spending[post] *= 1 - step;
    if (deficit > 2 * rule.maxDeficitToGdp) {
      for (const tax of ["income", "vat"] as const) {
        nation.taxes[tax] = Math.min(
          ctx.config.budget.maxTaxRate[tax],
          nation.taxes[tax] * (1 + step),
        );
      }
    }
    return;
  }
  if (deficit < rule.relaxBelowDeficit) {
    for (const post of SPENDING_POSTS) {
      nation.spending[post] = Math.min(
        nation.spending0[post],
        spendingCeiling(ctx, nation, post),
        nation.spending[post] * (1 + step / 2),
      );
    }
    for (const tax of ["income", "vat"] as const) {
      nation.taxes[tax] = Math.max(
        nation.taxes0[tax],
        nation.taxes[tax] * (1 - step / 2),
      );
    }
  }
}
