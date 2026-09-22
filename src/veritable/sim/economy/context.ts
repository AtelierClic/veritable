import { Bloc } from "../../data/schemas/bloc";
import { NationId } from "../../data/schemas/common";
import { VeritableConfig } from "../../data/schemas/config";
import { Good, GoodId } from "../../data/schemas/goods";
import { NationData } from "../../data/schemas/nation";
import { ROW_ID, RowData } from "../../data/schemas/row";
import { CasusBelli, DivisionTemplate } from "../../data/schemas/war";
import { greatCircleKm } from "./trade";

// Static data of a campaign, injected into the simulation (never imported by
// it): goods, rest of the world, blocs and the geography read off the borders.
export interface SimData {
  goods: Good[];
  row: RowData;
  blocs: Bloc[];
  divisions: DivisionTemplate[];
  casusBelli: CasusBelli[];
  geography: {
    landNeighbours: [NationId, NationId][];
    bordersNeutralLand: NationId[];
  };
}

// Everything the economic systems need besides the state.
export interface EconomyContext {
  config: VeritableConfig;
  goods: Good[];
  good(id: GoodId): Good;
  blocs: Bloc[];
  divisions: DivisionTemplate[];
  template(id: string): DivisionTemplate;
  casusBelli: CasusBelli[];
  nationIds: NationId[];
  sheet(id: NationId): NationData;
  // Affinity of a trade pair for a good, embargoes excluded: distance decay,
  // land adjacency for electricity, bloc and agreement bonuses. 0 = no trade.
  affinity(good: Good, exporter: string, importer: string): number;
}

export function buildContext(
  config: VeritableConfig,
  data: SimData,
  nations: readonly NationData[],
): EconomyContext {
  const byGood = new Map(data.goods.map((g) => [g.id, g]));
  const capitals = new Map(nations.map((n) => [n.id, n.capital]));
  const neighbours = new Set<string>();
  for (const [a, b] of data.geography.landNeighbours) {
    neighbours.add(`${a}|${b}`);
    neighbours.add(`${b}|${a}`);
  }
  for (const id of data.geography.bordersNeutralLand) {
    neighbours.add(`${id}|${ROW_ID}`);
    neighbours.add(`${ROW_ID}|${id}`);
  }
  const fullMembers = data.blocs
    .filter((b) => b.tradeBonus !== undefined)
    .map((b) => ({
      bonus: b.tradeBonus!,
      members: new Set(
        b.members.filter((m) => m.status === "full").map((m) => m.nation),
      ),
    }));

  const distanceKm = (a: string, b: string): number => {
    if (a === ROW_ID || b === ROW_ID) return config.economy.rowDistanceKm;
    const ca = capitals.get(a)!;
    const cb = capitals.get(b)!;
    return greatCircleKm(ca.lon, ca.lat, cb.lon, cb.lat);
  };
  const decay = new Map<string, number>();

  const byTemplate = new Map<string, DivisionTemplate>(
    data.divisions.map((d) => [d.id, d]),
  );
  const sheets = new Map(nations.map((n) => [n.id, n]));

  return {
    config,
    goods: data.goods,
    good: (id) => {
      const good = byGood.get(id);
      if (good === undefined) throw new Error(`unknown good ${id}`);
      return good;
    },
    blocs: data.blocs,
    divisions: data.divisions,
    template: (id) => {
      const template = byTemplate.get(id);
      if (template === undefined) throw new Error(`unknown division ${id}`);
      return template;
    },
    casusBelli: data.casusBelli,
    nationIds: nations.map((n) => n.id),
    sheet: (id) => {
      const sheet = sheets.get(id);
      if (sheet === undefined) throw new Error(`no nation sheet for ${id}`);
      return sheet;
    },
    affinity(good, exporter, importer) {
      if (exporter === importer) return 0;
      if (
        good.transport === "neighbors-only" &&
        !neighbours.has(`${exporter}|${importer}`)
      ) {
        return 0;
      }
      let value = 1;
      if (good.transport !== "free") {
        const key = `${exporter}|${importer}`;
        let d = decay.get(key);
        if (d === undefined) {
          d = Math.exp(
            -distanceKm(exporter, importer) / config.economy.distanceScaleKm,
          );
          decay.set(key, d);
        }
        value *= d;
      }
      for (const bloc of fullMembers) {
        if (bloc.members.has(exporter) && bloc.members.has(importer)) {
          value *= bloc.bonus;
        }
      }
      // Trade agreements (agreementBonus) arrive with diplomacy (J3a).
      return value;
    },
  };
}
