import { Bloc, BlocMemberStatus } from "../../data/schemas/bloc";
import { NationId } from "../../data/schemas/common";
import { VeritableConfig } from "../../data/schemas/config";
import { VeritableEvent } from "../../data/schemas/event";
import { Good, GoodId } from "../../data/schemas/goods";
import { Law } from "../../data/schemas/laws";
import { LeadersData } from "../../data/schemas/leaders";
import { NationData } from "../../data/schemas/nation";
import { NamePool, Objective, RegimeData } from "../../data/schemas/politics";
import { ROW_ID, RowData } from "../../data/schemas/row";
import { SeaZone } from "../../data/schemas/seas";
import { TechNode } from "../../data/schemas/tech";
import { CasusBelli, DivisionTemplate } from "../../data/schemas/war";
import type { TechModifiers } from "../tech/tech";
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
  // Technology and events (J5).
  tech: TechNode[];
  events: VeritableEvent[];
}

// Everything the economic systems need besides the state.
export interface EconomyContext {
  config: VeritableConfig;
  goods: Good[];
  good(id: GoodId): Good;
  // Technology (J5): the nodes, and the modifiers in force of each nation
  // (sim/tech, synced after each change).
  tech: TechNode[];
  techModifiers: Map<string, TechModifiers>;
  events: VeritableEvent[];
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
  // The sum of a nation's partner weights, the rest of the world included.
  partnerTotal(a: string): number;
  // Affinity of a trade pair for a good, embargoes excluded: distance decay,
  // land adjacency for electricity, bloc and agreement bonuses. 0 = no trade.
  affinity(good: Good, exporter: string, importer: string): number;
  // Bloc suspensions in force ("bloc|nation"), synced from the political
  // state: a suspended member gets no bloc bonus and no alignment (J4).
  suspensions: Set<string>;
  isFullMember(bloc: Bloc, nation: string): boolean;
  // Bloc memberships in play (J5): bloc id -> nation -> status, the lists of
  // the data until the bloc state syncs them (accessions, exits).
  memberships: Map<string, Map<string, BlocMemberStatus>>;
  // Full, unsuspended members of a bloc, simulated or not.
  membersOf(bloc: string): string[];
  // The blocs a nation is a full, unsuspended member of, plus the bloc labels
  // of its sheet for blocs without an entity.
  blocsOf(nation: string): string[];
  commonBlocs(a: string, b: string): number;
  // Trade agreements of the blocs (J5): "exporter|importer" -> multiplier.
  pairBonus: Map<string, number>;
  // Claims (J6): tiles of a region each nation holds, settled tiles excluded
  // (the world's WorldPort.claimHolders; empty for a context without world).
  claimHolders(region: string): ReadonlyMap<string, number>;
  // True when a rest of the world closes the market (europe-10); without one
  // (J6, the world), the world supply shocks hit every producer.
  hasRow: boolean;
  worldSupplyShock(good: string): number;
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
  const memberships = new Map<string, Map<string, BlocMemberStatus>>(
    data.blocs.map((b) => [
      b.id,
      new Map(b.members.map((m) => [m.nation, m.status])),
    ]),
  );
  const tradeBlocs = data.blocs.filter((b) => b.tradeBonus !== undefined);
  const entities = new Set(data.blocs.map((b) => b.id));

  const distanceKm = (a: string, b: string): number => {
    if (a === ROW_ID || b === ROW_ID) return config.economy.rowDistanceKm;
    const ca = capitals.get(a)!;
    const cb = capitals.get(b)!;
    return greatCircleKm(ca.lon, ca.lat, cb.lon, cb.lat);
  };
  const decay = new Map<string, number>();

  const gdpOf = new Map(nations.map((n) => [n.id, n.gdp.value]));
  // Partner weights are static (distances, first-day GDPs): computed once a
  // pair (J6: at 195 nations the bloc votes asked for millions a view).
  const weights = new Map<string, number>();
  const partnerWeight = (a: string, b: string): number => {
    if (a === b) return 0;
    const key = `${a}|${b}`;
    let w = weights.get(key);
    if (w === undefined) {
      const gdp = b === ROW_ID ? data.row.gdp.value : gdpOf.get(b);
      w =
        gdp === undefined
          ? 0
          : Math.exp(-distanceKm(a, b) / config.economy.distanceScaleKm) * gdp;
      weights.set(key, w);
    }
    return w;
  };
  const partnerTotals = new Map<string, number>();
  const byTemplate = new Map<string, DivisionTemplate>(
    data.divisions.map((d) => [d.id, d]),
  );
  const sheets = new Map(nations.map((n) => [n.id, n]));
  const suspensions = new Set<string>();
  const pairBonus = new Map<string, number>();
  const full = (bloc: string, nation: string) =>
    memberships.get(bloc)?.get(nation) === "full" &&
    !suspensions.has(`${bloc}|${nation}`);
  const blocsOf = (nation: string): string[] => {
    const out: string[] = [];
    for (const bloc of memberships.keys()) {
      if (full(bloc, nation)) out.push(bloc);
    }
    for (const label of sheets.get(nation)?.blocs ?? []) {
      if (!entities.has(label) && !out.includes(label)) out.push(label);
    }
    return out;
  };
  const byRegime = new Map(data.regimes.map((r) => [r.id, r]));
  const byLaw = new Map(data.laws.map((l) => [l.id, l]));

  return {
    config,
    goods: data.goods,
    tech: data.tech,
    techModifiers: new Map(),
    events: data.events,
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
    partnerWeight,
    partnerTotal: (a) => {
      let total = partnerTotals.get(a);
      if (total === undefined) {
        total = partnerWeight(a, ROW_ID);
        for (const n of nations) {
          if (n.id !== a) total += partnerWeight(a, n.id);
        }
        partnerTotals.set(a, total);
      }
      return total;
    },
    sheet: (id) => {
      const sheet = sheets.get(id);
      if (sheet === undefined) throw new Error(`no nation sheet for ${id}`);
      return sheet;
    },
    suspensions,
    isFullMember: (bloc, nation) => full(bloc.id, nation),
    memberships,
    pairBonus,
    claimHolders: () => new Map(),
    hasRow: data.row.gdp.value > 0,
    worldSupplyShock: () => 0,
    membersOf: (bloc) =>
      [...(memberships.get(bloc)?.keys() ?? [])].filter((n) => full(bloc, n)),
    blocsOf,
    commonBlocs: (a, b) => {
      const mine = blocsOf(a);
      return blocsOf(b).filter((x) => mine.includes(x)).length;
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
      for (const bloc of tradeBlocs) {
        if (full(bloc.id, exporter) && full(bloc.id, importer)) {
          value *= bloc.tradeBonus!;
        }
      }
      return value * (pairBonus.get(`${exporter}|${importer}`) ?? 1);
    },
  };
}
