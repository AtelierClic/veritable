import { NationId } from "../../data/schemas/common";
import { FOSSIL_FUELS, GOOD_IDS, GoodId } from "../../data/schemas/goods";
import {
  NationData,
  SPENDING_POSTS,
  TAX_IDS,
  TaxId,
} from "../../data/schemas/nation";
import { RowData } from "../../data/schemas/row";
import {
  EconomyState,
  NationEconomy,
  PoliticsState,
} from "../../data/schemas/save";
import { initPoliticsState } from "../politics/state";
import { Rng } from "../rng";
import { EconomyContext } from "./context";

// First day of the economy, from the nation sheets. Records are always built
// in the order of the ids: key order is part of the bytes of a save.

export function perGood(
  value: (good: GoodId) => number,
): Record<string, number> {
  return Object.fromEntries(GOOD_IDS.map((g) => [g, value(g)]));
}

// Value (US$ per year) of what a nation imports and of its resource output,
// at given prices: the bases of tariffs and rents.
export function tradeBases(
  ctx: EconomyContext,
  production: Record<string, number>,
  imports: Record<string, number>,
  prices: Record<string, number>,
): { importsValue: number; rentsValue: number } {
  let importsValue = 0;
  let rentsValue = 0;
  for (const good of ctx.goods) {
    importsValue += imports[good.id] * prices[good.id] * 1e6;
    if (good.rent) rentsValue += production[good.id] * prices[good.id] * 1e6;
  }
  return { importsValue, rentsValue };
}

export function taxBase(
  ctx: EconomyContext,
  tax: TaxId,
  gdp: number,
  bases: { importsValue: number; rentsValue: number },
): number {
  switch (tax) {
    case "income":
    case "corporate":
    case "vat":
      return gdp * ctx.config.budget.taxBases[tax];
    case "tariffs":
      return bases.importsValue;
    case "rents":
      return bases.rentsValue;
  }
}

function initNation(ctx: EconomyContext, data: NationData): NationEconomy {
  const sheet = data.economy;
  const gdp = data.gdp.value;
  const production = perGood((g) => sheet.goods[g].production.value);
  const consumption = perGood((g) => sheet.goods[g].consumption.value);
  const imports = perGood((g) => Math.max(0, consumption[g] - production[g]));
  const exports = perGood((g) => Math.max(0, production[g] - consumption[g]));
  const basePrices = perGood((g) => ctx.good(g).basePrice);
  const bases = tradeBases(ctx, production, imports, basePrices);

  // Tax rates calibrated so that each tax brings its share of the observed
  // revenue. A rate that would exceed its ceiling (tiny base) is capped and
  // the missing revenue moves to VAT.
  const revenue = sheet.budget.revenuePctGdp.value * gdp;
  const taxes: Record<string, number> = {};
  let missing = 0;
  for (const tax of TAX_IDS) {
    const wanted = revenue * sheet.budget.revenueShares.value[tax];
    const base = taxBase(ctx, tax, gdp, bases);
    const rate = base > 0 ? wanted / base : 0;
    const capped = Math.min(rate, ctx.config.budget.maxTaxRate[tax]);
    taxes[tax] = capped;
    missing += wanted - capped * base;
  }
  if (missing > 0) {
    taxes.vat = Math.min(
      ctx.config.budget.maxTaxRate.vat,
      taxes.vat + missing / taxBase(ctx, "vat", gdp, bases),
    );
  }

  const spending = Object.fromEntries(
    SPENDING_POSTS.map((p) => [p, sheet.budget.spending[p].value]),
  );
  const electricity = Math.max(production.electricity, 1e-9);
  let exportsValue = 0;
  for (const good of ctx.goods) {
    exportsValue += exports[good.id] * good.basePrice * 1e6;
  }
  return {
    gdp,
    debt: data.debtToGdp.value * gdp,
    growthBase: sheet.growthBase.value,
    growthAnnual: sheet.growthBase.value,
    production,
    consumption,
    fossilShare: Object.fromEntries(
      FOSSIL_FUELS.map((f) => [
        f,
        Math.min(1, sheet.electricityFromFossil[f].value / electricity),
      ]),
    ),
    coverage: perGood(() => 1),
    imports,
    exports,
    taxTargets: { ...taxes },
    spendingTargets: { ...spending },
    exportsValue,
    exportShareReference: exportsValue / gdp,
    shortage: 0,
    priceIndex: 1,
    taxes,
    taxes0: { ...taxes },
    spending,
    spending0: { ...spending },
    grantsPctGdp: sheet.budget.grantsPctGdp.value,
    investmentReference: spending.infrastructure + spending.research,
    revenue: 0,
    expenditure: 0,
    interest: 0,
    interestRate: ctx.config.budget.interest.base,
    balances: [],
    debtRisingMonths: 0,
    austerity: false,
    noDeficitUntil: null,
    defaults: 0,
    armsShort: false,
    strikeDamage: 0,
    maritimeTradeValue: 0,
    circumvention: perGood(() => 0),
    tradeOpenness: sheet.tradeOpenness.value,
    tradeFactor: 1,
  };
}

export function initEconomy(
  ctx: EconomyContext,
  nations: readonly NationData[],
  row: RowData,
): EconomyState {
  const state: EconomyState = {
    market: {
      prices: perGood((g) => ctx.good(g).basePrice),
      importPrices: perGood((g) => ctx.good(g).basePrice),
      stranded: perGood(() => 0),
      rowProduction: perGood((g) => row.goods[g]!.production.value),
      rowEffectiveProduction: perGood((g) => row.goods[g]!.production.value),
      rowConsumption: perGood((g) => row.goods[g]!.consumption.value),
      rowSupplyShock: perGood(() => 0),
      embargoes: [],
    },
    nations: Object.fromEntries(nations.map((n) => [n.id, initNation(ctx, n)])),
  };
  // Without a rest of the world (J6) nothing closes the world balance: the
  // demand of every nation is scaled, good by good, to the world production,
  // so that statistical gaps between the series do not move the prices.
  if (row.gdp.value === 0) {
    for (const good of ctx.goods) {
      let produced = 0;
      let consumed = 0;
      for (const n of Object.values(state.nations)) {
        produced += n.production[good.id];
        consumed += n.consumption[good.id];
      }
      if (produced <= 0 || consumed <= 0) continue;
      const factor = produced / consumed;
      for (const n of Object.values(state.nations)) {
        n.consumption[good.id] *= factor;
      }
    }
  }
  return state;
}

export function initPolitics(
  ctx: EconomyContext,
  nations: readonly NationData[],
  playerNation: NationId | null,
  autopilot: boolean,
  rng: Rng,
  date: string,
): PoliticsState {
  return initPoliticsState(ctx, rng, nations, playerNation, autopilot, date);
}

// 1 when debt/GDP is at or below the healthy mark, 0 at the ruinous one.
export function debtHealthOf(ctx: EconomyContext, debtToGdp: number): number {
  const { debtHealthyAt, debtRuinousAt } = ctx.config.politics.stability;
  const t = (debtToGdp - debtHealthyAt) / (debtRuinousAt - debtHealthyAt);
  return 1 - Math.max(0, Math.min(1, t));
}
