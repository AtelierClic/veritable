import { vt } from "../data/i18n";
import { EventEffect } from "../data/schemas/event";
import { Names } from "./journalText";

// The effects of an event as the Events screen and the event cards show
// them (J5; shared with the cards at the J7).
export function effectLabel(
  names: Names,
  effect: EventEffect,
  other: string | null,
  grievanceMonths: number,
): string {
  const [head, tail] = effect.target.split(".");
  const signed = (v: number, digits = 2) =>
    `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
  const who = (t: string) =>
    t === "all"
      ? vt("screen.events.who.all")
      : t === "neighbors"
        ? vt("screen.events.who.neighbors")
        : t === "other"
          ? other === null
            ? ""
            : names.nation(other)
          : names.nation(t);
  let label: string;
  switch (head) {
    case "budget":
      label = vt("screen.events.effect.budget", {
        value: signed(effect.value * 100),
      });
      break;
    case "gdp":
    case "production":
    case "consumption":
      label = vt(`screen.events.effect.${head}`, {
        good: tail === undefined ? "" : vt(`good.${tail}`),
        value: `×${effect.value.toFixed(2)}`,
      });
      break;
    case "worldSupply":
      label = vt("screen.events.effect.worldSupply", {
        good: vt(`good.${tail}`),
        value: signed(effect.value * 100, 0),
      });
      break;
    case "growth":
      label = vt("screen.events.effect.growth", {
        value: signed(effect.value * 100),
        months: effect.months ?? 12,
      });
      break;
    case "group":
      label = vt("screen.events.effect.group", {
        group: vt(`group.${tail}`),
        value: signed(effect.value),
      });
      break;
    case "spending":
      label = vt("screen.events.effect.spending", {
        post: vt(`spending.${tail}`),
        value: signed(effect.value * 100),
      });
      break;
    case "relations":
      label = vt("screen.events.effect.relations", {
        who: who(tail),
        value: signed(effect.value, 0),
      });
      break;
    case "grievance":
      label = vt("screen.events.effect.grievance", {
        who: who(tail),
        months: effect.months ?? grievanceMonths,
      });
      break;
    case "unrest":
      label = vt("screen.events.effect.unrest");
      break;
    case "law":
      label = vt("screen.events.effect.law", { law: vt(`law.${tail}.name`) });
      break;
    default:
      label = vt(`screen.events.effect.${head}`, {
        value: signed(effect.value),
      });
  }
  return effect.uncertain === true
    ? `${label} ${vt("screen.events.uncertain")}`
    : label;
}

// The parameters of the texts of an event instance.
export function eventParams(
  names: Names,
  i: { nation: string; other: string | null; good: string | null },
): Record<string, string> {
  return {
    nation: names.nation(i.nation),
    other: i.other === null ? "" : names.nation(i.other),
    good: i.good === null ? "" : vt(`good.${i.good}`),
  };
}
