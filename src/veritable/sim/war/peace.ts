import { NationId } from "../../data/schemas/common";
import {
  DiplomacyState,
  MilitaryState,
  NationState,
  PeaceOffer,
  PeaceTerms,
  War,
} from "../../data/schemas/save";
import { EconomyContext } from "../economy/context";
import { WorldPort } from "../VeritableSim";

// Peace (J3a). An offer carries terms imposed on its recipient: a ceasefire
// (status quo), a cession (the tiles the offerer holds stay with it, tagged
// contested and claimed by the loser), an annexation (every tile of the
// recipient, which goes into exile), reparations, a cap on divisions.
//
// The AI accepts when the cost of the terms is at most the war score of the
// offerer and it is exhausted or has been retreating for months. A peace
// ends the whole war.

export type PeaceEvent =
  | {
      type: "peace-offered" | "peace-refused" | "peace-signed";
      nation: NationId;
      war: string;
      offer: number;
    }
  | { type: "annexation"; nation: NationId; by: NationId };

function addYears(isoDate: string, years: number): string {
  return `${Number(isoDate.slice(0, 4)) + years}${isoDate.slice(4)}`;
}

// Cost of the terms for their recipient, in war score units.
export function offerCost(
  ctx: EconomyContext,
  war: War,
  military: MilitaryState,
  from: NationId,
  to: NationId,
  terms: PeaceTerms,
): number {
  const cfg = ctx.config.war;
  let cost = 0;
  if (terms.kind === "cession") {
    cost += (war.tilesTaken[from] ?? 0) * cfg.warScore.tileValue;
  } else if (terms.kind === "annexation") {
    cost += cfg.peace.annexationValue;
  }
  cost +=
    terms.reparationsPctGdp *
    100 *
    terms.reparationYears *
    cfg.peace.reparationsValue;
  if (terms.maxDivisions !== null) {
    const divisions = military.nations[to]?.divisions.length ?? 0;
    cost +=
      Math.max(0, divisions - terms.maxDivisions) *
      cfg.peace.demilitarizationValue;
  }
  return cost;
}

export function aiAccepts(
  ctx: EconomyContext,
  war: War,
  military: MilitaryState,
  from: NationId,
  to: NationId,
  terms: PeaceTerms,
): boolean {
  const cfg = ctx.config.war.peace;
  const me = military.nations[to];
  if (me === undefined) return false;
  const affordable =
    offerCost(ctx, war, military, from, to, terms) <= (war.score[from] ?? 0);
  const weary =
    me.exhaustion > cfg.exhaustionToAccept ||
    (war.retreatMonths[to] ?? 0) >= cfg.retreatMonthsToAccept;
  return affordable && weary;
}

export function proposePeace(
  diplomacy: DiplomacyState,
  war: War,
  from: NationId,
  to: NationId,
  terms: PeaceTerms,
  date: string,
): PeaceOffer {
  const offer: PeaceOffer = {
    id: diplomacy.nextOfferId,
    war: war.id,
    from,
    to,
    terms,
    date,
  };
  diplomacy.nextOfferId += 1;
  war.offers.push(offer);
  return offer;
}

export function findOffer(
  diplomacy: DiplomacyState,
  id: number,
): { war: War; offer: PeaceOffer } | undefined {
  for (const war of diplomacy.wars) {
    const offer = war.offers.find((o) => o.id === id);
    if (offer !== undefined) return { war, offer };
  }
  return undefined;
}

export function refuseOffer(war: War, offer: PeaceOffer): PeaceEvent {
  war.offers.splice(war.offers.indexOf(offer), 1);
  return {
    type: "peace-refused",
    nation: offer.to,
    war: war.id,
    offer: offer.id,
  };
}

// Applies the terms and ends the war.
export function signPeace(
  ctx: EconomyContext,
  world: WorldPort,
  diplomacy: DiplomacyState,
  military: MilitaryState,
  nations: readonly NationState[],
  war: War,
  offer: PeaceOffer,
  date: string,
): PeaceEvent[] {
  const events: PeaceEvent[] = [];
  const { from, to, terms } = offer;
  if (terms.kind === "cession" && (war.tilesTaken[from] ?? 0) > 0) {
    diplomacy.contestedRegions.push({
      region: `${war.id}-cession`,
      controller: from,
      claimants: [to],
      tiles: war.tilesTaken[from],
    });
  }
  if (terms.kind === "annexation") {
    const moved = world.transferAll(to, from);
    diplomacy.contestedRegions.push({
      region: `${war.id}-annexation`,
      controller: from,
      claimants: [to],
      tiles: moved,
    });
    const loser = military.nations[to];
    if (loser !== undefined) {
      for (const division of loser.divisions) {
        division.front = null;
        division.segment = null;
      }
    }
    events.push({ type: "annexation", nation: to, by: from });
  }
  if (terms.reparationsPctGdp > 0 && terms.reparationYears > 0) {
    diplomacy.reparations.push({
      from: to,
      to: from,
      pctGdp: terms.reparationsPctGdp,
      until: addYears(date, terms.reparationYears),
    });
  }
  if (terms.maxDivisions !== null) {
    const list = diplomacy.demilitarized.filter((d) => d.nation !== to);
    list.push({ nation: to, maxDivisions: terms.maxDivisions });
    diplomacy.demilitarized = list;
    const loser = military.nations[to];
    if (loser !== undefined) {
      while (loser.divisions.length > terms.maxDivisions) {
        const division = loser.divisions.pop()!;
        loser.manpower += division.men;
      }
    }
  }
  // The war is over for everyone in it.
  diplomacy.wars.splice(diplomacy.wars.indexOf(war), 1);
  diplomacy.coalitionCalls = diplomacy.coalitionCalls.filter(
    (c) => c.war !== war.id,
  );
  for (const n of nations) {
    void n;
  }
  events.push({
    type: "peace-signed",
    nation: to,
    war: war.id,
    offer: offer.id,
  });
  return events;
}
