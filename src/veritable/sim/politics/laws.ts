import { NationId } from "../../data/schemas/common";
import { Law, LawEffect } from "../../data/schemas/laws";
import { SPENDING_POSTS, TAX_IDS } from "../../data/schemas/nation";
import { NationEconomy, NationPolitics } from "../../data/schemas/save";
import { ConscriptionLevel } from "../../data/schemas/war";
import { EconomyContext } from "../economy/context";
import { clamp01, insideWindow } from "./ideology";
import { addMonths } from "./state";

// Laws (J4): a catalogue by domain; each law has a political capital cost,
// an ideological window and effects applied once (at enactment) or while
// the law is in force. The government in place refuses a law outside its
// window and repeals, after a delay, those in force that fall outside it.
// Sliders (taxes, spending) have a progressive effect: the values in effect
// move towards their targets.

export type LawEvent =
  | { type: "law-enacted"; nation: NationId; law: string }
  | { type: "law-refused"; nation: NationId; law: string; reason: string }
  | { type: "law-repealed"; nation: NationId; law: string }
  | { type: "law-repeal-announced"; nation: NationId; law: string; at: string }
  | { type: "regime-changed"; nation: NationId; from: string; to: string };

// What the laws in force change, aggregated.
export interface LawModifiers {
  groups: Record<string, number>; // offset of the satisfaction target
  growthBase: number; // per year, added
  mediaControl: number | null; // set (highest), else null
  mediaControlAdd: number;
  pressFreedom: number;
  corruption: number;
  coupRisk: number; // multiplier
  conscriptionCeiling: ConscriptionLevel | null;
  manpowerBonus: number;
  electionIntervalMonths: number;
  legitimacyBase: number;
}

export function lawModifiers(
  ctx: EconomyContext,
  politics: NationPolitics,
): LawModifiers {
  const out: LawModifiers = {
    groups: {},
    growthBase: 0,
    mediaControl: null,
    mediaControlAdd: 0,
    pressFreedom: 0,
    corruption: 0,
    coupRisk: 1,
    conscriptionCeiling: null,
    manpowerBonus: 0,
    electionIntervalMonths: 0,
    legitimacyBase: 0,
  };
  const order: ConscriptionLevel[] = ["peace", "partial", "total"];
  for (const inForce of politics.laws) {
    const law = ctx.laws.find((l) => l.id === inForce.id);
    if (law === undefined) continue;
    for (const effect of law.effects) {
      if (effect.mode !== "while") continue;
      const value = typeof effect.value === "number" ? effect.value : 0;
      const target = effect.target;
      if (target.startsWith("groups.")) {
        const group = target.slice(7);
        out.groups[group] = (out.groups[group] ?? 0) + value;
      } else if (target === "growthBase") out.growthBase += value;
      else if (target === "mediaControl") {
        if (effect.op === "set") {
          out.mediaControl = Math.max(out.mediaControl ?? 0, value);
        } else out.mediaControlAdd += value;
      } else if (target === "pressFreedom") out.pressFreedom += value;
      else if (target === "corruption") out.corruption += value;
      else if (target === "coupRisk") {
        out.coupRisk *= effect.op === "mul" ? value : 1 + value;
      } else if (target === "conscriptionCeiling") {
        const level = effect.value as ConscriptionLevel;
        if (
          out.conscriptionCeiling === null ||
          order.indexOf(level) < order.indexOf(out.conscriptionCeiling)
        ) {
          out.conscriptionCeiling = level;
        }
      } else if (target === "manpowerBonus") out.manpowerBonus += value;
      else if (target === "electionIntervalMonths") {
        out.electionIntervalMonths += value;
      } else if (target === "legitimacyBase") out.legitimacyBase += value;
    }
  }
  return out;
}

// Press freedom and media control in effect: the regime's structural values
// plus the laws in force.
export function applyMediaModifiers(
  ctx: EconomyContext,
  politics: NationPolitics,
  modifiers: LawModifiers = lawModifiers(ctx, politics),
): void {
  const regime = ctx.regime(politics.regime);
  politics.pressFreedom = clamp01(regime.pressFreedom + modifiers.pressFreedom);
  politics.mediaControl = clamp01(
    (modifiers.mediaControl ?? regime.mediaControl) + modifiers.mediaControlAdd,
  );
}

export function lawInForce(politics: NationPolitics, id: string): boolean {
  return politics.laws.some((l) => l.id === id);
}

// Why a law cannot be enacted now, or null.
export function enactmentRefusal(
  ctx: EconomyContext,
  politics: NationPolitics,
  law: Law,
): string | null {
  const regime = ctx.regime(politics.regime);
  if (lawInForce(politics, law.id)) return "in-force";
  if (!law.regimes.includes(politics.regime)) return "regime";
  if (!regime.lawDomains.includes(law.domain)) return "domain";
  if (!insideWindow(law.window, politics.government.ideology)) return "window";
  if (
    law.requiresLegitimacy !== undefined &&
    politics.legitimacy < law.requiresLegitimacy
  ) {
    return "legitimacy";
  }
  if (politics.capital < law.capitalCost) return "capital";
  return null;
}

// Effects applied once, at enactment. Some reach beyond the nation (the
// relations with the democracies) or beyond politics (a regime change):
// they are returned for the simulation to apply.
export interface OnceEffects {
  democracyRelations: number;
  regime: string | null;
}

function applyOnce(
  ctx: EconomyContext,
  politics: NationPolitics,
  economy: NationEconomy,
  effects: readonly LawEffect[],
  sign: 1 | -1 = 1,
): OnceEffects {
  const out: OnceEffects = { democracyRelations: 0, regime: null };
  for (const effect of effects) {
    if (effect.mode !== "once") continue;
    const value = typeof effect.value === "number" ? effect.value * sign : 0;
    const target = effect.target;
    if (target === "legitimacy") {
      politics.legitimacy = clamp01(politics.legitimacy + value);
    } else if (target === "relations.democracies") {
      out.democracyRelations += value;
    } else if (target === "capital") {
      politics.capital = Math.max(
        0,
        Math.min(ctx.config.politics.capital.max, politics.capital + value),
      );
    } else if (target.startsWith("groups.")) {
      const group = target.slice(7);
      if (politics.groups !== null && group in politics.groups) {
        politics.groups[group] = clamp01(politics.groups[group] + value);
      } else if (politics.groups === null) {
        politics.opinion = clamp01(politics.opinion + value * 0.25);
      }
    } else if (target.startsWith("spending.")) {
      const post = target.slice(9) as (typeof SPENDING_POSTS)[number];
      economy.spendingTargets[post] = Math.max(
        0,
        Math.min(
          ctx.config.budget.maxSpendingShare,
          economy.spendingTargets[post] + value,
        ),
      );
    } else if (target.startsWith("taxes.")) {
      const tax = target.slice(6) as (typeof TAX_IDS)[number];
      economy.taxTargets[tax] = Math.max(
        0,
        Math.min(
          ctx.config.budget.maxTaxRate[tax],
          economy.taxTargets[tax] + value,
        ),
      );
    } else if (target === "regime" && effect.op === "set" && sign === 1) {
      out.regime = String(effect.value);
    }
  }
  return out;
}

export function enactLaw(
  ctx: EconomyContext,
  nation: NationId,
  politics: NationPolitics,
  economy: NationEconomy,
  law: Law,
  date: string,
): { events: LawEvent[]; once: OnceEffects } {
  const refusal = enactmentRefusal(ctx, politics, law);
  if (refusal !== null) {
    return {
      events: [{ type: "law-refused", nation, law: law.id, reason: refusal }],
      once: { democracyRelations: 0, regime: null },
    };
  }
  politics.capital -= law.capitalCost;
  politics.laws.push({ id: law.id, since: date });
  politics.repealing = politics.repealing.filter((r) => r.id !== law.id);
  const once = applyOnce(ctx, politics, economy, law.effects);
  const events: LawEvent[] = [{ type: "law-enacted", nation, law: law.id }];
  if (once.regime !== null && once.regime !== politics.regime) {
    events.push({
      type: "regime-changed",
      nation,
      from: politics.regime,
      to: once.regime,
    });
    changeRegime(ctx, politics, once.regime, date);
  }
  applyMediaModifiers(ctx, politics);
  return { events, once };
}

// The player repeals a law in force: costs the reversal, unless the law is
// irreversible.
export function repealLaw(
  ctx: EconomyContext,
  nation: NationId,
  politics: NationPolitics,
  law: Law,
  byPlayer: boolean,
): LawEvent[] {
  if (!lawInForce(politics, law.id)) return [];
  if (byPlayer) {
    if (law.reversible === null) {
      return [
        { type: "law-refused", nation, law: law.id, reason: "irreversible" },
      ];
    }
    if (politics.capital < law.reversible.cost) {
      return [{ type: "law-refused", nation, law: law.id, reason: "capital" }];
    }
    politics.capital -= law.reversible.cost;
  }
  politics.laws = politics.laws.filter((l) => l.id !== law.id);
  politics.repealing = politics.repealing.filter((r) => r.id !== law.id);
  applyMediaModifiers(ctx, politics);
  return [{ type: "law-repealed", nation, law: law.id }];
}

// A regime change (reform, coup, revolution): the structural values of the
// new regime; the election calendar follows.
export function changeRegime(
  ctx: EconomyContext,
  politics: NationPolitics,
  to: string,
  date: string,
): void {
  const regime = ctx.regime(to);
  politics.regime = regime.id;
  if (regime.electionIntervalMonths === null) {
    politics.nextElection = null;
  } else if (politics.nextElection === null) {
    politics.nextElection = addMonths(date, regime.electionIntervalMonths);
  }
  // Laws the new regime does not allow go at once.
  politics.laws = politics.laws.filter((l) => {
    const law = ctx.laws.find((x) => x.id === l.id);
    return law === undefined || law.regimes.includes(regime.id);
  });
  applyMediaModifiers(ctx, politics);
}

// Laws in force outside the government's window: scheduled for repeal after
// the delay (once). Returns what was newly scheduled.
export function scheduleRepeals(
  ctx: EconomyContext,
  politics: NationPolitics,
  date: string,
): { id: string; at: string }[] {
  const scheduled: { id: string; at: string }[] = [];
  const at = addMonths(date, ctx.config.politics.laws.repealDelayMonths);
  for (const inForce of politics.laws) {
    const law = ctx.laws.find((l) => l.id === inForce.id);
    if (law === undefined) continue;
    if (insideWindow(law.window, politics.government.ideology)) continue;
    if (politics.repealing.some((r) => r.id === law.id)) continue;
    politics.repealing.push({ id: law.id, at });
    scheduled.push({ id: law.id, at });
  }
  return scheduled;
}

// Monthly: announced repeals fall due; laws back inside the window are
// spared.
export function stepLawsMonth(
  ctx: EconomyContext,
  nation: NationId,
  politics: NationPolitics,
  date: string,
): LawEvent[] {
  const events: LawEvent[] = [];
  for (const pending of [...politics.repealing]) {
    const law = ctx.laws.find((l) => l.id === pending.id);
    if (law === undefined || !lawInForce(politics, pending.id)) {
      politics.repealing = politics.repealing.filter((r) => r !== pending);
      continue;
    }
    if (insideWindow(law.window, politics.government.ideology)) {
      politics.repealing = politics.repealing.filter((r) => r !== pending);
      continue;
    }
    if (date < pending.at) continue;
    events.push(...repealLaw(ctx, nation, politics, law, false));
  }
  return events;
}

// Sliders with a progressive effect: the values in effect move towards their
// targets, closing (1 / rampMonths) of the gap every month.
export function stepSliders(ctx: EconomyContext, economy: NationEconomy): void {
  const ramp = ctx.config.politics.laws.rampMonths;
  for (const tax of TAX_IDS) {
    economy.taxes[tax] += (economy.taxTargets[tax] - economy.taxes[tax]) / ramp;
  }
  for (const post of SPENDING_POSTS) {
    economy.spending[post] +=
      (economy.spendingTargets[post] - economy.spending[post]) / ramp;
  }
}
