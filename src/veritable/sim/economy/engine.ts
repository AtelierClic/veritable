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
      capacity *
      (1 - ctx.config.economy.electricityShortageOnIndustry * lack) *
      (1 - nation.strikeDamage)
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
  // Share of the flows of a pair that trades by sea that gets through
  // (blockades, J3b): what does not is neither delivered nor sold, and
  // leaves the supply that forms the price.
  maritime: (exporter: string, importer: string) => number = () => 1,
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
  const maritimeValue: Record<string, number> = {};
  // Price each nation paid for its basket, weighted by consumption.
  const basket: Record<string, number> = {};
  const basketBase: Record<string, number> = {};
  for (const id of ctx.nationIds) {
    importsValue[id] = 0;
    rentsValue[id] = 0;
    exportsValue[id] = 0;
    maritimeValue[id] = 0;
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

    // Market an embargoed exporter loses: the share of its potential buyers
    // (by affinity and deficit) that embargo it. Only what its circumvention
    // index allows is offered to new customers, at the sanction discount; the
    // rest is withheld: unsold, dumped, off the price-forming supply.
    const lostShare = new Map<string, number>();
    const withheld = new Map<string, number>();
    for (const exporter of traders) {
      if (exporter.surplus <= 0 || exporter.id === ROW_ID) continue;
      let potential = 0;
      let blockedPotential = 0;
      for (const importer of traders) {
        if (importer.deficit <= 0) continue;
        const w =
          ctx.affinity(good, exporter.id, importer.id) * importer.deficit;
        potential += w;
        if (blocked.has(`${good.id}|${exporter.id}|${importer.id}`)) {
          blockedPotential += w;
        }
      }
      const lost = potential > 0 ? blockedPotential / potential : 0;
      lostShare.set(exporter.id, lost);
      if (lost > 0) {
        const circumvention = state.nations[exporter.id].circumvention;
        const kept = exporter.surplus * lost * (1 - circumvention);
        exporter.surplus -= kept;
        withheld.set(exporter.id, kept);
      }
    }

    const flows = allocateFlows(
      traders,
      (exporter, importer) =>
        blocked.has(`${good.id}|${exporter}|${importer}`)
          ? 0
          : ctx.affinity(good, exporter, importer),
      cfg.rationingPasses,
    );
    // Blockades: a share of what went by sea is lost at sea. It is neither
    // delivered nor sold, and it leaves the supply that forms the price.
    let blockaded = 0;
    if (good.transport === "normal") {
      for (const [exporter, row] of flows.delivered) {
        for (const [importer, volume] of row) {
          if (ctx.landNeighbours(exporter, importer)) continue;
          const lost = volume * (1 - maritime(exporter, importer));
          if (lost > 0) {
            row.set(importer, volume - lost);
            flows.received.set(importer, flows.received.get(importer)! - lost);
            flows.shipped.set(exporter, flows.shipped.get(exporter)! - lost);
            flows.unsold.set(
              exporter,
              (flows.unsold.get(exporter) ?? 0) + lost,
            );
            blockaded += lost;
          }
          const value = (volume - lost) * price * 1e6;
          if (maritimeValue[exporter] !== undefined) {
            maritimeValue[exporter] += value;
          }
          if (maritimeValue[importer] !== undefined) {
            maritimeValue[importer] += value;
          }
        }
      }
    }

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
      const unsold = (flows.unsold.get(id) ?? 0) + (withheld.get(id) ?? 0);
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
      const rerouted = discount * (lostShare.get(id) ?? 0);
      exportsValue[id] +=
        (shipped * (1 - rerouted) + dumped * (1 - discount)) * price * 1e6;
      if (good.rent) {
        rentsValue[id] +=
          (supply - dumped * discount - shipped * rerouted) * price * 1e6;
      }
      if (embargoed) stranded += unsold;
      void blockaded;
      // The imported share of the basket is paid at the import price.
      const importedShare =
        demand <= 1e-12 ? 0 : Math.min(1, received / demand);
      const paid = price + (importPrice - price) * importedShare;
      basket[id] += nation.consumption[good.id] * paid;
      basketBase[id] += nation.consumption[good.id] * good.basePrice;
    }
    market.stranded[good.id] = stranded + blockaded;
  }

  const circumvention = cfg.circumvention;
  for (const id of ctx.nationIds) {
    const nation = state.nations[id];
    // Circumvention builds up while embargoed, fades once free.
    const embargoedExporter = market.embargoes.some((e) => e.from === id);
    nation.circumvention = embargoedExporter
      ? Math.min(
          1,
          Math.max(circumvention.initial, nation.circumvention) +
            circumvention.perMonth,
        )
      : Math.max(0, nation.circumvention - circumvention.perMonth);
    let shortage = 0;
    for (const good of ctx.goods) {
      shortage += good.shortageWeight * (1 - nation.coverage[good.id]);
    }
    nation.shortage = shortage;
    nation.priceIndex = basketBase[id] > 0 ? basket[id] / basketBase[id] : 1;
    nation.armsShort = nation.coverage.arms < 0.999;
    nation.exportsValue = exportsValue[id];
    nation.maritimeTradeValue = maritimeValue[id];
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
  // Share of the trade partners of a nation (by distance and GDP) that
  // sanction it or fight it: sanctions are not cosmetic (J3a).
  lostTradeShare: (id: string) => number = () => 0,
): void {
  const cfg = ctx.config.economy;
  const c = cfg.growth;
  for (const id of ctx.nationIds) {
    const nation = state.nations[id];
    // Trade dependence: the GDP level moves towards what the remaining
    // partners support.
    const target =
      1 -
      cfg.sanctionFriction *
        nation.tradeOpenness *
        lostTradeShare(id) *
        (1 - nation.circumvention);
    const before = nation.tradeFactor;
    nation.tradeFactor += (target - before) / cfg.tradeFactorAdjustMonths;
    const tradeStep = nation.tradeFactor / before - 1;
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
      tradeStep +
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
