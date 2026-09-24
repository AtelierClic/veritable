import { INTEREST_GROUPS, NationId } from "../../data/schemas/common";
import { NationData } from "../../data/schemas/nation";
import {
  NationEconomy,
  NationMilitary,
  NationPolitics,
} from "../../data/schemas/save";
import { EconomyContext } from "../economy/context";
import { Rng } from "../rng";
import { formGovernment, groupSatisfaction } from "./elections";
import { clamp01 } from "./ideology";
import { changeRegime, lawModifiers, scheduleRepeals } from "./laws";
import { generateActor, nameOf } from "./leaders";
import { addMonths } from "./state";

// Coups and revolutions (J4), once a month.
//
// Coup (J5 formula): p = coupBase x 4 x (1 - s_military)^2
//         x (1 + 2 x (1 - stability)) x (1 - legitimacy) x (1 + exhaustion),
//         doubled for a year after a detected fraud, times the laws in force;
//         none in the twelve months after a regime change of the campaign.
//         Success: junta, a military chief in power, legitimacy reset,
//         relations with the democracies hit, suspension by the blocs with a
//         democratic criterion.
// Revolution: three groups under a threshold and (shortage above a threshold
//         or stability under one for six months): p per month. Provisional
//         government, elections in six months, legitimacy reset, GDP and
//         stability hit. The player goes on in every case: it is the state.

export type CoupEvent =
  | { type: "coup-attempted"; nation: NationId }
  | { type: "coup-succeeded"; nation: NationId; leader: string }
  | { type: "revolution"; nation: NationId; leader: string }
  | { type: "regime-changed"; nation: NationId; from: string; to: string }
  | { type: "civilian-transition"; nation: NationId; to: string }
  | { type: "law-repeal-announced"; nation: NationId; law: string; at: string };

export function monthsSince(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export interface CoupOutcome {
  events: CoupEvent[];
  democracyRelations: number;
  suspendFromBlocs: boolean;
}

export function coupProbability(
  ctx: EconomyContext,
  politics: NationPolitics,
  military: NationMilitary | undefined,
  date: string,
): number {
  const cfg = ctx.config.politics.coups;
  const regime = ctx.regime(politics.regime);
  const satisfaction = groupSatisfaction(politics);
  let p =
    regime.coupBase *
    cfg.militaryScale *
    Math.pow(1 - satisfaction.military, cfg.militaryExponent) *
    (1 + cfg.stabilityWeight * (1 - politics.stability)) *
    (1 - politics.legitimacy) *
    (1 + (military?.exhaustion ?? 0));
  if (politics.fraudCoupUntil !== null && date < politics.fraudCoupUntil) {
    p *= ctx.config.politics.elections.fraudCoupMultiplier;
  }
  p *= lawModifiers(ctx, politics).coupRisk;
  return Math.min(1, p);
}

export function stepCoups(
  ctx: EconomyContext,
  rng: Rng,
  nation: NationId,
  politics: NationPolitics,
  military: NationMilitary | undefined,
  date: string,
): CoupOutcome {
  const cfg = ctx.config.politics.coups;
  const out: CoupOutcome = {
    events: [],
    democracyRelations: 0,
    suspendFromBlocs: false,
  };
  politics.coupRisk = coupProbability(ctx, politics, military, date);
  if (politics.fraudCoupUntil !== null && date >= politics.fraudCoupUntil) {
    politics.fraudCoupUntil = null;
  }
  // A regime born in the campaign consolidates: no attempt for a while.
  if (
    politics.regimeBefore !== null &&
    monthsSince(politics.regimeSince, date) < cfg.consolidationMonths
  ) {
    politics.coupRisk = 0;
    return out;
  }
  if (rng.next() >= politics.coupRisk) return out;
  if (rng.next() < cfg.failureShare) {
    out.events.push({ type: "coup-attempted", nation });
    politics.stability = clamp01(politics.stability - cfg.failedStabilityHit);
    if (politics.groups !== null) {
      politics.groups.military = clamp01(
        politics.groups.military - cfg.failedMilitaryHit,
      );
    }
    return out;
  }
  const from = politics.regime;
  const junta = ctx.regime("junta");
  const chief = generateActor(
    ctx,
    rng,
    nation,
    "military-chief",
    null,
    { economic: 0.2, authority: 0.8, sovereignty: 0.6 },
    junta,
    date,
    `${nation.toLowerCase()}-junta-${date}`,
  );
  politics.leader = chief;
  politics.corruption = chief.traits.corruption;
  politics.government = {
    parties: [],
    since: date,
    ideology: {
      economic: chief.traits.economic,
      authority: chief.traits.authority,
      sovereignty: chief.traits.sovereignty,
    },
  };
  changeRegime(ctx, politics, "junta", date);
  politics.legitimacy = ctx.config.politics.legitimacy.coupValue;
  politics.capital = ctx.config.politics.elections.newGovernmentCapital;
  politics.coups += 1;
  politics.levers = { propagandaPctGdp: 0, fraud: 0, clientelism: null };
  out.democracyRelations = cfg.democracyRelationsHit;
  out.suspendFromBlocs = true;
  out.events.push({ type: "coup-succeeded", nation, leader: nameOf(chief) });
  out.events.push({ type: "regime-changed", nation, from, to: "junta" });
  for (const law of scheduleRepeals(ctx, politics, date)) {
    out.events.push({
      type: "law-repeal-announced",
      nation,
      law: law.id,
      at: law.at,
    });
  }
  return out;
}

export function revolutionDue(
  ctx: EconomyContext,
  politics: NationPolitics,
  economy: NationEconomy,
): boolean {
  const cfg = ctx.config.politics.revolution;
  const satisfaction = groupSatisfaction(politics);
  const angry = INTEREST_GROUPS.filter(
    (g) => satisfaction[g] < cfg.angryBelow,
  ).length;
  if (angry < cfg.angryGroups) return false;
  return (
    economy.shortage > cfg.shortageAbove ||
    politics.lowStabilityMonths >= cfg.lowStabilityMonths
  );
}

export function stepRevolution(
  ctx: EconomyContext,
  rng: Rng,
  nation: NationId,
  politics: NationPolitics,
  economy: NationEconomy,
  sheet: NationData | undefined,
  date: string,
): CoupEvent[] {
  const cfg = ctx.config.politics.revolution;
  politics.lowStabilityMonths =
    politics.stability < cfg.stabilityBelow
      ? politics.lowStabilityMonths + 1
      : 0;
  if (!revolutionDue(ctx, politics, economy)) return [];
  if (rng.next() >= cfg.monthlyProbability) return [];

  const events: CoupEvent[] = [];
  const from = politics.regime;
  const regime = ctx.regime(politics.regime);
  const to = regime.democratic ? politics.regime : "parliamentary";
  if (to !== from) {
    changeRegime(ctx, politics, to, date);
    events.push({ type: "regime-changed", nation, from, to });
  }
  // A provisional government led by the strongest party outside the old
  // one, or a generated figure when there is none.
  const outside = politics.parties
    .filter((p) => !politics.government.parties.includes(p.id))
    .sort((a, b) => b.support - a.support);
  const newRegime = ctx.regime(politics.regime);
  const leadParty = outside[0] ?? politics.parties[0];
  const leader =
    outside.length > 0
      ? leadParty.leader
      : generateActor(
          ctx,
          rng,
          nation,
          "head-of-government",
          null,
          { economic: 0, authority: -0.3, sovereignty: 0 },
          newRegime,
          date,
          `${nation.toLowerCase()}-provisional-${date}`,
        );
  politics.leader = leader;
  politics.corruption = leader.traits.corruption;
  const government = formGovernment(
    ctx,
    newRegime,
    politics.parties,
    leadParty.id,
  );
  politics.government = { ...government, since: date };
  politics.legitimacy = ctx.config.politics.legitimacy.revolutionValue;
  politics.capital = ctx.config.politics.elections.newGovernmentCapital;
  politics.nextElection =
    newRegime.electionIntervalMonths === null
      ? null
      : addMonths(date, cfg.electionDelayMonths);
  politics.electionsSuspended = false;
  economy.gdp *= 1 - cfg.gdpHit;
  politics.stability = clamp01(politics.stability - cfg.stabilityHit);
  if (politics.groups !== null) {
    for (const g of INTEREST_GROUPS) politics.groups[g] = 0.5;
  } else politics.opinion = 0.5;
  politics.lowStabilityMonths = 0;
  politics.revolutions += 1;
  politics.levers = { propagandaPctGdp: 0, fraud: 0, clientelism: null };
  void sheet;
  events.push({ type: "revolution", nation, leader: nameOf(leader) });
  for (const law of scheduleRepeals(ctx, politics, date)) {
    events.push({
      type: "law-repeal-announced",
      nation,
      law: law.id,
      at: law.at,
    });
  }
  return events;
}

// A junta old enough hands power back to civilians: the regime before the
// coup when it was democratic, a parliamentary one otherwise; elections in
// six months, led by the strongest party.
export function stepJuntaTransition(
  ctx: EconomyContext,
  rng: Rng,
  nation: NationId,
  politics: NationPolitics,
  date: string,
): CoupEvent[] {
  const cfg = ctx.config.politics.coups;
  if (politics.regime !== "junta") return [];
  if (monthsSince(politics.regimeSince, date) < cfg.juntaTransitionMonths) {
    return [];
  }
  if (rng.next() >= cfg.juntaTransitionMonthlyProbability) return [];
  const before = politics.regimeBefore;
  const to =
    before !== null && before !== "junta" && ctx.regime(before).democratic
      ? before
      : "parliamentary";
  changeRegime(ctx, politics, to, date);
  const regime = ctx.regime(to);
  const lead = [...politics.parties].sort((a, b) => b.support - a.support)[0];
  const leader =
    lead?.leader ??
    generateActor(
      ctx,
      rng,
      nation,
      "head-of-government",
      null,
      { economic: 0, authority: -0.2, sovereignty: 0 },
      regime,
      date,
      `${nation.toLowerCase()}-transition-${date}`,
    );
  politics.leader = leader;
  politics.corruption = leader.traits.corruption;
  politics.government = {
    ...formGovernment(ctx, regime, politics.parties, lead?.id ?? ""),
    since: date,
  };
  politics.legitimacy = ctx.config.politics.legitimacy.revolutionValue;
  politics.capital = ctx.config.politics.elections.newGovernmentCapital;
  politics.nextElection =
    regime.electionIntervalMonths === null
      ? null
      : addMonths(date, ctx.config.politics.revolution.electionDelayMonths);
  politics.electionsSuspended = false;
  const events: CoupEvent[] = [
    { type: "civilian-transition", nation, to },
    { type: "regime-changed", nation, from: "junta", to },
  ];
  for (const law of scheduleRepeals(ctx, politics, date)) {
    events.push({
      type: "law-repeal-announced",
      nation,
      law: law.id,
      at: law.at,
    });
  }
  return events;
}
