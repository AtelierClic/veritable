import { FOSSIL_FUELS, Good } from "../../data/schemas/goods";
import {
  EconomyState,
  NationEconomy,
  PoliticsState,
} from "../../data/schemas/save";
import { Rng } from "../rng";
import { EconomyContext } from "./context";
import { perGood } from "./init";
import { demandAt, MarketSide, nextPrice, supplyAt, totals } from "./market";
import { allocateFlowsIndexed, flowBuffers } from "./trade";

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
  // Without a rest of the world (J6), its supply shock hits every producer.
  const capacity =
    nation.production[good.id] *
    (ctx.hasRow ? 1 : 1 + ctx.worldSupplyShock(good.id));
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

// Affinity of every pair for each kind of transport this month (J6c): the
// static distance decay and land adjacency of the grid, times the bloc and
// agreement bonuses in force. Same values as ctx.affinity, on indices.
export function tradeAffinities(
  ctx: EconomyContext,
): Record<Good["transport"], Float64Array> {
  const grid = ctx.tradeGrid();
  const m = grid.ids.length;
  const bonus = new Float64Array(m * m).fill(1);
  for (const bloc of ctx.blocs) {
    if (bloc.tradeBonus === undefined) continue;
    const members: number[] = [];
    grid.ids.forEach((id, k) => {
      if (ctx.isFullMember(bloc, id)) members.push(k);
    });
    for (const a of members) {
      for (const b of members) {
        if (a !== b) bonus[a * m + b] *= bloc.tradeBonus;
      }
    }
  }
  for (const [pair, multiplier] of ctx.pairBonus) {
    const [exporter, importer] = pair.split("|");
    const e = grid.index.get(exporter);
    const i = grid.index.get(importer);
    if (e !== undefined && i !== undefined) bonus[e * m + i] *= multiplier;
  }
  const normal = new Float64Array(m * m);
  const neighbours = new Float64Array(m * m);
  const free = new Float64Array(m * m);
  for (let k = 0; k < m * m; k++) {
    if (Math.floor(k / m) === k % m) continue;
    free[k] = bonus[k];
    normal[k] = grid.decay[k] * bonus[k];
    if (grid.neighbours[k] === 1) neighbours[k] = normal[k];
  }
  return { normal, "neighbors-only": neighbours, free };
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
  const grid = ctx.tradeGrid();
  const ids = grid.ids;
  const m = ids.length;
  const rowIndex = m - 1; // the rest of the world closes the grid
  const nationCount = ctx.nationIds.length;
  const affinities = tradeAffinities(ctx);
  // Embargoes by good: the pairs, and the exporters under one.
  const blockedByGood = new Map<string, Uint8Array>();
  const embargoedByGood = new Map<string, Uint8Array>();
  for (const e of market.embargoes) {
    const from = grid.index.get(e.from);
    const to = grid.index.get(e.to);
    if (from === undefined || to === undefined) continue;
    let blocked = blockedByGood.get(e.good);
    if (blocked === undefined) {
      blocked = new Uint8Array(m * m);
      blockedByGood.set(e.good, blocked);
      embargoedByGood.set(e.good, new Uint8Array(m));
    }
    blocked[from * m + to] = 1;
    embargoedByGood.get(e.good)![from] = 1;
  }
  const importsValue: Record<string, number> = {};
  const rentsValue: Record<string, number> = {};
  const exportsValue = new Float64Array(m);
  const maritimeValue = new Float64Array(m);
  // Price each nation paid for its basket, weighted by consumption.
  const basket = new Float64Array(m);
  const basketBase = new Float64Array(m);
  const imports = new Float64Array(m);
  const rents = new Float64Array(m);

  const needed = new Float64Array(m);
  const produced = new Float64Array(m);
  const surplus = new Float64Array(m);
  const deficit = new Float64Array(m);
  const lostShare = new Float64Array(m);
  const withheld = new Float64Array(m);
  const buffers = flowBuffers(m);
  for (const good of ctx.goods) {
    const price = market.prices[good.id];
    for (let k = 0; k < nationCount; k++) {
      const nation = state.nations[ids[k]];
      produced[k] = supplyAt(
        effectiveProduction(ctx, nation, good),
        good,
        price,
      );
      needed[k] = demandAt(nation.consumption[good.id], good, price);
    }
    produced[rowIndex] = rowSupply(state, good);
    needed[rowIndex] = demandAt(
      market.rowConsumption[good.id],
      good,
      price,
      cfg.rowElasticityFactor,
    );
    for (let k = 0; k < m; k++) {
      surplus[k] = Math.max(0, produced[k] - needed[k]);
      deficit[k] = Math.max(0, needed[k] - produced[k]);
    }
    const affinity = affinities[good.transport];
    const blocked = blockedByGood.get(good.id);
    const embargoed = embargoedByGood.get(good.id);

    // Market an embargoed exporter loses: the share of its potential buyers
    // (by affinity and deficit) that embargo it. Only what its circumvention
    // index allows is offered to new customers, at the sanction discount; the
    // rest is withheld: unsold, dumped, off the price-forming supply.
    //
    // The circumvention index of the good builds up in proportion to the
    // market lost (a fungible good shipped by sea re-routes faster than
    // pipeline gas, goods.json), and fades once the good is free again.
    const rate = good.circumvention ?? cfg.circumvention;
    for (let e = 0; e < nationCount; e++) {
      const nation = state.nations[ids[e]];
      let potential = 0;
      let blockedPotential = 0;
      if (blocked !== undefined) {
        const row = e * m;
        for (let i = 0; i < m; i++) {
          if (deficit[i] <= 0) continue;
          const w = affinity[row + i] * deficit[i];
          potential += w;
          if (blocked[row + i] === 1) blockedPotential += w;
        }
      }
      const lost =
        surplus[e] > 0 && potential > 0 ? blockedPotential / potential : 0;
      lostShare[e] = lost;
      const current = nation.circumvention[good.id];
      nation.circumvention[good.id] =
        lost > 0
          ? Math.min(
              rate.max,
              Math.max(rate.initial, current) + rate.perMonth * lost,
            )
          : Math.max(0, current - rate.perMonth);
      withheld[e] = 0;
      if (lost > 0) {
        const kept = surplus[e] * lost * (1 - nation.circumvention[good.id]);
        surplus[e] -= kept;
        withheld[e] = kept;
      }
    }

    const flows = allocateFlowsIndexed(
      surplus,
      deficit,
      affinity,
      cfg.rationingPasses,
      blocked,
      buffers,
    );
    // Blockades: a share of what went by sea is lost at sea. It is neither
    // delivered nor sold, and it leaves the supply that forms the price.
    let blockaded = 0;
    if (good.transport === "normal") {
      for (let e = 0; e < m; e++) {
        if (flows.shipped[e] <= 0) continue;
        const row = e * m;
        for (let i = 0; i < m; i++) {
          const volume = flows.delivered[row + i];
          if (volume <= 0) continue;
          if (grid.neighbours[row + i] === 1) continue;
          const lost = volume * (1 - maritime(ids[e], ids[i]));
          if (lost > 0) {
            flows.delivered[row + i] = volume - lost;
            flows.received[i] -= lost;
            flows.shipped[e] -= lost;
            flows.unsold[e] += lost;
            blockaded += lost;
          }
          const value = (volume - lost) * price * 1e6;
          maritimeValue[e] += value;
          maritimeValue[i] += value;
        }
      }
    }

    // What the scenario's importers could not get sets the premium they pay
    // over the world price (the "pays a premium elsewhere" of DESIGN.md).
    let uncovered = 0;
    let scenarioDemand = 0;
    for (let k = 0; k < nationCount; k++) {
      const demand = needed[k];
      uncovered += Math.max(
        0,
        demand - Math.min(produced[k], demand) - flows.received[k],
      );
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
    for (let k = 0; k < nationCount; k++) {
      const nation = state.nations[ids[k]];
      const demand = needed[k];
      const supply = produced[k];
      const received = flows.received[k];
      const shipped = flows.shipped[k];
      const unsold = flows.unsold[k] + withheld[k];
      const isEmbargoed = embargoed !== undefined && embargoed[k] === 1;
      nation.imports[good.id] = received;
      nation.exports[good.id] = shipped + unsold;
      nation.coverage[good.id] =
        demand <= 1e-12
          ? 1
          : Math.min(1, (Math.min(supply, demand) + received) / demand);
      imports[k] += received * importPrice * 1e6;
      // J6c: only what the embargoes kept from its buyers — what it withheld,
      // and its unsold in the share of its market they closed — is dumped at
      // the discount and leaves the supply that forms the price. At 208
      // nations a producer embargoed by one small buyer had all its ordinary
      // unsold taken off the market: the Gulf's surplus left the price, which
      // rose, and they produced more.
      const dumped = isEmbargoed
        ? withheld[k] + flows.unsold[k] * lostShare[k]
        : 0;
      // What is re-routed or dumped sells at the discount, which narrows as
      // the circumvention of the good builds up (new buyers, shadow fleet).
      const circumvention = nation.circumvention[good.id];
      const rerouted = discount * lostShare[k] * (1 - circumvention);
      const dumpDiscount = discount * (1 - circumvention);
      exportsValue[k] +=
        (shipped * (1 - rerouted) + dumped * (1 - dumpDiscount)) * price * 1e6;
      if (good.rent) {
        rents[k] +=
          (supply - dumped * dumpDiscount - shipped * rerouted) * price * 1e6;
      }
      if (isEmbargoed) stranded += dumped;
      // The imported share of the basket is paid at the import price.
      const importedShare =
        demand <= 1e-12 ? 0 : Math.min(1, received / demand);
      const paid = price + (importPrice - price) * importedShare;
      basket[k] += nation.consumption[good.id] * paid;
      basketBase[k] += nation.consumption[good.id] * good.basePrice;
    }
    market.stranded[good.id] = stranded + blockaded;
  }

  for (let k = 0; k < nationCount; k++) {
    const id = ids[k];
    const nation = state.nations[id];
    let shortage = 0;
    for (const good of ctx.goods) {
      shortage += good.shortageWeight * (1 - nation.coverage[good.id]);
    }
    nation.shortage = shortage;
    nation.priceIndex = basketBase[k] > 0 ? basket[k] / basketBase[k] : 1;
    nation.armsShort = nation.coverage.arms < 0.999;
    nation.exportsValue = exportsValue[k];
    nation.maritimeTradeValue = maritimeValue[k];
    importsValue[id] = imports[k];
    rentsValue[id] = rents[k];
  }
  return { importsValue, rentsValue };
}

// Circumvention of a nation's exports as a whole: its per-good indices
// weighted by the value of what it exports.
export function exportCircumvention(
  ctx: EconomyContext,
  state: EconomyState,
  nation: NationEconomy,
): number {
  let weighted = 0;
  let total = 0;
  for (const good of ctx.goods) {
    const value = nation.exports[good.id] * state.market.prices[good.id];
    weighted += value * nation.circumvention[good.id];
    total += value;
  }
  return total > 0 ? weighted / total : 0;
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
  // Extra trend growth per year: technology and events (J5).
  extraGrowth: (id: string) => number = () => 0,
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
        (1 - exportCircumvention(ctx, state, nation));
    const before = nation.tradeFactor;
    nation.tradeFactor += (target - before) / cfg.tradeFactorAdjustMonths;
    const tradeStep = nation.tradeFactor / before - 1;
    const investment =
      nation.spending.infrastructure +
      nation.spending.research -
      nation.investmentReference;
    const exportShare = nation.exportsValue / nation.gdp;
    const g =
      (nation.growthBase + extraGrowth(id)) / 12 +
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
