import { Bloc } from "../../data/schemas/bloc";
import { NationId } from "../../data/schemas/common";
import { VeritableConfig } from "../../data/schemas/config";
import { Good, GoodId } from "../../data/schemas/goods";
import { Law } from "../../data/schemas/laws";
import { LeadersData } from "../../data/schemas/leaders";
import { NationData } from "../../data/schemas/nation";
import { NamePool, Objective, RegimeData } from "../../data/schemas/politics";
import { ROW_ID, RowData } from "../../data/schemas/row";
import { SeaZone } from "../../data/schemas/seas";
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
  seas: SeaZone[];
  geography: {
    landNeighbours: [NationId, NationId][];
    bordersNeutralLand: NationId[];
  };
  // The political engine (J4): regimes, laws, objectives, and per nation
  // its actors and parties of the first day and its name pool.
  regimes: RegimeData[];
  laws: Law[];
  objectives: Objective[];
  leaders: Record<NationId, LeadersData>;
  names: Record<NationId, NamePool>;
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
  seas: SeaZone[];
  regimes: RegimeData[];
  regime(id: string): RegimeData;
  laws: Law[];
  law(id: string): Law;
  objectives: Objective[];
  leaders(id: NationId): LeadersData | undefined;
  names(id: NationId): NamePool | undefined;
  nationIds: NationId[];
  sheet(id: NationId): NationData;
  // True when the two share a land border on the map (trade by land; the
  // rest is by sea and subject to blockades).
  landNeighbours(a: string, b: string): boolean;
  // Weight of b among the trade partners of a: distance decay x GDP of b
  // (the rest of the world included, with its own GDP and distance).
  partnerWeight(a: string, b: string): number;
  // Affinity of a trade pair for a good, embargoes excluded: distance decay,
  // land adjacency for electricity, bloc and agreement bonuses. 0 = no trade.
  affinity(good: Good, exporter: string, importer: string): number;
  // Bloc suspensions in force ("bloc|nation"), synced from the political
  // state: a suspended member gets no bloc bonus and no alignment (J4).
  suspensions: Set<string>;
  isFullMember(bloc: Bloc, nation: string): boolean;
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
      id: b.id,
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

  const gdpOf = new Map(nations.map((n) => [n.id, n.gdp.value]));
  const byTemplate = new Map<string, DivisionTemplate>(
    data.divisions.map((d) => [d.id, d]),
  );
  const sheets = new Map(nations.map((n) => [n.id, n]));
  const suspensions = new Set<string>();
  const byRegime = new Map(data.regimes.map((r) => [r.id, r]));
  const byLaw = new Map(data.laws.map((l) => [l.id, l]));

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
    seas: data.seas,
    regimes: data.regimes,
    regime: (id) => {
      const regime = byRegime.get(id as RegimeData["id"]);
      if (regime === undefined) throw new Error(`unknown regime ${id}`);
      return regime;
    },
    laws: data.laws,
    law: (id) => {
      const law = byLaw.get(id);
      if (law === undefined) throw new Error(`unknown law ${id}`);
      return law;
    },
    objectives: data.objectives,
    leaders: (id) => data.leaders[id],
    names: (id) => data.names[id],
    nationIds: nations.map((n) => n.id),
    landNeighbours: (a, b) => neighbours.has(`${a}|${b}`),
    partnerWeight: (a, b) => {
      if (a === b) return 0;
      const gdp = b === ROW_ID ? data.row.gdp.value : gdpOf.get(b);
      if (gdp === undefined) return 0;
      return Math.exp(-distanceKm(a, b) / config.economy.distanceScaleKm) * gdp;
    },
    sheet: (id) => {
      const sheet = sheets.get(id);
      if (sheet === undefined) throw new Error(`no nation sheet for ${id}`);
      return sheet;
    },
    suspensions,
    isFullMember: (bloc, nation) =>
      bloc.members.some((m) => m.nation === nation && m.status === "full") &&
      !suspensions.has(`${bloc.id}|${nation}`),
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
        if (
          bloc.members.has(exporter) &&
          bloc.members.has(importer) &&
          !suspensions.has(`${bloc.id}|${exporter}`) &&
          !suspensions.has(`${bloc.id}|${importer}`)
        ) {
          value *= bloc.bonus;
        }
      }
      // Trade agreements (agreementBonus) arrive with diplomacy (J3a).
      return value;
    },
  };
}
