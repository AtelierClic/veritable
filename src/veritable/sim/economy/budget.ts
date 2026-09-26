import { NationId } from "../../data/schemas/common";
import { NationData, SPENDING_POSTS, TAX_IDS } from "../../data/schemas/nation";
import {
  EconomyState,
  NationEconomy,
  NationPolitics,
  PoliticsState,
} from "../../data/schemas/save";
import { DAYS_PER_MONTH } from "../time";
import { EconomyContext } from "./context";
import { tradeBasesOf } from "./engine";
import { taxBase } from "./init";

// Budget of one nation, per month (J7: an update covers the months since
// the last one, its flows are the monthly rates times their length).
//
//   revenue     = sum over taxes of rate x base / 12     (+ foreign grants)
//   expenditure = GDP / 12 x sum of post shares          (+ interest)
//   i = base + debtSlope x max(0, debt/GDP - threshold)
//            + instabilitySlope x (1 - stability) + spread
//
// J6b: the spread makes the rate of the first day the real rate observed
// (interest paid / debt - inflation, sheet); the formula moves it with the
// debt and the stability from there.
//
// Forced austerity: debt/GDP >= threshold and rising for N months -> posts
// capped. Default: debt/GDP >= threshold or interest > share of revenue ->
// haircut, no deficit allowed for some years, opinion and stability hit.

export type BudgetEvent =
  | { type: "austerity-started" | "austerity-ended"; nation: NationId }
  | { type: "sovereign-default"; nation: NationId };

// The trailing deficit (J7: the balances of the last twelve calendar
// months over the time they cover), in share of GDP per year.
export function deficitToGdp(nation: NationEconomy): number {
  let sum = 0;
  let days = 0;
  for (const b of nation.balances) {
    sum += b.value;
    days += b.days;
  }
  if (days <= 0) return 0;
  return (-sum * (365.25 / days)) / nation.gdp;
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

// The rate of the formula of the J2 at a debt ratio and a stability.
export function formulaRate(
  ctx: EconomyContext,
  debtToGdp: number,
  stability: number,
): number {
  const cfg = ctx.config.budget.interest;
  return (
    cfg.base +
    cfg.debtSlope * Math.max(0, debtToGdp - cfg.debtThreshold) +
    cfg.instabilitySlope * (1 - stability)
  );
}

// J6b: the real interest rate of the first day of a sheet, null without its
// interest data (a test sheet) or without debt to speak of.
export function startRealRate(
  ctx: EconomyContext,
  sheet: NationData,
): number | null {
  const budget = sheet.economy.budget;
  const debt = sheet.debtToGdp.value;
  if (
    budget.interestPctGdp === undefined ||
    budget.inflation === undefined ||
    debt < 0.01
  ) {
    return null;
  }
  const cfg = ctx.config.budget.interest;
  const nominal = Math.min(cfg.nominalMax, budget.interestPctGdp.value / debt);
  return Math.min(
    cfg.realMax,
    Math.max(cfg.realMin, nominal - budget.inflation.value),
  );
}

// J6b: the debt ratio at which a nation defaults: the rule's, or its own
// debt of the first day with a margin when it already stood above it
// (Japan, Venezuela...).
export function defaultDebtThreshold(
  ctx: EconomyContext,
  id: NationId,
): number {
  const cfg = ctx.config.budget.default;
  const start = ctx.sheet(id).debtToGdp.value;
  return start > cfg.debtToGdp ? start * cfg.startMargin : cfg.debtToGdp;
}

// J6b: the same for the share of revenue that interest takes (Sri Lanka
// pays half of its revenue in interest on the first day).
export function defaultInterestShare(
  ctx: EconomyContext,
  id: NationId,
): number {
  const cfg = ctx.config.budget.default;
  const sheet = ctx.sheet(id);
  const real = startRealRate(ctx, sheet);
  const revenue = sheet.economy.budget.revenuePctGdp.value;
  if (real === null || revenue <= 0) return cfg.interestToRevenue;
  const start = (real * sheet.debtToGdp.value) / revenue;
  return start > cfg.interestToRevenue
    ? start * cfg.startMargin
    : cfg.interestToRevenue;
}

// J6b: the budget of the first day once politics exist: the interest spread
// of each nation, and the nations already in default (they cannot borrow
// for noDeficitYears, and do not default again meanwhile).
export function settleStartBudget(
  ctx: EconomyContext,
  economy: EconomyState,
  politics: PoliticsState,
  startDate: string,
): void {
  for (const [id, nation] of Object.entries(economy.nations)) {
    const sheet = ctx.sheet(id);
    const real = startRealRate(ctx, sheet);
    const stability = politics.nations[id]?.stability ?? 1;
    nation.interestSpread =
      real === null
        ? 0
        : real - formulaRate(ctx, sheet.debtToGdp.value, stability);
    nation.interestRate = formulaRate(ctx, nation.debt / nation.gdp, stability);
    nation.interestRate = Math.max(
      ctx.config.budget.interest.realMin,
      nation.interestRate + nation.interestSpread,
    );
    if (sheet.economy.budget.inDefault !== undefined) {
      nation.defaults = 1;
      nation.noDeficitUntil = addYears(
        startDate,
        ctx.config.budget.default.noDeficitYears,
      );
    }
  }
}

// What an update of the budget covers (J7): its date, the calendar month it
// ends in (months since the start date), its length in game months, and
// the calendar months it crossed (the counters of months in a row).
export interface BudgetPeriod {
  date: string;
  month: number;
  months: number;
  monthsCrossed: number;
}

// One month from a date: the shape of the monthly budget of the J2 to the
// J6 (tests).
export function monthPeriod(date: string, month = 0): BudgetPeriod {
  return { date, month, months: 1, monthsCrossed: 1 };
}

export function stepBudget(
  ctx: EconomyContext,
  id: NationId,
  nation: NationEconomy,
  politics: NationPolitics,
  period: BudgetPeriod,
  // Net transfers received per month (reparations, J3a; the cost of the
  // political levers, J4; bloc budgets, J5), US$ per month.
  transferPerMonth = 0,
  // One-off amounts of the period (structures built, arms sent), US$.
  lump = 0,
  // Corruption leak on the programmes: they cost x (1 + leak) (J4).
  leak = 0,
): BudgetEvent[] {
  const events: BudgetEvent[] = [];
  const cfg = ctx.config.budget;
  const { months, date } = period;
  const bases = tradeBasesOf(ctx, nation);

  if (nation.austerity) {
    for (const post of SPENDING_POSTS) {
      nation.spending[post] = Math.min(
        nation.spending[post],
        spendingCeiling(ctx, nation, post),
      );
    }
  }

  // Rates per month.
  let revenue = (nation.grantsPctGdp * nation.gdp) / 12 + transferPerMonth;
  for (const tax of TAX_IDS) {
    revenue += (nation.taxes[tax] * taxBase(ctx, tax, nation.gdp, bases)) / 12;
  }

  const debtToGdp = nation.debt / nation.gdp;
  nation.interestRate = Math.max(
    cfg.interest.realMin,
    formulaRate(ctx, debtToGdp, politics.stability) + nation.interestSpread,
  );
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

  const balance = (revenue - programs - interest) * months + lump;
  nation.debt -= balance;
  nation.revenue = revenue;
  nation.expenditure = programs + interest;
  nation.interest = interest;
  addBalance(nation, period.month, balance, months * DAYS_PER_MONTH);

  // Months in a row the debt rose, at the turn of each month: the debt in
  // money, not its ratio to GDP (a month of deficit, as from the J2 to the
  // J6: the J6 compared the ratios before and after the budget of the month,
  // at the same GDP). The ratio falls with growth under a small deficit,
  // and a rule on the ratio let the French debt climb back after 2045.
  const after = nation.debt / nation.gdp;
  if (period.monthsCrossed > 0) {
    nation.debtRisingMonths =
      nation.debt > nation.debtMark
        ? nation.debtRisingMonths + period.monthsCrossed
        : 0;
    nation.debtMark = nation.debt;
  }

  // No second default while one is in progress (J6b).
  if (
    nation.noDeficitUntil === null &&
    (after >= defaultDebtThreshold(ctx, id) ||
      (revenue > 0 && interest > defaultInterestShare(ctx, id) * revenue))
  ) {
    nation.debt *= 1 - cfg.default.haircut;
    nation.noDeficitUntil = addYears(date, cfg.default.noDeficitYears);
    nation.defaults += 1;
    nation.debtRisingMonths = 0;
    nation.debtMark = nation.debt;
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

// The balance of a period goes to the bucket of its calendar month; the
// last twelve months are kept.
function addBalance(
  nation: NationEconomy,
  month: number,
  value: number,
  days: number,
): void {
  const last = nation.balances[nation.balances.length - 1];
  if (last !== undefined && last.month === month) {
    last.value += value;
    last.days += days;
  } else {
    nation.balances.push({ month, value, days });
  }
  while (
    nation.balances.length > 0 &&
    nation.balances[0].month <= month - BALANCE_MONTHS
  ) {
    nation.balances.shift();
  }
}

const BALANCE_MONTHS = 12;
