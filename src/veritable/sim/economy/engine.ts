import { FOSSIL_FUELS, Good } from "../../data/schemas/goods";
import { ROW_ID } from "../../data/schemas/row";
import {
  EconomyState,
  NationEconomy,
  PoliticsState,
} from "../../data/schemas/save";
import { Rng } from "../rng";
import { EconomyContext } from "./context";
import { perGood } from "./init";
import { demandAt, MarketSide, nextPrice, supplyAt, totals } from "./market";
import { allocateFlows, Trader } from "./trade";

// What the monthly flows leave for the budget of the same month: value of the
// imports (tariff base) and of the resource output actually sold (rents base).
export interface MonthlyTrade {
  importsValue: Record<string, number>; // by nation, US$ per year
  rentsValue: Record<string, number>;
}

// Production a nation can really deliver at the base price: capacity, minus
// what missing fuels take from electricity, minus what missing electricity
// takes from industry. Uses the coverage of the previous month.
export function effectiveProduction(
  ctx: EconomyContext,
  nation: NationEconomy,
  good: Good,
): number {
  const capacity = nation.production[good.id];
  if (good.id === "electricity") {
    let lost = 0;
    for (const fuel of FOSSIL_FUELS) {
      lost += nation.fossilShare[fuel] * (1 - nation.coverage[fuel]);
    }
    return capacity * (1 - Math.min(1, lost));
  }
  if (good.industrial) {
    const lack = 1 - nation.coverage.electricity;
    return (
      capacity * (1 - ctx.config.economy.electricityShortageOnIndustry * lack)
    );
  }
  return capacity;
}

// The rest of the world delivers what it has really brought on line
// (rowEffectiveProduction, which follows the price with a lag of months),
// not an instantaneous response to today's price.
function rowSupply(state: EconomyState, good: Good): number {
  return (
    state.market.rowEffectiveProduction[good.id] *
    (1 + state.market.rowSupplyShock[good.id])
  );
}

function sidesOf(
  ctx: EconomyContext,
  state: EconomyState,
  good: Good,
): MarketSide[] {
  const sides: MarketSide[] = ctx.nationIds.map((id) => ({
    production: effectiveProduction(ctx, state.nations[id], good),
    consumption: state.nations[id].consumption[good.id],
    elasticityFactor: 1,
  }));
  sides.push({
    production: rowSupply(state, good),
    consumption: state.market.rowConsumption[good.id],
    elasticityFactor: ctx.config.economy.rowElasticityFactor,
    supplyElasticityFactor: 0,
  });
  return sides;
}

// Once per game day: one price step per good.
export function stepPrices(ctx: EconomyContext, state: EconomyState): void {
  for (const good of ctx.goods) {
    const price = state.market.prices[good.id];
    const { demand, supply } = totals(sidesOf(ctx, state, good), good, price);
    state.market.prices[good.id] = nextPrice(
      price,
      demand,
      supply,
      state.market.stranded[good.id],
      good,
      ctx.config.economy,
    );
  }
}

// Once per game month: bilateral flows, coverage, shortage index, import
// prices, price index, value of the exports really sold.
export function stepTrade(
  ctx: EconomyContext,
  state: EconomyState,
): MonthlyTrade {
  const { market } = state;
  const cfg = ctx.config.economy;
  const discount = cfg.sanctionDiscount;
  const blocked = new Set(
    market.embargoes.map((e) => `${e.good}|${e.from}|${e.to}`),
  );
  const importsValue: Record<string, number> = {};
  const rentsValue: Record<string, number> = {};
  const exportsValue: Record<string, number> = {};
  // Price each nation paid for its basket, weighted by consumption.
  const basket: Record<string, number> = {};
  const basketBase: Record<string, number> = {};
  for (const id of ctx.nationIds) {
    importsValue[id] = 0;
    rentsValue[id] = 0;
    exportsValue[id] = 0;
    basket[id] = 0;
    basketBase[id] = 0;
  }

  for (const good of ctx.goods) {
    const price = market.prices[good.id];
    const needed = new Map<string, number>();
    const produced = new Map<string, number>();
    const traders: Trader[] = [];
    const add = (id: string, supply: number, demand: number) => {
      needed.set(id, demand);
      produced.set(id, supply);
      traders.push({
        id,
        surplus: Math.max(0, supply - demand),
        deficit: Math.max(0, demand - supply),
      });
    };
    for (const id of ctx.nationIds) {
      const nation = state.nations[id];
      add(
        id,
        supplyAt(effectiveProduction(ctx, nation, good), good, price),
        demandAt(nation.consumption[good.id], good, price),
      );
    }
    add(
      ROW_ID,
      rowSupply(state, good),
      demandAt(
        market.rowConsumption[good.id],
        good,
        price,
        cfg.rowElasticityFactor,
      ),
    );

    const flows = allocateFlows(
      traders,
      (exporter, importer) =>
        blocked.has(`${good.id}|${exporter}|${importer}`)
          ? 0
          : ctx.affinity(good, exporter, importer),
      cfg.rationingPasses,
    );

    // What the scenario's importers could not get sets the premium they pay
    // over the world price (the "pays a premium elsewhere" of DESIGN.md).
    let uncovered = 0;
    let scenarioDemand = 0;
    for (const id of ctx.nationIds) {
      const demand = needed.get(id)!;
      const supply = produced.get(id)!;
      const received = flows.received.get(id) ?? 0;
      uncovered += Math.max(0, demand - Math.min(supply, demand) - received);
      scenarioDemand += demand;
    }
    const importPrice =
      price *
      (1 +
        cfg.scarcityPremium *
          (scenarioDemand > 0 ? uncovered / scenarioDemand : 0));
    market.importPrices[good.id] = importPrice;

    // What an embargoed exporter could not place is dumped on the rest of the
    // world at a discount, and leaves the supply that forms the price.
    let stranded = 0;
    for (const id of ctx.nationIds) {
      const nation = state.nations[id];
      const demand = needed.get(id)!;
      const supply = produced.get(id)!;
      const received = flows.received.get(id) ?? 0;
      const shipped = flows.shipped.get(id) ?? 0;
      const unsold = flows.unsold.get(id) ?? 0;
      const embargoed = market.embargoes.some(
        (e) => e.good === good.id && e.from === id,
      );
      nation.imports[good.id] = received;
      nation.exports[good.id] = shipped + unsold;
      nation.coverage[good.id] =
        demand <= 1e-12
          ? 1
          : Math.min(1, (Math.min(supply, demand) + received) / demand);
      importsValue[id] += received * importPrice * 1e6;
      const dumped = embargoed ? unsold : 0;
      exportsValue[id] += (shipped + dumped * (1 - discount)) * price * 1e6;
      if (good.rent) {
        rentsValue[id] += (supply - dumped * discount) * price * 1e6;
      }
      if (embargoed) stranded += unsold;
      // The imported share of the basket is paid at the import price.
      const importedShare =
        demand <= 1e-12 ? 0 : Math.min(1, received / demand);
      const paid = price + (importPrice - price) * importedShare;
      basket[id] += nation.consumption[good.id] * paid;
      basketBase[id] += nation.consumption[good.id] * good.basePrice;
    }
    market.stranded[good.id] = stranded;
  }

  for (const id of ctx.nationIds) {
    const nation = state.nations[id];
    let shortage = 0;
    for (const good of ctx.goods) {
      shortage += good.shortageWeight * (1 - nation.coverage[good.id]);
    }
    nation.shortage = shortage;
    nation.priceIndex = basketBase[id] > 0 ? basket[id] / basketBase[id] : 1;
    nation.armsShort = nation.coverage.arms < 0.999;
    nation.exportsValue = exportsValue[id];
  }
  return { importsValue, rentsValue };
}

// Once per game month, after the flows:
//   GDP(m+1) = GDP(m) x (1 + g)
//   g = g_base / 12 + alpha x (infrastructure + research - reference)
//       - beta x shortage - gamma x unrest
//       + delta x (exports / GDP - export share reference) + noise
// The export share reference starts at the value of the first day and adapts
// slowly to the current share: an export shock costs growth for years, not
// for ever, and steady export growth costs nothing.
// Production capacities and the demand base follow GDP; capacities also follow
// investment. The rest of the world grows on its trend, with an AR(1) supply
// shock per good; what it really delivers follows its price response with a
// lag of months.
export function stepGrowth(
  ctx: EconomyContext,
  state: EconomyState,
  politics: PoliticsState,
  rng: Rng,
): void {
  const cfg = ctx.config.economy;
  const c = cfg.growth;
  for (const id of ctx.nationIds) {
    const nation = state.nations[id];
    const investment =
      nation.spending.infrastructure +
      nation.spending.research -
      nation.investmentReference;
    const exportShare = nation.exportsValue / nation.gdp;
    const g =
      nation.growthBase / 12 +
      c.alpha * investment -
      c.beta * nation.shortage -
      (politics.nations[id].unrest ? c.gamma : 0) +
      c.delta * (exportShare - nation.exportShareReference) +
      c.noiseMonthlySd * rng.nextGaussian();
    nation.exportShareReference +=
      (exportShare - nation.exportShareReference) /
      cfg.exportReferenceAdaptMonths;
    nation.gdp *= 1 + g;
    nation.growthAnnual = g * 12;
    const capacity = 1 + g + c.capacityInvestment * investment;
    for (const good of ctx.goods) {
      nation.production[good.id] *= capacity;
      nation.consumption[good.id] *= 1 + g;
    }
  }

  const { market } = state;
  const trend = 1 + cfg.rowGrowthPerYear / 12;
  const noise = cfg.rowSupplyNoise;
  for (const good of ctx.goods) {
    market.rowProduction[good.id] *= trend;
    market.rowConsumption[good.id] *= trend;
    // Capacity the world would have at today's price, reached with a lag.
    const target = supplyAt(
      market.rowProduction[good.id],
      good,
      market.prices[good.id],
      cfg.rowElasticityFactor,
    );
    const carried = market.rowEffectiveProduction[good.id] * trend;
    market.rowEffectiveProduction[good.id] =
      carried + (target - carried) / cfg.rowSupplyLagMonths;
    market.rowSupplyShock[good.id] =
      noise.persistence * market.rowSupplyShock[good.id] +
      noise.monthlySd * rng.nextGaussian();
  }
}

export { perGood };
