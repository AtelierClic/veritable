import {
  Bloc,
  BlocDomain,
  BlocMemberStatus,
  DecisionRule,
} from "../../data/schemas/bloc";
import { NationId } from "../../data/schemas/common";
import { NationData } from "../../data/schemas/nation";
import { ROW_ID } from "../../data/schemas/row";
import {
  BlocMeasure,
  BlocProposal,
  BlocsState,
  BlocState,
  BlocVote,
  DiplomacyState,
  EconomyState,
  MilitaryState,
  PoliticsState,
} from "../../data/schemas/save";
import {
  addRelation,
  DiplomacyEvent,
  imposeSanctions,
  isSanctioning,
  joinWar,
  liftSanctions,
  relation,
  warSide,
} from "../diplomacy/diplomacy";
import { EconomyContext } from "../economy/context";
import { ideologyDistance, MAX_IDEOLOGY_DISTANCE } from "../politics/ideology";
import { addMonths } from "../politics/state";
import { Rng } from "../rng";
import { militaryPower } from "../war/military";

// Blocs, layers 2 and 3 (J5). A bloc is an actor: its members (every
// nation of the world in the data; in a scenario only the simulated ones
// vote and pay, an artifact of europe-10 lifted at the J6), a leader
// (rotating presidency, de facto hegemon), a budget that flows into the
// national budgets, accession and exit, collective defence, and the
// measures its leader proposes, at most one a month, voted by the members
// under the decision rule of their domain.
//
// Once a game month (blocs clock), in this order: the leaders, the proposals
// due, the accession processes, the exits, collective defence, the budget,
// the applications and the proposals of the AI leaders.

export const MEASURE_DOMAIN: Record<BlocMeasure, BlocDomain> = {
  sanctions: "sanctions",
  lift: "lift",
  accession: "accession",
  suspension: "suspension",
  budget: "budget",
  "common-defense": "defense",
  "tech-program": "tech",
  "trade-agreement": "trade",
};

export interface BlocEnv {
  ctx: EconomyContext;
  rng: Rng;
  state: BlocsState;
  diplomacy: DiplomacyState;
  economy: EconomyState;
  politics: PoliticsState;
  military: MilitaryState;
  sheets: ReadonlyMap<NationId, NationData>;
  // Nations run by the AI rules; the others (the player) vote and answer
  // the calls themselves.
  aiNations: readonly NationId[];
  date: string;
}

export type BlocEventKind =
  | "bloc-proposal"
  | "bloc-decision"
  | "bloc-presidency"
  | "bloc-application"
  | "bloc-accession-opened"
  | "bloc-accession-frozen"
  | "bloc-joined"
  | "bloc-exit-notified"
  | "bloc-left"
  | "bloc-article5"
  | "bloc-article5-refused";
export interface BlocEngineEvent {
  type: BlocEventKind;
  nation: NationId;
  params: Record<string, string>;
}
export type BlocStepEvent = BlocEngineEvent | DiplomacyEvent;

// A measure as the rules see it, proposed or projected.
export interface Measure {
  bloc: string;
  by: NationId;
  kind: BlocMeasure;
  target: NationId | null;
  direction: "up" | "down" | null;
  cast?: Readonly<Record<NationId, BlocVote>>;
}

export interface Tally {
  votes: Record<NationId, BlocVote>;
  utilities: Record<NationId, number>;
  yes: number;
  no: number;
  abstain: number;
  adopted: boolean;
}

export interface AccessionCriteria {
  regime: boolean;
  debt: boolean;
  relations: boolean;
  meanRelations: number;
  ok: boolean;
}

// --- state ---------------------------------------------------------------------

export function initBlocs(ctx: EconomyContext): BlocsState {
  return {
    blocs: ctx.blocs.map((b) => ({
      id: b.id,
      members: b.members.map((m) => ({
        nation: m.nation,
        status: m.status,
        since: null,
      })),
      budgetScale: 1,
      sanctions: [],
      agreements: [],
      commonDefense: false,
      programs: [],
      accessions: [],
      applications: [],
      exits: [],
      lastProposal: null,
      contributions: {},
      received: {},
    })),
    proposals: [],
    nextProposal: 1,
    calls: [],
    handledWars: [],
    leaders: {},
    net: {},
  };
}

// The context follows the bloc state: memberships (trade bonus, common
// blocs, fiscal rule, alignment) and the trade agreements.
export function syncBlocs(ctx: EconomyContext, state: BlocsState): void {
  ctx.memberships.clear();
  for (const bloc of state.blocs) {
    ctx.memberships.set(
      bloc.id,
      new Map(bloc.members.map((m) => [m.nation, m.status])),
    );
  }
  ctx.pairBonus.clear();
  const bonus = ctx.config.blocs.agreementTradeBonus;
  for (const bloc of state.blocs) {
    for (const partner of bloc.agreements) {
      for (const member of ctx.membersOf(bloc.id)) {
        for (const key of [`${member}|${partner}`, `${partner}|${member}`]) {
          ctx.pairBonus.set(key, Math.max(ctx.pairBonus.get(key) ?? 1, bonus));
        }
      }
    }
  }
}

export function blocData(ctx: EconomyContext, id: string): Bloc {
  const bloc = ctx.blocs.find((b) => b.id === id);
  if (bloc === undefined) throw new Error(`unknown bloc ${id}`);
  return bloc;
}

export function blocState(state: BlocsState, id: string): BlocState {
  const bloc = state.blocs.find((b) => b.id === id);
  if (bloc === undefined) throw new Error(`unknown bloc ${id}`);
  return bloc;
}

export function memberStatus(
  bloc: BlocState,
  nation: NationId,
): BlocMemberStatus | null {
  return bloc.members.find((m) => m.nation === nation)?.status ?? null;
}

// Full, unsuspended members that the scenario simulates: the voters.
export function simulatedMembers(
  ctx: EconomyContext,
  bloc: string,
): NationId[] {
  return ctx.membersOf(bloc).filter((n) => ctx.nationIds.includes(n));
}

export function leaderOf(state: BlocsState, bloc: string): NationId | null {
  const leader = state.leaders[bloc];
  return leader === undefined || leader === "" ? null : leader;
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function firstOfNextMonth(date: string): string {
  return addMonths(`${date.slice(0, 7)}-01`, 1);
}

// The leader a bloc has this month. Rotating: the order of the data among
// the simulated members (europe-10: a compressed rotation, an artifact),
// new members at the end, terms counted from the rotation epoch. Hegemon:
// the largest military power among the simulated members; it keeps the
// lead while it stays within `hegemonMargin` of the largest. Elected: the
// largest economy.
export function computeLeader(
  env: Pick<BlocEnv, "ctx" | "state" | "military" | "economy">,
  id: string,
  date: string,
): NationId | null {
  const { ctx } = env;
  const data = blocData(ctx, id);
  const members = simulatedMembers(ctx, id);
  if (members.length === 0) return null;
  const lead = data.leadership;
  if (lead.kind === "rotating") {
    const order = (lead.order ?? []).filter((n) => members.includes(n));
    for (const n of members) if (!order.includes(n)) order.push(n);
    const term = lead.termMonths ?? 6;
    const k = Math.max(0, monthsBetween(ctx.config.blocs.rotationEpoch, date));
    return order[Math.floor(k / term) % order.length];
  }
  const weight = (n: NationId) =>
    lead.kind === "hegemon"
      ? militaryPower(ctx, env.military, n)
      : (env.economy.nations[n]?.gdp ?? 0);
  let best = members[0];
  for (const n of members) if (weight(n) > weight(best)) best = n;
  const current = leaderOf(env.state, id);
  if (
    current !== null &&
    members.includes(current) &&
    weight(current) >= (1 - ctx.config.blocs.hegemonMargin) * weight(best)
  ) {
    return current;
  }
  return best;
}

// Date the rotating presidency changes hands next (null for the others).
export function termEnds(ctx: EconomyContext, id: string, date: string) {
  const lead = blocData(ctx, id).leadership;
  if (lead.kind !== "rotating") return null;
  const term = lead.termMonths ?? 6;
  const k = Math.max(0, monthsBetween(ctx.config.blocs.rotationEpoch, date));
  const next = (Math.floor(k / term) + 1) * term;
  return addMonths(ctx.config.blocs.rotationEpoch, next);
}

// --- votes ---------------------------------------------------------------------

function alignment(env: BlocEnv, a: NationId, b: NationId): number {
  const pa = env.politics.nations[a];
  const pb = env.politics.nations[b];
  if (pa === undefined || pb === undefined) return 0;
  return (
    1 -
    (2 * ideologyDistance(pa.government.ideology, pb.government.ideology)) /
      MAX_IDEOLOGY_DISTANCE
  );
}

// Share of the trade of `a` (partners weighted by distance and GDP, the rest
// of the world included) that goes to `b`.
export function tradeShare(
  ctx: EconomyContext,
  a: NationId,
  b: NationId,
): number {
  let total = ctx.partnerWeight(a, ROW_ID);
  for (const other of ctx.nationIds) {
    if (other !== a) total += ctx.partnerWeight(a, other);
  }
  return total > 0 ? ctx.partnerWeight(a, b) / total : 0;
}

// The trade at stake is marginal: a voter that already sanctions the target
// or fights it loses nothing more by a bloc sanction, and gains nothing by a
// lift it would not apply to itself.
function tradeAlreadyCut(env: BlocEnv, voter: NationId, m: Measure): boolean {
  if (m.target === null) return false;
  const cut =
    isSanctioning(env.diplomacy, voter, m.target) ||
    env.diplomacy.wars.some(
      (w) =>
        (w.aggressors.includes(voter) && w.defenders.includes(m.target!)) ||
        (w.defenders.includes(voter) && w.aggressors.includes(m.target!)),
    );
  if (m.kind === "sanctions") return cut;
  if (m.kind === "lift") return !cut;
  return false;
}

// What the measure is worth to a voter (config.blocs, BlocsConfigSchema).
export function utility(env: BlocEnv, voter: NationId, m: Measure): number {
  const cfg = env.ctx.config.blocs;
  const w = cfg.vote;
  const hostile = m.kind === "sanctions" || m.kind === "suspension";
  const sign = hostile ? -1 : 1;
  let u = w.loyalty;
  // A measure about a nation weighs the relations with it and the alignment
  // of the governments; a measure of the bloc itself (budget, common
  // defence, programme) is weighed on what it costs and on sovereignty.
  if (m.target !== null) {
    u += (w.relations * sign * relation(env.diplomacy, voter, m.target)) / 100;
    u += w.ideology * sign * alignment(env, voter, m.target);
  }
  const economy = env.economy.nations[voter];
  let stakePct = 0;
  if (m.kind === "budget") {
    const bloc = blocState(env.state, m.bloc);
    const net = (bloc.contributions[voter] ?? 0) - (bloc.received[voter] ?? 0);
    const direction = m.direction === "down" ? -1 : 1;
    stakePct = (direction * cfg.budgetStep * net * 12 * 100) / economy.gdp;
  } else if (m.target !== null && !tradeAlreadyCut(env, voter, m)) {
    stakePct =
      cfg.tradeStake[m.kind] *
      env.ctx.config.economy.sanctionFriction *
      economy.tradeOpenness *
      tradeShare(env.ctx, voter, m.target) *
      100;
  }
  u -= w.tradePerPctGdp * stakePct;
  const integration =
    cfg.integration[m.kind] *
    (m.kind === "budget" && m.direction === "down" ? -1 : 1);
  const sovereignty =
    env.politics.nations[voter]?.government.ideology.sovereignty ?? 0;
  u -= w.sovereignty * sovereignty * integration;
  return u;
}

// The members that vote on a measure: the simulated full members, the
// nation the measure is about excepted.
export function votersOf(env: BlocEnv, m: Measure): NationId[] {
  return simulatedMembers(env.ctx, m.bloc).filter((n) => n !== m.target);
}

function passes(
  env: BlocEnv,
  rule: DecisionRule,
  bloc: Bloc,
  votes: Record<NationId, BlocVote>,
): boolean {
  const ids = Object.keys(votes);
  const yes = ids.filter((n) => votes[n] === "yes");
  const no = ids.filter((n) => votes[n] === "no");
  switch (rule) {
    // Abstention does not block (EU constructive abstention, NATO silence).
    case "unanimity":
    case "consensus":
      return no.length === 0 && yes.length > 0;
    case "simple-majority":
      return yes.length > no.length;
    case "qualified-majority": {
      const q = bloc.qualifiedMajority ?? {
        memberShare: 0.5,
        populationShare: 0.5,
      };
      const pop = (n: NationId) => env.sheets.get(n)?.population.value ?? 0;
      const total = ids.reduce((s, n) => s + pop(n), 0);
      const yesPop = yes.reduce((s, n) => s + pop(n), 0);
      return (
        ids.length > 0 &&
        yes.length / ids.length >= q.memberShare &&
        total > 0 &&
        yesPop / total >= q.populationShare
      );
    }
  }
}

// How the members vote: the proposer yes, the AI yes when U > 0, the player
// as it cast its vote (or, until it does, as its government leans).
export function tally(env: BlocEnv, m: Measure): Tally {
  const votes: Record<NationId, BlocVote> = {};
  const utilities: Record<NationId, number> = {};
  for (const voter of votersOf(env, m)) {
    const u = utility(env, voter, m);
    utilities[voter] = u;
    votes[voter] =
      voter === m.by ? "yes" : (m.cast?.[voter] ?? (u > 0 ? "yes" : "no"));
  }
  const data = blocData(env.ctx, m.bloc);
  const values = Object.values(votes);
  return {
    votes,
    utilities,
    yes: values.filter((v) => v === "yes").length,
    no: values.filter((v) => v === "no").length,
    abstain: values.filter((v) => v === "abstain").length,
    adopted: passes(
      env,
      data.decisionRules[MEASURE_DOMAIN[m.kind]],
      data,
      votes,
    ),
  };
}

// --- measures ------------------------------------------------------------------

// A bloc takes applications when its data sets accession criteria; the
// others (G7, G20, OPEC) are by invitation only.
export function openToApplications(bloc: Bloc): boolean {
  return (
    bloc.accession.minRelations !== undefined ||
    bloc.accession.regimes !== undefined
  );
}

export function accessionCriteria(
  env: BlocEnv,
  id: string,
  nation: NationId,
): AccessionCriteria {
  const a = blocData(env.ctx, id).accession;
  const politics = env.politics.nations[nation];
  const economy = env.economy.nations[nation];
  const regime =
    a.regimes === undefined ||
    (politics !== undefined && a.regimes.includes(politics.regime));
  const debt =
    a.maxDebtToGdp === undefined ||
    (economy !== undefined && economy.debt / economy.gdp <= a.maxDebtToGdp);
  const members = simulatedMembers(env.ctx, id).filter((m) => m !== nation);
  const meanRelations =
    members.length === 0
      ? 0
      : members.reduce((s, m) => s + relation(env.diplomacy, m, nation), 0) /
        members.length;
  const relations =
    a.minRelations === undefined || meanRelations >= a.minRelations;
  return {
    regime,
    debt,
    relations,
    meanRelations,
    ok: regime && debt && relations,
  };
}

function hasPending(env: BlocEnv, m: Measure): boolean {
  return env.state.proposals.some(
    (p) =>
      p.result === "pending" &&
      p.bloc === m.bloc &&
      p.kind === m.kind &&
      p.target === m.target,
  );
}

// Why a leader cannot propose this measure now (null: it can).
export function measureRefusal(env: BlocEnv, m: Measure): string | null {
  const data = env.ctx.blocs.find((b) => b.id === m.bloc);
  if (data === undefined) return "unknown-bloc";
  const bloc = blocState(env.state, m.bloc);
  if (leaderOf(env.state, m.bloc) !== m.by) return "not-leader";
  if (bloc.lastProposal === env.date.slice(0, 7)) return "one-per-month";
  if (hasPending(env, m)) return "pending";
  const competent = (c: string) => (data.competencies ?? []).includes(c);
  const simulated = (n: NationId | null) =>
    n !== null && n !== m.by && env.ctx.nationIds.includes(n);
  const status = m.target === null ? null : memberStatus(bloc, m.target);
  switch (m.kind) {
    case "sanctions":
      if (!competent("sanctions")) return "no-competence";
      if (!simulated(m.target)) return "target";
      return bloc.sanctions.includes(m.target!) ? "already" : null;
    case "lift":
      if (!simulated(m.target)) return "target";
      if (status === "suspended") return null;
      if (!competent("sanctions")) return "no-competence";
      return bloc.sanctions.includes(m.target!) ? null : "nothing-to-lift";
    case "accession": {
      if (!simulated(m.target)) return "target";
      if (status === "full" || status === "suspended") return "member";
      if (bloc.accessions.some((a) => a.nation === m.target))
        return "in-process";
      const applied = bloc.applications.some((a) => a.nation === m.target);
      if (!applied && status !== "candidate") return "no-application";
      return accessionCriteria(env, m.bloc, m.target!).ok ? null : "criteria";
    }
    case "suspension":
      if (!simulated(m.target)) return "target";
      return status === "full" ? null : "not-member";
    case "budget": {
      if (data.budget === undefined) return "no-budget";
      if (m.direction === null) return "direction";
      const cfg = env.ctx.config.blocs;
      const next =
        bloc.budgetScale *
        (1 + (m.direction === "up" ? 1 : -1) * cfg.budgetStep);
      return next > cfg.budgetScaleMax + 1e-9 ||
        next < cfg.budgetScaleMin - 1e-9
        ? "bounds"
        : null;
    }
    case "common-defense":
      if (!competent("defense")) return "no-competence";
      return data.collectiveDefense !== undefined || bloc.commonDefense
        ? "already"
        : null;
    case "tech-program":
      if ((data.budget?.shares.programs ?? 0) <= 0) return "no-budget";
      return bloc.programs.some((p) => env.date < p.until) ? "already" : null;
    case "trade-agreement":
      if (data.tradeBonus === undefined) return "no-competence";
      if (!simulated(m.target)) return "target";
      if (status === "full" || status === "suspended") return "member";
      return bloc.agreements.includes(m.target!) ? "already" : null;
  }
}

function newProposal(env: BlocEnv, m: Measure): BlocProposal {
  const proposal: BlocProposal = {
    id: env.state.nextProposal++,
    bloc: m.bloc,
    by: m.by,
    kind: m.kind,
    target: m.target,
    direction: m.kind === "budget" ? m.direction : null,
    date: env.date,
    resolveOn: firstOfNextMonth(env.date),
    cast: {},
    result: "pending",
    votes: {},
  };
  env.state.proposals.push(proposal);
  return proposal;
}

function proposalEvent(p: BlocProposal): BlocEngineEvent {
  return {
    type: "bloc-proposal",
    nation: p.by,
    params: {
      bloc: p.bloc,
      kind: p.kind,
      target: p.target ?? "",
      direction: p.direction ?? "",
    },
  };
}

// The leader puts a measure to the vote. When the player votes, it resolves
// on the 1st of next month (the player has the month to vote); among AI
// members only, at once.
export function propose(env: BlocEnv, m: Measure): BlocStepEvent[] {
  const refusal = measureRefusal(env, m);
  if (refusal !== null) throw new Error(`bloc-propose: ${refusal}`);
  blocState(env.state, m.bloc).lastProposal = env.date.slice(0, 7);
  return submit(env, m);
}

function submit(env: BlocEnv, m: Measure): BlocStepEvent[] {
  const proposal = newProposal(env, m);
  const events: BlocStepEvent[] = [proposalEvent(proposal)];
  if (votersOf(env, proposal).every((v) => env.aiNations.includes(v))) {
    events.push(...resolve(env, proposal));
  }
  return events;
}

export function castVote(
  env: BlocEnv,
  voter: NationId,
  proposal: number,
  vote: BlocVote,
): void {
  const p = env.state.proposals.find((x) => x.id === proposal);
  if (p === undefined || p.result !== "pending") {
    throw new Error("bloc-vote: no such pending proposal");
  }
  if (!votersOf(env, p).includes(voter)) {
    throw new Error("bloc-vote: not a voter");
  }
  p.cast[voter] = vote;
}

export function applyForMembership(
  env: BlocEnv,
  nation: NationId,
  id: string,
): BlocEngineEvent[] {
  const data = blocData(env.ctx, id);
  const bloc = blocState(env.state, id);
  const status = memberStatus(bloc, nation);
  if (!openToApplications(data)) throw new Error("bloc-apply: by invitation");
  if (status === "full" || status === "suspended") {
    throw new Error("bloc-apply: already a member");
  }
  if (
    bloc.applications.some((a) => a.nation === nation) ||
    bloc.accessions.some((a) => a.nation === nation)
  ) {
    throw new Error("bloc-apply: already applied");
  }
  if (!accessionCriteria(env, id, nation).ok) {
    throw new Error("bloc-apply: criteria");
  }
  bloc.applications.push({ nation, date: env.date });
  return [{ type: "bloc-application", nation, params: { bloc: id } }];
}

export function leaveBloc(
  env: BlocEnv,
  nation: NationId,
  id: string,
): BlocEngineEvent[] {
  const data = blocData(env.ctx, id);
  const bloc = blocState(env.state, id);
  const status = memberStatus(bloc, nation);
  if (status !== "full" && status !== "suspended") {
    throw new Error("bloc-leave: not a member");
  }
  if (bloc.exits.some((e) => e.nation === nation)) {
    throw new Error("bloc-leave: already leaving");
  }
  const at = addMonths(env.date, data.exit.delayMonths);
  bloc.exits.push({ nation, effectiveOn: at });
  return [{ type: "bloc-exit-notified", nation, params: { bloc: id, at } }];
}

// The player answers a call of collective defence: it enters the war.
export function honorCall(
  env: BlocEnv,
  nation: NationId,
  id: string,
  warId: string,
): BlocStepEvent[] {
  const call = env.state.calls.find(
    (c) => c.bloc === id && c.war === warId && c.nation === nation,
  );
  const war = env.diplomacy.wars.find((w) => w.id === warId);
  if (call === undefined || war === undefined) {
    throw new Error("bloc-honor: no such call");
  }
  env.state.calls.splice(env.state.calls.indexOf(call), 1);
  if (warSide(war, nation) !== null) return [];
  joinWar(env.ctx, env.diplomacy, war, nation, "defenders");
  return [
    { type: "war-joined", nation, war: war.id, against: war.aggressors[0] },
  ];
}

// --- effects -------------------------------------------------------------------

function applyBlocSanctions(
  env: BlocEnv,
  bloc: BlocState,
  member: NationId,
): DiplomacyEvent[] {
  const events: DiplomacyEvent[] = [];
  for (const target of bloc.sanctions) {
    if (target === member) continue;
    const event = imposeSanctions(
      env.ctx,
      env.diplomacy,
      env.economy,
      member,
      target,
      env.date,
    );
    if (event !== null) events.push(event);
  }
  return events;
}

// Is a sanction of `by` against `against` held by a bloc `by` belongs to?
// The member does not lift it alone (diplomacy.ts, step 4).
export function blocSanction(
  ctx: EconomyContext,
  state: BlocsState,
  by: NationId,
  against: NationId,
): boolean {
  return state.blocs.some(
    (b) => b.sanctions.includes(against) && ctx.membersOf(b.id).includes(by),
  );
}

function enact(env: BlocEnv, p: BlocProposal): BlocStepEvent[] {
  const { ctx } = env;
  const cfg = ctx.config.blocs;
  const bloc = blocState(env.state, p.bloc);
  const data = blocData(ctx, p.bloc);
  const events: BlocStepEvent[] = [];
  const target = p.target;
  switch (p.kind) {
    case "sanctions":
      if (target !== null && !bloc.sanctions.includes(target)) {
        bloc.sanctions.push(target);
        for (const m of simulatedMembers(ctx, p.bloc)) {
          events.push(
            ...applyBlocSanctions(env, { ...bloc, sanctions: [target] }, m),
          );
        }
      }
      break;
    case "lift": {
      if (target === null) break;
      const member = bloc.members.find((m) => m.nation === target);
      if (member !== undefined && member.status === "suspended") {
        member.status = "full";
        break;
      }
      bloc.sanctions = bloc.sanctions.filter((n) => n !== target);
      syncBlocs(ctx, env.state);
      for (const m of simulatedMembers(ctx, p.bloc)) {
        if (blocSanction(ctx, env.state, m, target)) continue;
        const event = liftSanctions(ctx, env.diplomacy, env.economy, m, target);
        if (event !== null) events.push(event);
      }
      break;
    }
    case "accession": {
      if (target === null) break;
      const process = bloc.accessions.find((a) => a.nation === target);
      if (process === undefined) {
        // Opening: candidate status and a process of monthsMin to monthsMax.
        bloc.applications = bloc.applications.filter(
          (a) => a.nation !== target,
        );
        const a = data.accession;
        const months = env.rng.nextInt(a.monthsMin, a.monthsMax + 1);
        const completeOn = addMonths(env.date, months);
        bloc.accessions.push({
          nation: target,
          since: env.date,
          nextVote: addMonths(env.date, 12),
          completeOn,
        });
        const member = bloc.members.find((m) => m.nation === target);
        if (member === undefined) {
          bloc.members.push({
            nation: target,
            status: "candidate",
            since: env.date,
          });
        } else {
          member.status = "candidate";
        }
        events.push({
          type: "bloc-accession-opened",
          nation: target,
          params: { bloc: p.bloc, until: completeOn },
        });
      } else if (env.date >= process.completeOn) {
        // The final vote: a full member, bound by the bloc's sanctions.
        bloc.accessions.splice(bloc.accessions.indexOf(process), 1);
        const member = bloc.members.find((m) => m.nation === target)!;
        member.status = "full";
        member.since = env.date;
        events.push({
          type: "bloc-joined",
          nation: target,
          params: { bloc: p.bloc },
        });
        events.push(...applyBlocSanctions(env, bloc, target));
      } else {
        process.nextVote = addMonths(process.nextVote, 12);
      }
      break;
    }
    case "suspension": {
      const member = bloc.members.find((m) => m.nation === target);
      if (member !== undefined && member.status === "full") {
        member.status = "suspended";
      }
      break;
    }
    case "budget":
      bloc.budgetScale = Math.min(
        cfg.budgetScaleMax,
        Math.max(
          cfg.budgetScaleMin,
          bloc.budgetScale *
            (1 + (p.direction === "down" ? -1 : 1) * cfg.budgetStep),
        ),
      );
      break;
    case "common-defense":
      bloc.commonDefense = true;
      break;
    case "tech-program":
      bloc.programs.push({
        id: p.id,
        since: env.date,
        until: addMonths(env.date, cfg.programMonths),
      });
      break;
    case "trade-agreement":
      if (target !== null && !bloc.agreements.includes(target)) {
        bloc.agreements.push(target);
      }
      break;
  }
  syncBlocs(ctx, env.state);
  return events;
}

// A rejected accession vote freezes the process: back to candidate, the
// leader may open it again later.
function freeze(env: BlocEnv, bloc: BlocState, nation: NationId, why: string) {
  bloc.accessions = bloc.accessions.filter((a) => a.nation !== nation);
  return {
    type: "bloc-accession-frozen" as const,
    nation,
    params: { bloc: bloc.id, why },
  };
}

function resolve(env: BlocEnv, p: BlocProposal): BlocStepEvent[] {
  const result = tally(env, p);
  p.votes = result.votes;
  p.result = result.adopted ? "adopted" : "rejected";
  const events: BlocStepEvent[] = [
    {
      type: "bloc-decision",
      nation: p.by,
      params: {
        bloc: p.bloc,
        kind: p.kind,
        target: p.target ?? "",
        direction: p.direction ?? "",
        result: p.result,
        yes: String(result.yes),
        no: String(result.no),
        abstain: String(result.abstain),
      },
    },
  ];
  if (result.adopted) {
    events.push(...enact(env, p));
  } else if (p.kind === "accession" && p.target !== null) {
    const bloc = blocState(env.state, p.bloc);
    if (bloc.accessions.some((a) => a.nation === p.target)) {
      events.push(freeze(env, bloc, p.target, "vote"));
    }
  }
  return events;
}

// --- the monthly step ----------------------------------------------------------

export function stepBlocsMonth(env: BlocEnv): BlocStepEvent[] {
  const { ctx, state, date } = env;
  const events: BlocStepEvent[] = [];

  // 1. Leaders: a new presidency or hegemon is journaled.
  for (const bloc of state.blocs) {
    const leader = computeLeader(env, bloc.id, date);
    const before = leaderOf(state, bloc.id);
    state.leaders[bloc.id] = leader ?? "";
    if (leader !== null && leader !== before) {
      events.push({
        type: "bloc-presidency",
        nation: leader,
        params: { bloc: bloc.id },
      });
    }
  }

  // 2. Proposals due.
  for (const p of state.proposals) {
    if (p.result === "pending" && date >= p.resolveOn) {
      events.push(...resolve(env, p));
    }
  }

  // 3. Accession processes: the annual vote and the final one are put to the
  //    members by the leader (they do not count as its measure of the month);
  //    failing criteria freeze the process.
  for (const bloc of state.blocs) {
    const leader = leaderOf(state, bloc.id);
    for (const process of [...bloc.accessions]) {
      if (date < process.nextVote && date < process.completeOn) continue;
      if (!accessionCriteria(env, bloc.id, process.nation).ok) {
        events.push(freeze(env, bloc, process.nation, "criteria"));
        continue;
      }
      const m: Measure = {
        bloc: bloc.id,
        by: leader ?? process.nation,
        kind: "accession",
        target: process.nation,
        direction: null,
      };
      // One vote a year: the next date moves when the vote passes (enact).
      if (leader === null || hasPending(env, m)) continue;
      events.push(...submit(env, m));
    }
  }

  // 4. Exits that take effect: out of the bloc, a GDP level cost.
  for (const bloc of state.blocs) {
    const data = blocData(ctx, bloc.id);
    for (const exit of [...bloc.exits]) {
      if (date < exit.effectiveOn) continue;
      bloc.exits.splice(bloc.exits.indexOf(exit), 1);
      bloc.members = bloc.members.filter((m) => m.nation !== exit.nation);
      const economy = env.economy.nations[exit.nation];
      if (economy !== undefined) economy.gdp *= 1 - data.exit.tradeCostPctGdp;
      events.push({
        type: "bloc-left",
        nation: exit.nation,
        params: { bloc: bloc.id },
      });
    }
  }
  syncBlocs(ctx, state);

  // 5. Collective defence.
  events.push(...collectiveDefense(env));

  // 6. The budget of each bloc, paid by the next national budgets.
  budgetFlows(env);

  // 7. Applications of the AI nations, 8. measures of the AI leaders.
  events.push(...aiApplications(env));
  for (const bloc of state.blocs) events.push(...aiProposal(env, bloc.id));

  // 9. Housekeeping: resolved proposals kept for a while, ended programmes.
  const oldest = addMonths(date, -ctx.config.blocs.historyMonths);
  state.proposals = state.proposals.filter(
    (p) => p.result === "pending" || p.date >= oldest,
  );
  for (const bloc of state.blocs) {
    bloc.programs = bloc.programs.filter((p) => date < p.until);
  }
  syncBlocs(ctx, state);
  return events;
}

// A member attacked by a non-member (a war declared in the campaign): every
// other simulated member enters the war within the month with the
// probability of the clause (lower for a sovereignist government); the
// player is called and answers within the month, or loses relations with
// the other members.
function collectiveDefense(env: BlocEnv): BlocStepEvent[] {
  const { ctx, state, date } = env;
  const cfg = ctx.config.blocs;
  const events: BlocStepEvent[] = [];
  for (const call of [...state.calls]) {
    const war = env.diplomacy.wars.find((w) => w.id === call.war);
    if (war === undefined || warSide(war, call.nation) !== null) {
      state.calls.splice(state.calls.indexOf(call), 1);
      continue;
    }
    if (date < call.until) continue;
    state.calls.splice(state.calls.indexOf(call), 1);
    for (const other of simulatedMembers(ctx, call.bloc)) {
      if (other !== call.nation) {
        addRelation(
          env.diplomacy,
          call.nation,
          other,
          -cfg.article5RefusalRelations,
        );
      }
    }
    events.push({
      type: "bloc-article5-refused",
      nation: call.nation,
      params: { bloc: call.bloc, war: call.war },
    });
  }
  for (const war of env.diplomacy.wars) {
    if (!war.declaredInCampaign || state.handledWars.includes(war.id)) continue;
    state.handledWars.push(war.id);
    const victim = war.defenders[0];
    for (const bloc of state.blocs) {
      const data = blocData(ctx, bloc.id);
      const clause =
        data.collectiveDefense ??
        (bloc.commonDefense ? cfg.commonDefense : undefined);
      if (clause === undefined) continue;
      const members = ctx.membersOf(bloc.id);
      if (!members.includes(victim)) continue;
      if (war.aggressors.some((a) => members.includes(a))) continue;
      events.push({
        type: "bloc-article5",
        nation: victim,
        params: { bloc: bloc.id, against: war.aggressors[0], war: war.id },
      });
      for (const m of simulatedMembers(ctx, bloc.id)) {
        if (m === victim || warSide(war, m) !== null) continue;
        if (!env.aiNations.includes(m)) {
          state.calls.push({
            bloc: bloc.id,
            war: war.id,
            nation: m,
            until: addMonths(date, 1),
          });
          continue;
        }
        const sovereignty =
          env.politics.nations[m]?.government.ideology.sovereignty ?? 0;
        const p =
          sovereignty > clause.sovereigntyAbove
            ? clause.sovereignJoinProbability
            : clause.joinProbability;
        if (env.rng.next() < p) {
          joinWar(ctx, env.diplomacy, war, m, "defenders");
          events.push({
            type: "war-joined",
            nation: m,
            war: war.id,
            against: war.aggressors[0],
          });
        }
      }
    }
  }
  return events;
}

// Members of the collective-defence blocs of `victim` that would enter a war
// `aggressor` declares on it, with the chance each honours the clause (the
// rule of collectiveDefense above; J6: the expected cost of a war for the
// AI). A bloc does not defend a member against another member.
export function defenseGuarantors(
  ctx: EconomyContext,
  state: BlocsState,
  politics: PoliticsState,
  victim: NationId,
  aggressor: NationId,
): { nation: NationId; probability: number }[] {
  const cfg = ctx.config.blocs;
  const best = new Map<NationId, number>();
  for (const bloc of state.blocs) {
    const data = blocData(ctx, bloc.id);
    const clause =
      data.collectiveDefense ??
      (bloc.commonDefense ? cfg.commonDefense : undefined);
    if (clause === undefined) continue;
    const members = ctx.membersOf(bloc.id);
    if (!members.includes(victim) || members.includes(aggressor)) continue;
    for (const m of simulatedMembers(ctx, bloc.id)) {
      if (m === victim) continue;
      const sovereignty =
        politics.nations[m]?.government.ideology.sovereignty ?? 0;
      const p =
        sovereignty > clause.sovereigntyAbove
          ? clause.sovereignJoinProbability
          : clause.joinProbability;
      best.set(m, Math.max(best.get(m) ?? 0, p));
    }
  }
  return [...best].map(([nation, probability]) => ({ nation, probability }));
}

// Contributions in % of GDP (x the budget scale) of the simulated members,
// shared out by the shares of the data: structural funds to the members
// under a share of the bloc's GDP per head, in proportion to what they lack;
// the defence fund to the members defending in a war, otherwise in
// proportion to their defence spending; candidate aid to the candidates, in
// proportion to their population; programmes to the members in proportion to their research. What
// finds no recipient goes back pro rata of the contributions.
function budgetFlows(env: BlocEnv): void {
  const { ctx, state } = env;
  state.net = {};
  const gdp = (n: NationId) => env.economy.nations[n]?.gdp ?? 0;
  const pop = (n: NationId) => env.sheets.get(n)?.population.value ?? 0;
  for (const bloc of state.blocs) {
    bloc.contributions = {};
    bloc.received = {};
    const budget = blocData(ctx, bloc.id).budget;
    const members = simulatedMembers(ctx, bloc.id);
    if (budget === undefined || members.length === 0) continue;
    let pool = 0;
    for (const m of members) {
      const c = (budget.contributionPctGdp * bloc.budgetScale * gdp(m)) / 12;
      bloc.contributions[m] = c;
      pool += c;
    }
    if (pool <= 0) continue;
    let refund = 0;
    const share = (
      amount: number,
      weights: readonly (readonly [NationId, number])[],
    ) => {
      const total = weights.reduce((s, [, w]) => s + Math.max(0, w), 0);
      if (amount <= 0) return;
      if (total <= 0) {
        refund += amount;
        return;
      }
      for (const [n, w] of weights) {
        if (w > 0)
          bloc.received[n] = (bloc.received[n] ?? 0) + (amount * w) / total;
      }
    };
    const shares = budget.shares;
    const totalPop = members.reduce((s, m) => s + pop(m), 0);
    const perHead =
      totalPop > 0 ? members.reduce((s, m) => s + gdp(m), 0) / totalPop : 0;
    const threshold =
      (budget.structuralFundsBelowGdpPerCapitaShare ?? 0.9) * perHead;
    share(
      pool * (shares.structural ?? 0),
      members.map((m) => [
        m,
        pop(m) > 0 ? Math.max(0, threshold - gdp(m) / pop(m)) * pop(m) : 0,
      ]),
    );
    const defending = members.filter((m) =>
      env.diplomacy.wars.some((w) => w.defenders.includes(m)),
    );
    share(
      pool * (shares.defense ?? 0),
      defending.length > 0
        ? defending.map((m) => [m, gdp(m)])
        : members.map((m) => [
            m,
            (env.economy.nations[m]?.spending.defense ?? 0) * gdp(m),
          ]),
    );
    share(
      pool * (shares.candidates ?? 0),
      bloc.members
        .filter(
          (m) => m.status === "candidate" && ctx.nationIds.includes(m.nation),
        )
        .map((m) => [m.nation, pop(m.nation)]),
    );
    const programs = pool * (shares.programs ?? 0);
    if (bloc.programs.some((p) => env.date < p.until)) {
      share(
        programs,
        members.map((m) => [
          m,
          (env.economy.nations[m]?.spending.research ?? 0) * gdp(m),
        ]),
      );
    } else {
      refund += programs;
    }
    for (const m of members) {
      bloc.received[m] =
        (bloc.received[m] ?? 0) + (refund * bloc.contributions[m]) / pool;
    }
    for (const n of new Set([
      ...Object.keys(bloc.contributions),
      ...Object.keys(bloc.received),
    ])) {
      state.net[n] =
        (state.net[n] ?? 0) +
        (bloc.received[n] ?? 0) -
        (bloc.contributions[n] ?? 0);
    }
  }
}

// An AI nation applies to a bloc open to applications when it meets the
// criteria, its relations with the members are well above the minimum and
// its government is not sovereignist; a small chance each month.
function aiApplications(env: BlocEnv): BlocEngineEvent[] {
  const { ctx, state } = env;
  const cfg = ctx.config.blocs.ai;
  const events: BlocEngineEvent[] = [];
  for (const nation of env.aiNations) {
    const sovereignty =
      env.politics.nations[nation]?.government.ideology.sovereignty ?? 0;
    if (sovereignty >= cfg.applySovereigntyBelow) continue;
    for (const bloc of state.blocs) {
      const data = blocData(ctx, bloc.id);
      if (!openToApplications(data)) continue;
      if (simulatedMembers(ctx, bloc.id).length === 0) continue;
      const status = memberStatus(bloc, nation);
      if (status === "full" || status === "suspended" || status === "candidate")
        continue;
      if (bloc.applications.some((a) => a.nation === nation)) continue;
      const criteria = accessionCriteria(env, bloc.id, nation);
      if (!criteria.ok) continue;
      if (
        criteria.meanRelations <
        (data.accession.minRelations ?? 0) + cfg.applyRelationMargin
      )
        continue;
      if (!env.rng.chance(cfg.applyProbability)) continue;
      events.push(...applyForMembership(env, nation, bloc.id));
    }
  }
  return events;
}

// Weight of a goal in a nation's agenda (0.25 each without an agenda).
function agendaWeight(env: BlocEnv, id: NationId, goal: string): number {
  const list = env.sheets.get(id)?.aiAgenda;
  if (list === undefined) return 0.25;
  return list.find((g) => g.goal === goal)?.weight ?? 0;
}

// The measure of the month of an AI leader: the first one, in this order,
// that it wants (U > 0) and that the members would adopt. Sanctions, lifts,
// common defence, accessions and suspensions answer the state of the world;
// programmes and trade agreements come by chance, more often for a leader
// whose agenda puts growth first.
function aiProposal(env: BlocEnv, id: string): BlocStepEvent[] {
  const { ctx, state } = env;
  const leader = leaderOf(state, id);
  if (leader === null || !env.aiNations.includes(leader)) return [];
  const bloc = blocState(state, id);
  if (bloc.lastProposal === env.date.slice(0, 7)) return [];
  const data = blocData(ctx, id);
  const cfg = ctx.config.blocs.ai;
  const attempt = (
    kind: BlocMeasure,
    target: NationId | null,
    direction: "up" | "down" | null = null,
  ): BlocStepEvent[] | null => {
    const m: Measure = { bloc: id, by: leader, kind, target, direction };
    if (measureRefusal(env, m) !== null) return null;
    if (target !== null && utility(env, leader, m) <= 0) return null;
    if (!tally(env, m).adopted) return null;
    return propose(env, m);
  };
  const members = simulatedMembers(ctx, id);
  const aggressors = new Set<NationId>(env.diplomacy.pariahs);
  for (const war of env.diplomacy.wars) {
    if (war.declaredInCampaign)
      war.aggressors.forEach((a) => aggressors.add(a));
  }
  // Sanctions against an aggressor the leader resents, or that enough
  // members already sanction on their own (layer 1 made a vote).
  for (const a of aggressors) {
    const voters = members.filter((m) => m !== a);
    if (voters.length === 0) continue;
    const already =
      voters.filter((m) => isSanctioning(env.diplomacy, m, a)).length /
      voters.length;
    if (
      relation(env.diplomacy, leader, a) < cfg.sanctionRelationsBelow ||
      already >= ctx.config.diplomacy.sanction.blocAlignShare
    ) {
      const done = attempt("sanctions", a);
      if (done !== null) return done;
    }
  }
  for (const target of bloc.sanctions) {
    if (aggressors.has(target)) continue;
    if (relation(env.diplomacy, leader, target) < cfg.liftAboveRelations)
      continue;
    const done = attempt("lift", target);
    if (done !== null) return done;
  }
  const attacked = members.some((m) =>
    env.diplomacy.wars.some(
      (w) =>
        w.defenders.includes(m) &&
        !w.aggressors.some((a) => ctx.membersOf(id).includes(a)),
    ),
  );
  if (attacked) {
    const done = attempt("common-defense", null);
    if (done !== null) return done;
  }
  const candidates = [
    ...bloc.applications.map((a) => a.nation),
    ...bloc.members
      .filter((m) => m.status === "candidate")
      .map((m) => m.nation),
  ];
  for (const c of candidates) {
    const done = attempt("accession", c);
    if (done !== null) return done;
  }
  for (const war of env.diplomacy.wars) {
    if (!war.declaredInCampaign) continue;
    for (const a of war.aggressors) {
      if (!members.includes(a)) continue;
      if (!war.defenders.some((d) => ctx.membersOf(id).includes(d))) continue;
      const done = attempt("suspension", a);
      if (done !== null) return done;
    }
  }
  if (
    (data.budget?.shares.programs ?? 0) > 0 &&
    !bloc.programs.some((p) => env.date < p.until) &&
    env.rng.chance(
      cfg.techProgramProbability * (0.5 + agendaWeight(env, leader, "growth")),
    )
  ) {
    const done = attempt("tech-program", null);
    if (done !== null) return done;
  }
  if (
    data.tradeBonus !== undefined &&
    env.rng.chance(
      cfg.tradeAgreementProbability *
        (0.5 + agendaWeight(env, leader, "growth")),
    )
  ) {
    for (const n of ctx.nationIds) {
      if (relation(env.diplomacy, leader, n) < cfg.tradeAgreementRelations)
        continue;
      const done = attempt("trade-agreement", n);
      if (done !== null) return done;
    }
  }
  return [];
}

// --- what the screen shows ------------------------------------------------------

export interface MeasureOption {
  kind: BlocMeasure;
  target: NationId | null;
  direction: "up" | "down" | null;
  cost: number;
  projection: Tally;
}

// The measures the player could put to the vote now, with the vote they
// would get.
export function measureOptions(
  env: BlocEnv,
  player: NationId,
  id: string,
): MeasureOption[] {
  if (leaderOf(env.state, id) !== player) return [];
  const out: MeasureOption[] = [];
  const cost = env.ctx.config.blocs.capitalCost;
  const push = (
    kind: BlocMeasure,
    target: NationId | null,
    direction: "up" | "down" | null,
  ) => {
    const m: Measure = { bloc: id, by: player, kind, target, direction };
    if (measureRefusal(env, m) !== null) return;
    out.push({
      kind,
      target,
      direction,
      cost: cost[kind],
      projection: tally(env, m),
    });
  };
  for (const kind of [
    "sanctions",
    "lift",
    "accession",
    "suspension",
    "trade-agreement",
  ] as const) {
    for (const n of env.ctx.nationIds) push(kind, n, null);
  }
  push("budget", null, "up");
  push("budget", null, "down");
  push("common-defense", null, null);
  push("tech-program", null, null);
  return out;
}
