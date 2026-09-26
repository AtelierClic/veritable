import { NationId } from "../data/schemas/common";
import { VeritableConfig } from "../data/schemas/config";
import { ScheduleState } from "../data/schemas/save";
import { MINUTES_PER_GAME_DAY } from "./calendar";

// The rolling queue of the nations (J7). No tick carries the whole world:
// every nation is updated on its own cadence (economy, budget, opinion,
// stability, politics, military, research, diplomacy, AI), the time
// elapsed since its last update integrated by each domain.
//
//   the player's nation                          every playerDays (a day)
//   a nation dealing with it (land neighbour,
//   enemy, member of a common bloc)              every interactionDays at most
//   a nation with stakes (war, crisis, a dispute
//   with the player, an election soon)          every stakesDays
//   the others                                   every calmDays
//
// The first updates are spread over the period; at most maxUpdatesPerTick
// updates a tick, the others wait for the next tick (their elapsed time
// grows by as much). Everything is in elapsed game minutes, aligned on the
// core ticks.

export interface CadenceFacts {
  player: NationId | null;
  // A war, a crisis, a dispute with the player, an election soon.
  stakes(id: NationId): boolean;
  // A land neighbour of the player, at war with it, or in a bloc with it.
  interacts(id: NationId): boolean;
}

export function cadenceDays(
  config: VeritableConfig,
  id: NationId,
  facts: CadenceFacts,
): number {
  const cfg = config.schedule;
  if (id === facts.player) return cfg.playerDays;
  let days = facts.stakes(id) ? cfg.stakesDays : cfg.calmDays;
  if (facts.interacts(id)) days = Math.min(days, cfg.interactionDays);
  return days;
}

function alignUp(minutes: number, tick: number): number {
  return Math.ceil(minutes / tick) * tick;
}

// The first day: nation i of n is first updated at (i + 0.5) / n of its
// period (the player half a day in, away from the daily work of the first
// tick of the day).
export function initSchedule(
  ids: readonly NationId[],
  startMinutes: number,
  cadence: (id: NationId) => number,
  tickMinutes: number,
  player: NationId | null,
): ScheduleState {
  const nations: ScheduleState["nations"] = {};
  const others = ids.filter((id) => id !== player);
  others.forEach((id, i) => {
    const period = cadence(id) * MINUTES_PER_GAME_DAY;
    const offset = ((i + 0.5) / others.length) * period;
    nations[id] = {
      last: startMinutes,
      next: alignUp(startMinutes + Math.max(tickMinutes, offset), tickMinutes),
      drift: startMinutes,
    };
  });
  if (player !== null && ids.includes(player)) {
    nations[player] = {
      last: startMinutes,
      next: alignUp(startMinutes + MINUTES_PER_GAME_DAY / 2, tickMinutes),
      drift: startMinutes,
    };
  }
  // Records in the order of the ids: key order is part of the bytes.
  return {
    nations: Object.fromEntries(ids.map((id) => [id, nations[id]])),
  };
}

// The nations due at `now`, the longest overdue first (then the order of
// the ids), at most `max`.
export function dueNations(
  schedule: ScheduleState,
  ids: readonly NationId[],
  now: number,
  max: number,
): NationId[] {
  const due: { id: NationId; next: number; k: number }[] = [];
  ids.forEach((id, k) => {
    const clock = schedule.nations[id];
    if (clock !== undefined && clock.next <= now) {
      due.push({ id, next: clock.next, k });
    }
  });
  if (due.length > max) due.sort((a, b) => a.next - b.next || a.k - b.k);
  return due.slice(0, max).map((d) => d.id);
}

// After an update at `now`: the next one a cadence later.
export function reschedule(
  schedule: ScheduleState,
  id: NationId,
  now: number,
  days: number,
  tickMinutes: number,
): void {
  const clock = schedule.nations[id];
  schedule.nations[id] = {
    last: now,
    next: alignUp(now + days * MINUTES_PER_GAME_DAY, tickMinutes),
    drift: clock?.drift ?? now,
  };
}

// Brings an update forward: the nation is updated within `days` at the
// latest (an event, a war, a crisis gives it stakes).
export function hasten(
  schedule: ScheduleState,
  id: NationId,
  now: number,
  days: number,
  tickMinutes: number,
): void {
  const clock = schedule.nations[id];
  if (clock === undefined) return;
  const by = alignUp(now + days * MINUTES_PER_GAME_DAY, tickMinutes);
  if (clock.next > by) clock.next = by;
}
