import { NationId } from "../../data/schemas/common";
import { SPENDING_POSTS, TAX_IDS } from "../../data/schemas/nation";
import { NationEconomy, NationPolitics } from "../../data/schemas/save";
import { EconomyContext } from "./context";
import { MonthlyTrade } from "./engine";
import { taxBase } from "./init";

// Monthly budget of one nation.
//
//   revenue     = sum over taxes of rate x base / 12     (+ foreign grants)
//   expenditure = GDP / 12 x sum of post shares          (+ interest)
//   i = base + debtSlope x max(0, debt/GDP - threshold)
//            + instabilitySlope x (1 - stability)
//
// Forced austerity: debt/GDP >= threshold and rising for N months -> posts
// capped. Default: debt/GDP >= threshold or interest > share of revenue ->
// haircut, no deficit allowed for some years, opinion and stability hit.

export type BudgetEvent =
  | { type: "austerity-started" | "austerity-ended"; nation: NationId }
  | { type: "sovereign-default"; nation: NationId };

export function deficitToGdp(nation: NationEconomy): number {
  if (nation.balances.length === 0) return 0;
  const sum = nation.balances.reduce((a, b) => a + b, 0);
  return (-sum * (12 / nation.balances.length)) / nation.gdp;
}

// Highest share a spending post may take right now.
export function spendingCeiling(
  ctx: EconomyContext,
  nation: NationEconomy,
  post: string,
): number {
  const max = ctx.config.budget.maxSpendingShare;
  return nation.austerity
    ? Math.min(
        max,
        nation.spending0[post] * ctx.config.budget.austerity.spendingCap,
      )
    : max;
}

function addYears(isoDate: string, years: number): string {
  return `${Number(isoDate.slice(0, 4)) + years}${isoDate.slice(4)}`;
}

export function stepBudget(
  ctx: EconomyContext,
  id: NationId,
  nation: NationEconomy,
  politics: NationPolitics,
  trade: MonthlyTrade,
  date: string,
  // Net transfer received this month (reparations, J3a; the cost of the
  // political levers, J4), US$.
  transfer = 0,
  // Corruption leak on the programmes: they cost x (1 + leak) (J4).
  leak = 0,
): BudgetEvent[] {
  const events: BudgetEvent[] = [];
  const cfg = ctx.config.budget;
  const bases = {
    importsValue: trade.importsValue[id],
    rentsValue: trade.rentsValue[id],
  };

  if (nation.austerity) {
    for (const post of SPENDING_POSTS) {
      nation.spending[post] = Math.min(
        nation.spending[post],
        spendingCeiling(ctx, nation, post),
      );
    }
  }

  let revenue = (nation.grantsPctGdp * nation.gdp) / 12 + transfer;
  for (const tax of TAX_IDS) {
    revenue += (nation.taxes[tax] * taxBase(ctx, tax, nation.gdp, bases)) / 12;
  }

  const debtToGdp = nation.debt / nation.gdp;
  nation.interestRate =
    cfg.interest.base +
    cfg.interest.debtSlope *
      Math.max(0, debtToGdp - cfg.interest.debtThreshold) +
    cfg.interest.instabilitySlope * (1 - politics.stability);
  const interest = (nation.interestRate / 12) * Math.max(0, nation.debt);

  let share = 0;
  for (const post of SPENDING_POSTS) share += nation.spending[post];
  let programs = (nation.gdp / 12) * share * (1 + leak);

  // After a default nobody lends: the posts are cut to what revenue allows.
  if (nation.noDeficitUntil !== null) {
    if (date >= nation.noDeficitUntil) nation.noDeficitUntil = null;
    else if (programs + interest > revenue && programs > 0) {
      const ratio = Math.max(0, revenue - interest) / programs;
      for (const post of SPENDING_POSTS) nation.spending[post] *= ratio;
      programs *= ratio;
    }
  }

  const balance = revenue - programs - interest;
  const before = debtToGdp;
  nation.debt -= balance;
  nation.revenue = revenue;
  nation.expenditure = programs + interest;
  nation.interest = interest;
  nation.balances.push(balance);
  if (nation.balances.length > 12) nation.balances.shift();

  const after = nation.debt / nation.gdp;
  nation.debtRisingMonths = after > before ? nation.debtRisingMonths + 1 : 0;

  if (
    after >= cfg.default.debtToGdp ||
    (revenue > 0 && interest > cfg.default.interestToRevenue * revenue)
  ) {
    nation.debt *= 1 - cfg.default.haircut;
    nation.noDeficitUntil = addYears(date, cfg.default.noDeficitYears);
    nation.defaults += 1;
    nation.debtRisingMonths = 0;
    politics.opinion = Math.max(
      0,
      politics.opinion - cfg.default.satisfactionHit,
    );
    politics.stability = Math.max(
      0,
      politics.stability - cfg.default.stabilityHit,
    );
    if (politics.groups !== null) {
      for (const group of Object.keys(politics.groups)) {
        politics.groups[group] = Math.max(
          0,
          politics.groups[group] - cfg.default.satisfactionHit,
        );
      }
    }
    events.push({ type: "sovereign-default", nation: id });
  }

  const shouldBeAustere =
    nation.debt / nation.gdp >= cfg.austerity.debtToGdp &&
    nation.debtRisingMonths >= cfg.austerity.risingMonths;
  if (shouldBeAustere && !nation.austerity) {
    nation.austerity = true;
    events.push({ type: "austerity-started", nation: id });
  } else if (
    nation.austerity &&
    nation.debt / nation.gdp < cfg.austerity.debtToGdp
  ) {
    nation.austerity = false;
    events.push({ type: "austerity-ended", nation: id });
  }
  return events;
}
