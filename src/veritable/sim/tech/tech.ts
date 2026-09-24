import { NationId } from "../../data/schemas/common";
import { GoodId } from "../../data/schemas/goods";
import { NationData } from "../../data/schemas/nation";
import {
  BlocsState,
  EconomyState,
  NationTech,
  TechState,
} from "../../data/schemas/save";
import { TechNode } from "../../data/schemas/tech";
import { EconomyContext } from "../economy/context";

// Technology (J5). A common trunk (tiers 1 and 2, ten domains) and doctrine
// branches of the blocs. Once a game month, each nation turns its R&D into
// points, spread evenly over its projects (three at most); a project ends
// when its points reach the cost of the node, discounted by the share of
// the nations that already have it, and its minimum months have passed.
//   points = total R&D in points of GDP (the budget's public research over
//            its public share) x pointsPerRdPoint x research modifiers
//            x (1 + programBonus) while a programme of one of its blocs runs
// A node changes capacities once (production, consumption) and, while in
// force, modifiers: trend growth, force of the divisions, air and naval
// power, research. A branch node counts while its nation is a full member
// of the bloc. The nodes of the first day are in the data of 2026: their
// effects are not applied again.

export interface TechModifiers {
  growth: number; // per year, added
  land: number;
  air: number;
  naval: number;
  research: number;
}
export const NEUTRAL_MODIFIERS: TechModifiers = {
  growth: 0,
  land: 1,
  air: 1,
  naval: 1,
  research: 1,
};

export type TechEvent = {
  type: "tech-completed";
  nation: NationId;
  params: Record<string, string>;
};

export interface TechEnv {
  ctx: EconomyContext;
  tech: TechState;
  economy: EconomyState;
  blocs: BlocsState;
  sheets: ReadonlyMap<NationId, NationData>;
  // Nations run by the AI: they choose their projects themselves.
  aiNations: readonly NationId[];
  date: string;
  // Share of the nations that have each node, when a step or a view has
  // counted it once (J6c: counting it for every node and every nation
  // cost tens of milliseconds a month at 208 nations).
  shares?: ReadonlyMap<string, number>;
}

// --- first day -------------------------------------------------------------

// Development index of the first day, 0..1.
export function developmentIndex(ctx: EconomyContext, sheet: NationData) {
  const cfg = ctx.config.tech;
  const perHead = sheet.gdp.value / sheet.population.value;
  const rd =
    sheet.economy.budget.spending.research.value / cfg.publicShareOfResearch;
  return (
    cfg.development.gdpWeight *
      Math.min(1, perHead / cfg.development.gdpPerCapitaRef) +
    (1 - cfg.development.gdpWeight) * Math.min(1, rd / cfg.development.rdRef)
  );
}

// What each nation has on 1 January 2026: the nodes adopted at its
// development index or by name, and what they require.
export function initTech(
  ctx: EconomyContext,
  sheets: readonly NationData[],
): TechState {
  const byId = new Map(ctx.tech.map((n) => [n.id, n]));
  const nations: Record<NationId, NationTech> = {};
  for (const sheet of sheets) {
    const dev = developmentIndex(ctx, sheet);
    const have = new Set<string>();
    const add = (id: string) => {
      if (have.has(id)) return;
      for (const r of byId.get(id)?.requires ?? []) add(r);
      have.add(id);
    };
    for (const node of ctx.tech) {
      if (node.bloc !== undefined && !ctx.blocsOf(sheet.id).includes(node.bloc))
        continue;
      if (
        (node.adoptedAbove !== null && dev >= node.adoptedAbove) ||
        (node.adoptedBy ?? []).includes(sheet.id)
      ) {
        add(node.id);
      }
    }
    const done = ctx.tech.filter((n) => have.has(n.id)).map((n) => n.id);
    nations[sheet.id] = {
      done,
      baseline: [...done],
      projects: [],
      pointsLastMonth: 0,
    };
  }
  return { nations };
}

// --- rules ------------------------------------------------------------------

export function techNode(ctx: EconomyContext, id: string): TechNode {
  const node = ctx.tech.find((n) => n.id === id);
  if (node === undefined) throw new Error(`unknown tech node ${id}`);
  return node;
}

// Share of the simulated nations that have each node.
export function diffusionShares(
  env: Pick<TechEnv, "ctx" | "tech">,
): Map<string, number> {
  const ids = env.ctx.nationIds;
  const counts = new Map<string, number>();
  for (const n of ids) {
    for (const id of env.tech.nations[n]?.done ?? []) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return new Map(
    [...counts].map(([id, c]) => [id, ids.length === 0 ? 0 : c / ids.length]),
  );
}

// Share of the simulated nations that have the node.
export function diffusion(
  env: Pick<TechEnv, "ctx" | "tech" | "shares">,
  id: string,
) {
  if (env.shares !== undefined) return env.shares.get(id) ?? 0;
  const ids = env.ctx.nationIds;
  const have = ids.filter((n) => env.tech.nations[n]?.done.includes(id));
  return ids.length === 0 ? 0 : have.length / ids.length;
}

export function effectiveCost(
  env: Pick<TechEnv, "ctx" | "tech" | "shares">,
  node: TechNode,
): number {
  return (
    node.cost * (1 - env.ctx.config.tech.diffusion * diffusion(env, node.id))
  );
}

// What the refusals of one nation read (J6c: sets, built once for a whole
// choice among 130 nodes).
interface ResearcherView {
  done: ReadonlySet<string>;
  inProgress: ReadonlySet<string>;
  projects: number;
  blocs: readonly string[];
}

function researcherView(
  ctx: EconomyContext,
  mine: TechState["nations"][string],
  nation: NationId,
): ResearcherView {
  return {
    done: new Set(mine.done),
    inProgress: new Set(mine.projects.map((p) => p.node)),
    projects: mine.projects.length,
    blocs: ctx.blocsOf(nation),
  };
}

function refusalOf(
  ctx: EconomyContext,
  view: ResearcherView,
  node: TechNode,
): string | null {
  if (view.done.has(node.id)) return "done";
  if (view.inProgress.has(node.id)) return "in-progress";
  if (view.projects >= ctx.config.tech.maxProjects) return "full";
  if (!node.requires.every((r) => view.done.has(r))) return "requires";
  if (node.bloc !== undefined && !view.blocs.includes(node.bloc)) return "bloc";
  return null;
}

// Why a nation cannot start this node (null: it can).
export function researchRefusal(
  env: Pick<TechEnv, "ctx" | "tech">,
  nation: NationId,
  id: string,
): string | null {
  const node = env.ctx.tech.find((n) => n.id === id);
  if (node === undefined) return "unknown";
  const mine = env.tech.nations[nation];
  if (mine === undefined) return "unknown";
  return refusalOf(env.ctx, researcherView(env.ctx, mine, nation), node);
}

// The refusal of every node for one nation (the view of the player).
export function researchRefusals(
  env: Pick<TechEnv, "ctx" | "tech">,
  nation: NationId,
): Record<string, string | null> {
  const mine = env.tech.nations[nation];
  if (mine === undefined) {
    return Object.fromEntries(env.ctx.tech.map((n) => [n.id, "unknown"]));
  }
  const view = researcherView(env.ctx, mine, nation);
  return Object.fromEntries(
    env.ctx.tech.map((n) => [n.id, refusalOf(env.ctx, view, n)]),
  );
}

// A multiplier or an added growth, scaled (config.tech.effectScale).
function scaled(value: number, op: "mul" | "add", scale: number): number {
  return op === "mul" ? 1 + (value - 1) * scale : value * scale;
}

// Modifiers of the nodes in force (branch nodes: while a member).
export function modifiersOf(
  ctx: EconomyContext,
  tech: TechState,
  nation: NationId,
): TechModifiers {
  const mine = tech.nations[nation];
  const out = { ...NEUTRAL_MODIFIERS };
  if (mine === undefined) return out;
  const blocs = ctx.blocsOf(nation);
  const scale = ctx.config.tech.effectScale;
  for (const id of mine.done) {
    if (mine.baseline.includes(id)) continue;
    const node = ctx.tech.find((n) => n.id === id);
    if (node === undefined) continue;
    if (node.bloc !== undefined && !blocs.includes(node.bloc)) continue;
    for (const effect of node.effects) {
      switch (effect.target) {
        case "growth":
          out.growth += scaled(effect.value, "add", scale.growth);
          break;
        case "military.land":
          out.land *= scaled(effect.value, "mul", scale.military);
          break;
        case "military.air":
          out.air *= scaled(effect.value, "mul", scale.military);
          break;
        case "military.naval":
          out.naval *= scaled(effect.value, "mul", scale.military);
          break;
        case "research":
          out.research *= scaled(effect.value, "mul", scale.research);
          break;
      }
    }
  }
  return out;
}

// The context keeps the modifiers of every nation, read by growth, fronts
// and the military (sim/economy/context.ts); synced after each change.
export function syncTech(ctx: EconomyContext, tech: TechState): void {
  ctx.techModifiers.clear();
  for (const nation of ctx.nationIds) {
    ctx.techModifiers.set(nation, modifiersOf(ctx, tech, nation));
  }
}

// Points of the month.
export function researchPoints(env: TechEnv, nation: NationId): number {
  const cfg = env.ctx.config.tech;
  const economy = env.economy.nations[nation];
  if (economy === undefined) return 0;
  const rdPoints =
    (economy.spending.research / cfg.publicShareOfResearch) * 100;
  const program = env.blocs.blocs.some(
    (b) =>
      b.programs.some((p) => env.date < p.until) &&
      env.ctx.membersOf(b.id).includes(nation),
  );
  return (
    rdPoints *
    cfg.pointsPerRdPoint *
    (env.ctx.techModifiers.get(nation)?.research ?? 1) *
    (program ? 1 + cfg.programBonus : 1)
  );
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

// Capacity effects, once, on completion.
function applyCapacities(env: TechEnv, nation: NationId, node: TechNode) {
  const economy = env.economy.nations[nation];
  if (economy === undefined) return;
  const scale = env.ctx.config.tech.effectScale.capacity;
  for (const effect of node.effects) {
    const [kind, good] = effect.target.split(".") as [string, GoodId];
    const value = scaled(effect.value, "mul", scale);
    if (kind === "production") economy.production[good] *= value;
    if (kind === "consumption") economy.consumption[good] *= value;
  }
}

// The AI's choice: available nodes, the domains of its agenda first, tier
// 1 before tier 2, the cheapest per unit of preference; ties by id. No draw.
export function aiChoose(env: TechEnv, nation: NationId): string | null {
  const cfg = env.ctx.config.tech;
  const agenda = env.sheets.get(nation)?.aiAgenda;
  const weight = (domain: string) => {
    let w = 0;
    for (const [goal, domains] of Object.entries(cfg.agendaDomains)) {
      const g = agenda?.find((a) => a.goal === goal)?.weight ?? 0.25;
      w += g * (domains.includes(domain) ? 1 : cfg.offAgendaWeight);
    }
    return w;
  };
  const mine = env.tech.nations[nation];
  if (mine === undefined) return null;
  const view = researcherView(env.ctx, mine, nation);
  let best: { id: string; score: number } | null = null;
  for (const node of env.ctx.tech) {
    if (refusalOf(env.ctx, view, node) !== null) continue;
    const score =
      (weight(node.domain) * (node.tier === 2 ? cfg.tier2Weight : 1)) /
      effectiveCost(env, node);
    if (
      best === null ||
      score > best.score ||
      (score === best.score && node.id < best.id)
    ) {
      best = { id: node.id, score };
    }
  }
  return best?.id ?? null;
}

export function startResearch(env: TechEnv, nation: NationId, id: string) {
  const refusal = researchRefusal(env, nation, id);
  if (refusal !== null) throw new Error(`tech-research: ${refusal}`);
  env.tech.nations[nation].projects.push({
    node: id,
    points: 0,
    since: env.date,
  });
}

export function cancelResearch(env: TechEnv, nation: NationId, id: string) {
  const mine = env.tech.nations[nation];
  mine.projects = mine.projects.filter((p) => p.node !== id);
}

// --- the monthly step --------------------------------------------------------

// The AI nations fill their free project slots (every month, and on the
// first day of a campaign: J6c, so that the 208 first choices do not all
// fall on the first monthly step).
export function fillAiProjects(stepEnv: TechEnv): void {
  const env =
    stepEnv.shares === undefined
      ? { ...stepEnv, shares: diffusionShares(stepEnv) }
      : stepEnv;
  for (const nation of env.aiNations) {
    const mine = env.tech.nations[nation];
    if (mine === undefined) continue;
    while (mine.projects.length < env.ctx.config.tech.maxProjects) {
      const id = aiChoose(env, nation);
      if (id === null) break;
      startResearch(env, nation, id);
    }
  }
}

export function stepTechMonth(stepEnv: TechEnv): TechEvent[] {
  // Completions come after every nation has researched: the shares of the
  // month hold for the whole step.
  const env = { ...stepEnv, shares: diffusionShares(stepEnv) };
  const { ctx, tech } = env;
  const events: TechEvent[] = [];
  // The AI fills its projects first.
  fillAiProjects(env);
  const completed: { nation: NationId; node: TechNode }[] = [];
  for (const nation of ctx.nationIds) {
    const mine = tech.nations[nation];
    if (mine === undefined) continue;
    // A branch project stops when the nation leaves the bloc.
    mine.projects = mine.projects.filter((p) => {
      const node = techNode(ctx, p.node);
      return node.bloc === undefined || ctx.blocsOf(nation).includes(node.bloc);
    });
    const points = researchPoints(env, nation);
    mine.pointsLastMonth = points;
    if (mine.projects.length === 0) continue;
    const share = points / mine.projects.length;
    for (const project of [...mine.projects]) {
      project.points += share;
      const node = techNode(ctx, project.node);
      if (
        project.points >= effectiveCost(env, node) &&
        monthsBetween(project.since, env.date) >= node.monthsMin
      ) {
        completed.push({ nation, node });
      }
    }
  }
  // Completions after every nation has researched: the diffusion discount
  // of the month is the same for all.
  for (const { nation, node } of completed) {
    const mine = tech.nations[nation];
    mine.projects = mine.projects.filter((p) => p.node !== node.id);
    const first = !ctx.nationIds.some((n) =>
      tech.nations[n]?.done.includes(node.id),
    );
    mine.done.push(node.id);
    applyCapacities(env, nation, node);
    events.push({
      type: "tech-completed",
      nation,
      params: { node: node.id, first: String(first) },
    });
  }
  syncTech(ctx, tech);
  return events;
}

// Share of the tier-1 trunk a nation has (the calibration metric).
export function tierShare(
  ctx: EconomyContext,
  tech: TechState,
  nation: NationId,
  tier: 1 | 2,
): number {
  const nodes = ctx.tech.filter((n) => n.tier === tier && n.bloc === undefined);
  const done = tech.nations[nation]?.done ?? [];
  return nodes.length === 0
    ? 0
    : nodes.filter((n) => done.includes(n.id)).length / nodes.length;
}
