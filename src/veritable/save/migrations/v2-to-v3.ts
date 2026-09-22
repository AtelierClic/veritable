import { SaveFileV3 } from "../../data/schemas/save";
import { SaveFileV2 } from "../../data/schemas/saveV2";

// v2 (J2) -> v3 (J3). Everything of the v2 is kept; the v3 adds:
//   - economy: value of the exports really sold and its reference share of
//     GDP (from the last month's exports at the world prices), import prices
//     (equal to the world prices: no premium until the next flows), and the
//     production the rest of the world really delivers (its capacity);
//   - politics: the counters of the revised bloc fiscal rule (the malus in
//     force is kept as it was: full when reprimanded, none otherwise).
// Nothing is recomputed from the sheets: a v2 campaign carries its economy.
//
// Fields are only added when absent: the v1 -> v2 step builds the economy
// with the current code, whose objects already carry them.
export function v2ToV3(save: SaveFileV2): SaveFileV3 {
  const { market } = save.economy;
  const malusOf = (id: string): number => {
    let malus = 0;
    for (const bloc of blocsWithRule(save)) {
      if (bloc.members.includes(id)) malus = Math.max(malus, bloc.malus);
    }
    return malus;
  };
  const economyNations = Object.fromEntries(
    Object.entries(save.economy.nations).map(([id, nation]) => {
      const extended = nation as Partial<SaveFileV3["economy"]["nations"][0]>;
      let exportsValue = extended.exportsValue;
      if (exportsValue === undefined) {
        exportsValue = 0;
        for (const [good, volume] of Object.entries(nation.exports)) {
          exportsValue += volume * market.prices[good] * 1e6;
        }
      }
      return [
        id,
        {
          ...nation,
          exportsValue,
          exportShareReference:
            extended.exportShareReference ?? exportsValue / nation.gdp,
        },
      ];
    }),
  );
  const extendedMarket = market as Partial<SaveFileV3["economy"]["market"]>;
  const politicsNations = Object.fromEntries(
    Object.entries(save.politics.nations).map(([id, nation]) => {
      const extended = nation as Partial<SaveFileV3["politics"]["nations"][0]>;
      return [
        id,
        {
          ...nation,
          deficitBreachMonths: extended.deficitBreachMonths ?? 0,
          reprimandMalus:
            extended.reprimandMalus ?? (nation.reprimanded ? malusOf(id) : 0),
        },
      ];
    }),
  );
  return {
    ...save,
    schemaVersion: 3,
    economy: {
      market: {
        ...market,
        importPrices: extendedMarket.importPrices ?? { ...market.prices },
        rowEffectiveProduction: extendedMarket.rowEffectiveProduction ?? {
          ...market.rowProduction,
        },
      },
      nations: economyNations,
    },
    politics: { ...save.politics, nations: politicsNations },
  };
}

// The v2 save does not carry the bloc rules (they are data, not state): the
// malus of a reprimand in force is the one of the J2, a constant.
const J2_EU_OPINION_MALUS = 0.03;
const J2_EU_FULL_MEMBERS = ["FRA", "DEU", "ITA", "ESP", "POL"];
function blocsWithRule(
  save: SaveFileV2,
): { members: string[]; malus: number }[] {
  const ids = new Set(save.nations.map((n) => n.id));
  const members = J2_EU_FULL_MEMBERS.filter((id) => ids.has(id));
  return members.length > 0 ? [{ members, malus: J2_EU_OPINION_MALUS }] : [];
}
