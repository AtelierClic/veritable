import { VeritableConfig } from "../../data/schemas/config";
import { Good } from "../../data/schemas/goods";

// World price of a good, once per game day:
//
//   D = sum of consumption_base x (p / p_base)^(-epsilon)
//   S = sum of production      x (p / p_base)^(+eta)
//   p(t+1) = p(t) x (1 + k x (D - S) / S)
//
// bounded to +-maxDailyPriceChange per day and to [floor, ceiling] x p_base.
// The rest of the world reacts with doubled elasticities.

export interface MarketSide {
  production: number; // per year, at the base price
  consumption: number;
  elasticityFactor: number; // 1 for a nation, rowElasticityFactor for ROW
  // Supply side only, when it differs: 0 for the rest of the world, whose
  // production follows the price with a lag (engine.ts) instead of instantly.
  supplyElasticityFactor?: number;
}

export function demandAt(
  consumption: number,
  good: Good,
  price: number,
  elasticityFactor = 1,
): number {
  return (
    consumption *
    Math.pow(price / good.basePrice, -good.epsilon * elasticityFactor)
  );
}

export function supplyAt(
  production: number,
  good: Good,
  price: number,
  elasticityFactor = 1,
): number {
  return (
    production * Math.pow(price / good.basePrice, good.eta * elasticityFactor)
  );
}

export function totals(
  sides: readonly MarketSide[],
  good: Good,
  price: number,
): { demand: number; supply: number } {
  let demand = 0;
  let supply = 0;
  for (const side of sides) {
    demand += demandAt(side.consumption, good, price, side.elasticityFactor);
    supply += supplyAt(
      side.production,
      good,
      price,
      side.supplyElasticityFactor ?? side.elasticityFactor,
    );
  }
  return { demand, supply };
}

// `stranded`: volume kept off the market by embargoes (per year). It is
// produced and dumped at a discount, but does not reach the buyers who set
// the price.
export function nextPrice(
  price: number,
  demand: number,
  supply: number,
  stranded: number,
  good: Good,
  config: VeritableConfig["economy"],
): number {
  const effectiveSupply = Math.max(supply - stranded, supply * 0.01, 1e-9);
  const raw =
    config.priceAdjustment * ((demand - effectiveSupply) / effectiveSupply);
  const change = Math.max(
    -config.maxDailyPriceChange,
    Math.min(config.maxDailyPriceChange, raw),
  );
  const next = price * (1 + change);
  return Math.max(
    good.basePrice * config.priceFloor,
    Math.min(good.basePrice * config.priceCeiling, next),
  );
}
