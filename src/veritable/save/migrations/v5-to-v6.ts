import { TILE_NATION_MASK, TILE_SETTLED_BIT } from "../../data/schemas/save";
import { SaveFileV5 } from "../../data/schemas/saveV5";
import { ClaimV6 as Claim, SaveFileV6 } from "../../data/schemas/saveV6";
import { initClaims, scenarioWarClaims } from "../../sim/diplomacy/claims";
import { homelandRegion } from "../../sim/war/claimTiles";
import { CONTEST_CEDED_BIT } from "../../sim/war/contest";
import { MigrationContext } from "./index";

// v5 (J5) -> v6 (J6). Everything of the v5 is kept; the v6 adds:
//   - war memory: none (the wars that ended before the save are forgotten);
//   - the losses of each war in progress: 0 from the save on (the v5 did
//     not count them by war);
//   - the claims each war in progress is fought on: the regions of the
//     scenario its aggressors claim from its defenders (the controllers of
//     the scenario data);
//   - the claims: those of the scenario, at full weight, and the homeland of
//     every nation annexed before the save; the regions a v5 cession gave
//     the loser are dropped (a cession now settles its land);
//   - the settled tiles (bit 14 of the tile block): every tile a treaty had
//     ceded, still marked in the contest block, except the land of a nation
//     annexed before the save (it keeps its claim);
//   - the goods measured as an index until the J6 are measured in value (1
//     unit = 1 bn US$): every quantity of them (production, consumption,
//     trade, the rest of the world, arms sent) is multiplied by the dollar
//     value of an index point divided by 1000, every price divided by it.
//     The point values are those of the only scenario v5 saves exist for,
//     europe-10 (J5 data/veritable/goods/goods.json).
// M$ per index point of the goods measured as an index in the J5 data
// (europe-10: 100 points = production of its ten nations).
export const J5_INDEX_POINT_MUSD: Readonly<Record<string, number>> = {
  "critical-minerals": 600,
  steel: 1731.49,
  "consumer-goods": 12986.2,
  electronics: 3462.97,
  arms: 1658.88,
  pharma: 1442.91,
  services: 150147,
};

function scaled(
  amounts: Record<string, number>,
  factor: (good: string) => number,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(amounts).map(([good, v]) => [good, v * factor(good)]),
  );
}

export function v5ToV6(
  save: SaveFileV5,
  context: MigrationContext | undefined,
): SaveFileV6 {
  const scenario = context?.scenario;
  const claims: Claim[] = scenario === undefined ? [] : initClaims(scenario);
  const annexers = new Set<string>();
  for (const region of save.diplomacy.contestedRegions) {
    if (!region.region.endsWith("-annexation")) continue;
    annexers.add(region.controller);
    for (const claimant of region.claimants) {
      const home = homelandRegion(claimant);
      if (!claims.some((c) => c.claimant === claimant && c.region === home)) {
        claims.push({ region: home, claimant, weight: 1, failures: 0 });
      }
    }
  }

  const tiles = save.tiles.slice();
  for (let tile = 0; tile < tiles.length; tile++) {
    if ((save.contest[tile] & CONTEST_CEDED_BIT) === 0) continue;
    const owner = tiles[tile] & TILE_NATION_MASK;
    if (owner === 0) continue;
    if (annexers.has(save.nations[owner - 1].id)) continue;
    tiles[tile] |= TILE_SETTLED_BIT;
  }

  const { contestedRegions, ...diplomacy } = save.diplomacy;
  void contestedRegions;
  const quantity = (good: string) =>
    J5_INDEX_POINT_MUSD[good] === undefined
      ? 1
      : J5_INDEX_POINT_MUSD[good] / 1000;
  const price = (good: string) => 1 / quantity(good);
  const market = save.economy.market;
  return {
    ...save,
    schemaVersion: 6,
    tiles,
    economy: {
      market: {
        ...market,
        prices: scaled(market.prices, price),
        importPrices: scaled(market.importPrices, price),
        stranded: scaled(market.stranded, quantity),
        rowProduction: scaled(market.rowProduction, quantity),
        rowEffectiveProduction: scaled(market.rowEffectiveProduction, quantity),
        rowConsumption: scaled(market.rowConsumption, quantity),
      },
      nations: Object.fromEntries(
        Object.entries(save.economy.nations).map(([id, e]) => [
          id,
          {
            ...e,
            production: scaled(e.production, quantity),
            consumption: scaled(e.consumption, quantity),
            imports: scaled(e.imports, quantity),
            exports: scaled(e.exports, quantity),
            // J6b: a campaign of the J5 keeps the rate of the J2.
            interestSpread: 0,
          },
        ]),
      ),
    },
    ai: {
      ...save.ai,
      armsAid: save.ai.armsAid.map((a) => ({
        ...a,
        points: a.points * quantity("arms"),
      })),
    },
    diplomacy: {
      ...diplomacy,
      wars: diplomacy.wars.map((war) => ({
        ...war,
        losses: Object.fromEntries(
          [...war.aggressors, ...war.defenders].map((n) => [n, 0]),
        ),
        claims:
          scenario === undefined
            ? []
            : scenarioWarClaims(scenario, war.aggressors, war.defenders),
      })),
      claims,
      warMemory: {},
    },
  };
}
