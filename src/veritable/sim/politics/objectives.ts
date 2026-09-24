import { NationId } from "../../data/schemas/common";
import { Objective } from "../../data/schemas/politics";
import {
  DiplomacyState,
  NationEconomy,
  NationPolitics,
  PinnedObjective,
  PoliticsState,
} from "../../data/schemas/save";
import { Scenario } from "../../data/schemas/scenario";
import { EconomyContext } from "../economy/context";

// Objectives (J4): a catalogue of conditions evaluated once a month on the
// world; up to five pinned; completion is journaled, rewarded with political
// capital and legitimacy, and never undone.

export const MAX_PINNED_OBJECTIVES = 5;

export type ObjectiveEvent = {
  type: "objective-completed";
  nation: NationId;
  objective: string;
};

// What the conditions read.
export interface ObjectiveWorld {
  date: string;
  economy: NationEconomy;
  politics: NationPolitics;
  diplomacy: DiplomacyState;
  scenario: Scenario;
  // Claims of the nation (J6) and the tiles of each held by every nation.
  claims: {
    region: string;
    claimant: NationId;
    holders: Record<NationId, number>;
  }[];
  // Full members of a bloc (suspended ones excluded).
  blocMembers(bloc: string): readonly NationId[];
  monthsSince(date: string): number;
}

// The quantity an objective tracks at pinning time (its baseline).
export function objectiveBaseline(
  objective: Objective,
  world: ObjectiveWorld,
): number {
  const c = objective.condition;
  switch (c.kind) {
    case "gdp-ratio":
      return world.economy.gdp;
    case "win-election":
      return world.politics.electionsWon;
    default:
      return 0;
  }
}

// Progress in [0, 1]; 1 = achieved.
export function objectiveProgress(
  objective: Objective,
  pinned: PinnedObjective,
  nation: NationId,
  world: ObjectiveWorld,
): number {
  const c = objective.condition;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  switch (c.kind) {
    case "gdp-ratio": {
      const ratio =
        pinned.baseline > 0 ? world.economy.gdp / pinned.baseline : 0;
      return clamp((ratio - 1) / (c.value - 1));
    }
    case "join-bloc":
      return world.blocMembers(c.bloc).includes(nation) ? 1 : 0;
    case "stability-above":
    case "shortage-below": {
      // Progress counts the months in a row the condition held since the
      // pinning: the pinned record keeps it in `progress` scaled by the
      // required duration (a month that fails resets it).
      const ok =
        c.kind === "stability-above"
          ? world.politics.stability >= c.value
          : world.economy.shortage <= c.value;
      const months = c.years * 12;
      const held = Math.round(pinned.progress * months);
      return ok ? clamp((held + 1) / months) : 0;
    }
    // J6: the claims of the nation (its homeland aside) with their holders
    // read on the map; done when it holds one of them entirely.
    case "retake-region": {
      const claimed = world.claims.filter(
        (c) => c.claimant === nation && !c.region.startsWith("homeland:"),
      );
      if (claimed.length === 0) return 0;
      return clamp(
        Math.max(
          ...claimed.map((c) => {
            const total = Object.values(c.holders).reduce((a, b) => a + b, 0);
            return total > 0 ? (c.holders[nation] ?? 0) / total : 0;
          }),
        ),
      );
    }
    case "no-war": {
      const atWar = world.diplomacy.wars.some(
        (w) => w.aggressors.includes(nation) || w.defenders.includes(nation),
      );
      const months = c.years * 12;
      const held = Math.round(pinned.progress * months);
      return atWar ? 0 : clamp((held + 1) / months);
    }
    case "debt-below": {
      const debt = world.economy.debt / world.economy.gdp;
      return debt <= c.value ? 1 : clamp(1 - (debt - c.value));
    }
    case "self-sufficient": {
      const e = world.economy;
      const need = e.consumption[c.good];
      if (need <= 0) return 1;
      return clamp(e.production[c.good] / need);
    }
    case "legitimacy-above":
      return clamp(world.politics.legitimacy / c.value);
    case "win-election":
      return world.politics.electionsWon > pinned.baseline ? 1 : 0;
    case "export-share": {
      const e = world.economy;
      const value = e.exports[c.good] * 1; // volume share is what we have
      const total = Object.values(e.exports).reduce((s, v) => s + v, 0);
      if (total <= 0) return 0;
      return clamp(value / total / c.value);
    }
  }
}

export function stepObjectivesMonth(
  ctx: EconomyContext,
  nation: NationId,
  state: PoliticsState,
  world: ObjectiveWorld,
): ObjectiveEvent[] {
  const events: ObjectiveEvent[] = [];
  for (const pinned of state.player.objectives) {
    if (pinned.done) continue;
    const objective = ctx.objectives.find((o) => o.id === pinned.id);
    if (objective === undefined) continue;
    pinned.progress = objectiveProgress(objective, pinned, nation, world);
    if (pinned.progress >= 1 - 1e-9) {
      pinned.progress = 1;
      pinned.done = true;
      const politics = world.politics;
      politics.capital = Math.min(
        ctx.config.politics.capital.max,
        politics.capital + ctx.config.politics.capital.objectiveBonus,
      );
      politics.legitimacy = Math.min(
        1,
        politics.legitimacy + ctx.config.politics.legitimacy.objectiveBonus,
      );
      events.push({
        type: "objective-completed",
        nation,
        objective: pinned.id,
      });
    }
  }
  return events;
}

export function pinObjective(
  ctx: EconomyContext,
  state: PoliticsState,
  id: string,
  world: ObjectiveWorld,
): void {
  const objective = ctx.objectives.find((o) => o.id === id);
  if (objective === undefined) throw new Error(`unknown objective ${id}`);
  if (state.player.objectives.some((o) => o.id === id)) return;
  if (
    state.player.objectives.filter((o) => !o.done).length >=
    MAX_PINNED_OBJECTIVES
  ) {
    throw new Error("objectives: five already pinned");
  }
  state.player.objectives.push({
    id,
    since: world.date,
    baseline: objectiveBaseline(objective, world),
    progress: 0,
    done: false,
  });
}

export function unpinObjective(state: PoliticsState, id: string): void {
  state.player.objectives = state.player.objectives.filter(
    (o) => o.id !== id || o.done,
  );
}
