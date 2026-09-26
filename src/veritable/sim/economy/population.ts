import { NationId } from "../../data/schemas/common";
import { VeritableConfig } from "../../data/schemas/config";
import { NationData } from "../../data/schemas/nation";
import { EconomyState } from "../../data/schemas/save";

// J7: the population of a nation follows the trend of its sheet at the start
// (World Bank, 2015-2025), which converges to a long-run rate: the
// demographic transition. With g in continuous rates and t in years since
// the start of the campaign,
//   g(t) = g_inf + (g0 - g_inf) x 0.5^(t / halfLife),
// and over [t1, t2] the population is multiplied by exp(∫ g dt): the same
// whatever the cadence of the updates. A sheet without a trend (a test
// sheet) keeps its population.
export function populationFactor(
  config: VeritableConfig,
  trend: number | undefined,
  fromYears: number,
  toYears: number,
): number {
  if (trend === undefined || !(toYears > fromYears)) return 1;
  const cfg = config.economy.population;
  const gInf = Math.log1p(cfg.longRunGrowth);
  const g0 = Math.log1p(trend);
  const k = Math.LN2 / cfg.halfLifeYears;
  const integral =
    gInf * (toYears - fromYears) +
    ((g0 - gInf) * (Math.exp(-k * fromYears) - Math.exp(-k * toYears))) / k;
  return Math.exp(integral);
}

// The population in play (J7): the economy's, which moves; the sheet's for
// a nation the economy does not carry.
export function populationOf(
  economy: EconomyState,
  sheets: ReadonlyMap<NationId, NationData> | ((id: NationId) => NationData),
  id: NationId,
): number {
  const live = economy.nations[id]?.population;
  if (live !== undefined) return live;
  const sheet = typeof sheets === "function" ? sheets(id) : sheets.get(id);
  return sheet?.population.value ?? 0;
}
