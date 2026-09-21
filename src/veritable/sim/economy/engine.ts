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
    production:
      state.market.rowProduction[good.id] *
      (1 + state.market.rowSupplyShock[good.id]),
    consumption: state.market.rowConsumption[good.id],
    elasticityFactor: ctx.config.economy.rowElasticityFactor,
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

// Once per game month: bilateral flows, coverage, shortage index, price index.
export function stepTrade(
  ctx: EconomyContext,
  state: EconomyState,
): MonthlyTrade {
  const { market } = state;
  const discount = ctx.config.economy.sanctionDiscount;
  const blocked = new Set(
    market.embargoes.map((e) => `${e.good}|${e.from}|${e.to}`),
  );
  const importsValue: Record<string, number> = {};
  const rentsValue: Record<string, number> = {};
  for (const id of ctx.nationIds) {
    importsValue[id] = 0;
    rentsValue[id] = 0;
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
    const rowFactor = ctx.config.economy.rowElasticityFactor;
    add(
      ROW_ID,
      supplyAt(
        market.rowProduction[good.id] * (1 + market.rowSupplyShock[good.id]),
        good,
        price,
        rowFactor,
      ),
      demandAt(market.rowConsumption[good.id], good, price, rowFactor),
    );

    const flows = allocateFlows(
      traders,
      (exporter, importer) =>
        blocked.has(`${good.id}|${exporter}|${importer}`)
          ? 0
          : ctx.affinity(good, exporter, importer),
      ctx.config.economy.rationingPasses,
    );

    // What an embargoed exporter could not place is dumped on the rest of the
    // world at a discount, and leaves the supply that forms the price.
    let stranded = 0;
    for (const id of ctx.nationIds) {
      const nation = state.nations[id];
      const demand = needed.get(id)!;
      const supply = produced.get(id)!;
      const received = flows.received.get(id) ?? 0;
      const unsold = flows.unsold.get(id) ?? 0;
      const embargoed = market.embargoes.some(
        (e) => e.good === good.id && e.from === id,
      );
      nation.imports[good.id] = received;
      nation.exports[good.id] = (flows.shipped.get(id) ?? 0) + unsold;
      nation.coverage[good.id] =
        demand <= 1e-12
          ? 1
          : Math.min(1, (Math.min(supply, demand) + received) / demand);
      importsValue[id] += received * price * 1e6;
      if (good.rent) {
        const dumped = embargoed ? unsold : 0;
        rentsValue[id] += (supply - dumped * discount) * price * 1e6;
      }
      if (embargoed) stranded += unsold;
    }
    market.stranded[good.id] = stranded;
  }

  for (const id of ctx.nationIds) {
    const nation = state.nations[id];
    let shortage = 0;
    let basket = 0;
    let basketBase = 0;
    for (const good of ctx.goods) {
      shortage += good.shortageWeight * (1 - nation.coverage[good.id]);
      basket += nation.consumption[good.id] * market.prices[good.id];
      basketBase += nation.consumption[good.id] * good.basePrice;
    }
    nation.shortage = shortage;
    nation.priceIndex = basketBase > 0 ? basket / basketBase : 1;
    nation.armsShort = nation.coverage.arms < 0.999;
  }
  return { importsValue, rentsValue };
}

// Once per game month, after the flows:
//   GDP(m+1) = GDP(m) x (1 + g)
//   g = g_base / 12 + alpha x (infrastructure + research - reference)
//       - beta x shortage - gamma x unrest + noise
// Production capacities and the demand base follow GDP; capacities also follow
// investment. The rest of the world grows on its trend, with an AR(1) supply
// shock per good.
export function stepGrowth(
  ctx: EconomyContext,
  state: EconomyState,
  politics: PoliticsState,
  rng: Rng,
): void {
  const c = ctx.config.economy.growth;
  for (const id of ctx.nationIds) {
    const nation = state.nations[id];
    const investment =
      nation.spending.infrastructure +
      nation.spending.research -
      nation.investmentReference;
    const g =
      nation.growthBase / 12 +
      c.alpha * investment -
      c.beta * nation.shortage -
      (politics.nations[id].unrest ? c.gamma : 0) +
      c.noiseMonthlySd * rng.nextGaussian();
    nation.gdp *= 1 + g;
    nation.growthAnnual = g * 12;
    const capacity = 1 + g + c.capacityInvestment * investment;
    for (const good of ctx.goods) {
      nation.production[good.id] *= capacity;
      nation.consumption[good.id] *= 1 + g;
    }
  }

  const { market } = state;
  const trend = 1 + ctx.config.economy.rowGrowthPerYear / 12;
  const noise = ctx.config.economy.rowSupplyNoise;
  for (const good of ctx.goods) {
    market.rowProduction[good.id] *= trend;
    market.rowConsumption[good.id] *= trend;
    market.rowSupplyShock[good.id] =
      noise.persistence * market.rowSupplyShock[good.id] +
      noise.monthlySd * rng.nextGaussian();
  }
}

export { perGood };
