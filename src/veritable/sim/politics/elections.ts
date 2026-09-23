import { INTEREST_GROUPS, NationId } from "../../data/schemas/common";
import { NationData } from "../../data/schemas/nation";
import { Ideology, RegimeData } from "../../data/schemas/politics";
import { NationPolitics, PartyState } from "../../data/schemas/save";
import { EconomyContext } from "../economy/context";
import { Rng } from "../rng";
import { affinity, ideologyDistance, meanIdeology } from "./ideology";
import { lawModifiers, scheduleRepeals } from "./laws";
import { nameOf } from "./leaders";
import { addMonths } from "./state";

// Elections (J4).
//
// Affinity of group k for party j: a = exp(-d^2 / sigma^2) x (1 + charisma_j).
// Vote of k for j is proportional to a x (incumbent ? base + s_k : 1): an
// unhappy group drops the incumbent. National share = sum of w_k x share_kj.
// Levers of the player: propaganda (+weight x % of GDP to the incumbent),
// media control (x bonus), fraud (shares moved to the incumbent, detected
// with a probability that grows with the fraud, the freedom of the press and
// the absence of media control), clientelism (monthly satisfaction of a
// group, see the month step). Government: coalition by ideological
// proximity up to a majority, or the leading party; the new leader is the
// chief of the leading party.

export type ElectionEvent =
  | {
      type: "election-held";
      nation: NationId;
      winner: string; // party id
      share: number;
      alternation: boolean;
    }
  | {
      type: "government-formed";
      nation: NationId;
      parties: string[];
      leader: string;
    }
  | { type: "fraud-detected"; nation: NationId; fraud: number }
  | { type: "elections-suspended"; nation: NationId; until: string }
  | { type: "law-repeal-announced"; nation: NationId; law: string; at: string };

export interface Government {
  parties: string[];
  ideology: Ideology;
}

// Satisfaction of each group: the groups of the player, the proxy opinion
// for everyone else.
export function groupSatisfaction(
  politics: NationPolitics,
): Record<string, number> {
  if (politics.groups !== null) return politics.groups;
  return Object.fromEntries(INTEREST_GROUPS.map((g) => [g, politics.opinion]));
}

export function groupWeights(
  ctx: EconomyContext,
  sheet: NationData | undefined,
): Record<string, number> {
  return sheet?.interestGroups ?? ctx.config.politics.groupWeights;
}

// Shares of every party, levers applied, normalised to the total support of
// the parties in play (the small parties outside the data are ignored).
export function projectShares(
  ctx: EconomyContext,
  politics: NationPolitics,
  sheet: NationData | undefined,
): Record<string, number> {
  const cfg = ctx.config.politics.elections;
  const satisfaction = groupSatisfaction(politics);
  const weights = groupWeights(ctx, sheet);
  const incumbents = new Set(politics.government.parties);
  const shares: Record<string, number> = Object.fromEntries(
    politics.parties.map((p) => [p.id, 0]),
  );
  let totalWeight = 0;
  for (const group of INTEREST_GROUPS) {
    const w = weights[group];
    totalWeight += w;
    const ideology = politics.groupIdeologies[group];
    const votes = politics.parties.map((p) => {
      let v = affinity(
        ideology,
        p.ideology,
        p.leader.traits.charisma,
        cfg.sigma,
      );
      if (incumbents.has(p.id)) v *= cfg.incumbentBase + satisfaction[group];
      return v;
    });
    const sum = votes.reduce((a, b) => a + b, 0);
    if (sum <= 0) continue;
    politics.parties.forEach((p, i) => {
      shares[p.id] += (w * votes[i]) / sum;
    });
  }
  for (const id of Object.keys(shares)) shares[id] /= totalWeight || 1;

  // Levers, all to the benefit of the incumbent parties, pro rata.
  const incumbentShare = () =>
    politics.parties
      .filter((p) => incumbents.has(p.id))
      .reduce((s, p) => s + shares[p.id], 0);
  const boost = (delta: number) => {
    const before = incumbentShare();
    if (before <= 0 || delta <= 0) return;
    const after = Math.min(1, before + delta);
    const others = 1 - before;
    for (const p of politics.parties) {
      shares[p.id] = incumbents.has(p.id)
        ? (shares[p.id] * after) / before
        : others <= 0
          ? 0
          : (shares[p.id] * (1 - after)) / others;
    }
  };
  boost(cfg.propagandaWeight * politics.levers.propagandaPctGdp);
  if (politics.mediaControl > 0) {
    const before = incumbentShare();
    const factor =
      1 +
      (cfg.mediaControlBonus - 1) * Math.min(1, politics.mediaControl / 0.5);
    boost(before * (factor - 1));
  }
  boost(politics.levers.fraud);
  return shares;
}

// The government after an election: the leading party alone, or a
// coalition by ideological proximity up to a majority of the shares in play.
export function formGovernment(
  ctx: EconomyContext,
  regime: RegimeData,
  parties: readonly PartyState[],
  leading: string,
): Government {
  const lead = parties.find((p) => p.id === leading) ?? parties[0];
  const members: PartyState[] = [lead];
  if (regime.government === "coalition") {
    const total = parties.reduce((s, p) => s + p.support, 0);
    const majority = ctx.config.politics.elections.coalitionMajority * total;
    const rest = parties
      .filter((p) => p.id !== lead.id)
      .sort(
        (a, b) =>
          ideologyDistance(lead.ideology, a.ideology) -
          ideologyDistance(lead.ideology, b.ideology),
      );
    let sum = lead.support;
    for (const p of rest) {
      if (sum > majority) break;
      members.push(p);
      sum += p.support;
    }
  }
  return {
    parties: members.map((p) => p.id),
    ideology: meanIdeology(
      members.map((p) => ({ ideology: p.ideology, weight: p.support })),
    ),
  };
}

export interface ElectionOutcome {
  events: ElectionEvent[];
  democracyRelations: number; // delta with the democracies (fraud detected)
}

export function holdElection(
  ctx: EconomyContext,
  rng: Rng,
  nation: NationId,
  politics: NationPolitics,
  sheet: NationData | undefined,
  date: string,
): ElectionOutcome {
  const cfg = ctx.config.politics.elections;
  const regime = ctx.regime(politics.regime);
  const events: ElectionEvent[] = [];
  let democracyRelations = 0;
  const shares = projectShares(ctx, politics, sheet);
  const previousLeading = politics.government.parties[0];
  const incumbents = new Set(politics.government.parties);
  const incumbentShare = politics.parties
    .filter((p) => incumbents.has(p.id))
    .reduce((s, p) => s + shares[p.id], 0);

  // Fraud: detected with p = scale x fraud x (1 - media control) x press.
  let fraudDetected = false;
  if (politics.levers.fraud > 0) {
    const p = Math.min(
      1,
      cfg.fraudDetectionScale *
        politics.levers.fraud *
        (1 - politics.mediaControl) *
        politics.pressFreedom,
    );
    if (rng.next() < p) {
      fraudDetected = true;
      politics.legitimacy = Math.max(
        0,
        politics.legitimacy - cfg.fraudLegitimacyHit,
      );
      politics.stability = Math.max(
        0,
        politics.stability - cfg.fraudStabilityHit,
      );
      politics.fraudCoupUntil = addMonths(date, cfg.fraudCoupMonths);
      democracyRelations += cfg.fraudDemocracyRelations;
      events.push({
        type: "fraud-detected",
        nation,
        fraud: politics.levers.fraud,
      });
    }
  }

  // Results.
  let winner = politics.parties[0];
  for (const p of politics.parties) {
    p.support = shares[p.id];
    if (shares[p.id] > shares[winner.id]) winner = p;
  }
  const alternation = winner.id !== previousLeading;
  events.push({
    type: "election-held",
    nation,
    winner: winner.id,
    share: shares[winner.id],
    alternation,
  });
  politics.lastElection = {
    date,
    results: { ...shares },
    incumbentShare,
    alternation,
    fraudDetected,
  };
  politics.nextElection = addMonths(
    date,
    (sheet?.politics.electionIntervalMonths ??
      regime.electionIntervalMonths ??
      48) + lawModifiers(ctx, politics).electionIntervalMonths,
  );

  // Government, leader, capital.
  const government = formGovernment(ctx, regime, politics.parties, winner.id);
  politics.government = { ...government, since: date };
  politics.leader = winner.leader;
  politics.corruption = winner.leader.traits.corruption;
  if (alternation) {
    politics.alternations += 1;
    politics.capital = cfg.newGovernmentCapital;
  } else {
    politics.electionsWon += 1;
    politics.capital = Math.min(
      ctx.config.politics.capital.max,
      politics.capital + cfg.victoryCapital,
    );
  }
  events.push({
    type: "government-formed",
    nation,
    parties: government.parties,
    leader: nameOf(politics.leader),
  });
  // The new government repeals, in time, the laws outside its window.
  for (const law of scheduleRepeals(ctx, politics, date)) {
    events.push({
      type: "law-repeal-announced",
      nation,
      law: law.id,
      at: law.at,
    });
  }
  // Levers are one-shot: they are spent on this election.
  politics.levers.fraud = 0;
  return { events, democracyRelations };
}
