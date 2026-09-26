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
// J5: the nation AI sets a defence goal (by the threat). At peace the rule
// relaxes defence towards that goal rather than towards the first day (a
// nation at war on the first day, Ukraine, would otherwise bring its war
// effort back after the peace); at war it never trims defence and relaxes
// towards the higher of the two.
export interface FiscalGoals {
  defense?: number;
  atWar?: boolean;
}

// J7: the rule acts at each update of the nation, its monthly steps
// compounded over the months since the last one.
export function stepFiscalRule(
  ctx: EconomyContext,
  nation: NationEconomy,
  goals: FiscalGoals = {},
  months = 1,
): void {
  adjustTargets(ctx, nation, goals, months);
  for (const post of SPENDING_POSTS) {
    nation.spending[post] = nation.spendingTargets[post];
  }
  for (const tax of Object.keys(nation.taxTargets)) {
    nation.taxes[tax] = nation.taxTargets[tax];
  }
}

function adjustTargets(
  ctx: EconomyContext,
  nation: NationEconomy,
  goals: FiscalGoals,
  months: number,
): void {
  const rule = ctx.config.ai.fiscal;
  const deficit = deficitToGdp(nation);
  const step = rule.adjustPerMonth;
  const cut = Math.pow(1 - step, months);
  const raise = Math.pow(1 + step, months);
  const relax = Math.pow(1 + step / 2, months);
  const ease = Math.pow(1 - step / 2, months);
  const debtToGdp = nation.debt / nation.gdp;
  const debtDrifting =
    debtToGdp > rule.prudentDebtToGdp &&
    nation.debtRisingMonths >= rule.debtRisingMonths;

  if (deficit > rule.maxDeficitToGdp || debtDrifting) {
    for (const post of SPENDING_POSTS) {
      if (rule.sparedPosts.includes(post)) continue;
      if (post === "defense" && goals.atWar === true) continue;
      nation.spendingTargets[post] *= cut;
    }
    if (deficit > 2 * rule.maxDeficitToGdp) {
      for (const tax of ["income", "vat"] as const) {
        nation.taxTargets[tax] = Math.min(
          ctx.config.budget.maxTaxRate[tax],
          nation.taxTargets[tax] * raise,
        );
      }
    }
    return;
  }
  if (deficit < rule.relaxBelowDeficit && nation.debtRisingMonths === 0) {
    for (const post of SPENDING_POSTS) {
      const goal =
        goals.defense !== undefined && goals.defense > 0
          ? goals.defense
          : undefined;
      const reference =
        post !== "defense" || goal === undefined
          ? nation.spending0[post]
          : goals.atWar === true
            ? Math.max(nation.spending0.defense, goal)
            : goal;
      nation.spendingTargets[post] = Math.min(
        reference,
        spendingCeiling(ctx, nation, post),
        nation.spendingTargets[post] * relax,
      );
    }
    for (const tax of ["income", "vat"] as const) {
      nation.taxTargets[tax] = Math.max(
        nation.taxes0[tax],
        nation.taxTargets[tax] * ease,
      );
    }
  }
}
