import { hasTextKey, vt } from "../data/i18n";
import { JournalEntry } from "../data/schemas/save";
import { ReadonlyWorldView } from "../sim/VeritableSim";

// The names the journal keeps as the simulation wrote them (J6c): a leader
// as its i18n key or, for a generated one, its literal name; a party as its
// id. What the journal shows. J7: one line of the journal, the same in the
// journal screen, the campaign panel and the event cards.

export function leaderName(value: string): string {
  return value.startsWith("leader.") ? vt(value) : value;
}

// How the names of nations and parties are found: from a full view, or,
// for the cards (which read no full view), from the catalogue.
export interface Names {
  nation(id: string): string;
  party(nation: string | undefined, id: string): string;
}

export function partyName(
  view: ReadonlyWorldView,
  nation: string | undefined,
  id: string,
): string {
  const own =
    nation === undefined
      ? undefined
      : view.politics[nation]?.parties.find((p) => p.id === id);
  const party =
    own ??
    Object.values(view.politics)
      .flatMap((p) => p.parties)
      .find((p) => p.id === id);
  if (party === undefined) return id;
  return party.name.kind === "key" ? vt(party.name.key) : party.name.text;
}

export function viewNames(view: ReadonlyWorldView): Names {
  return {
    nation: (id) => {
      const nation = view.nations.find((n) => n.id === id);
      if (nation === undefined) return id;
      return nation.name.kind === "key"
        ? vt(nation.name.key)
        : nation.name.text;
    },
    party: (nation, id) => partyName(view, nation, id),
  };
}

export function catalogueNames(): Names {
  const key = (k: string, fallback: string) =>
    hasTextKey(k) ? vt(k) : fallback;
  return {
    nation: (id) => key(`nation.${id.toLowerCase()}.name`, id),
    party: (_nation, id) => key(`party.${id}`, id),
  };
}

// The parameters of an entry with its names translated.
export function namedParams(
  view: ReadonlyWorldView,
  nation: string | undefined,
  params: Readonly<Record<string, string>>,
): Record<string, string> {
  return named(viewNames(view), nation, params);
}

function named(
  names: Names,
  nation: string | undefined,
  params: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (params.leader !== undefined) out.leader = leaderName(params.leader);
  if (params.winner !== undefined) {
    out.winner = names.party(nation, params.winner);
  }
  if (params.parties !== undefined) {
    out.parties = params.parties
      .split(", ")
      .map((id) => names.party(nation, id))
      .join(", ");
  }
  if (params.event !== undefined) {
    out.decided = decided(names, nation, params);
  }
  return out;
}

// Who took the choice of an event (J7): " Décidé par vous.", " Décidé par
// le gouvernement (parti).", nothing for another nation or an old entry.
export function decidedBy(
  view: ReadonlyWorldView,
  nation: string | undefined,
  params: Readonly<Record<string, string>>,
): string {
  return decided(viewNames(view), nation, params);
}

function decided(
  names: Names,
  nation: string | undefined,
  params: Readonly<Record<string, string>>,
): string {
  if (params.by === "player") return ` ${vt("journal.decided.player")}`;
  if (params.by !== "government") return "";
  return params.party === undefined || params.party === ""
    ? ` ${vt("journal.decided.government")}`
    : ` ${vt("journal.decided.government-party", {
        party: names.party(nation, params.party),
      })}`;
}

// A measure of a bloc as the journal and the screens name it.
export function measureName(
  names: Names,
  kind: string,
  target: string | undefined | null,
  direction: string | undefined | null,
): string {
  if (kind === "budget") {
    return vt(`bloc.measure.budget-${direction === "down" ? "down" : "up"}`);
  }
  return vt(`bloc.measure.${kind}`, {
    target:
      target === undefined || target === null || target === ""
        ? ""
        : names.nation(target),
  });
}

// A region of the scenario, or the homeland of a nation (J6).
export function regionName(names: Names, region: string): string {
  if (region.startsWith("homeland:")) {
    return vt("region.homeland", {
      nation: names.nation(region.slice("homeland:".length)),
    });
  }
  return vt(`region.${region}`);
}

// Counts shown with their thousands (J7: the months of a war).
const GROUPED = ["tiles", "losses", "lossesAgainst"] as const;
const INTEGER = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

// One line of the journal, without its date.
export function journalLine(names: Names, j: JournalEntry): string {
  const p = j.params;
  const nationOr = (id: string | undefined) =>
    id === undefined || id === "" ? "" : names.nation(id);
  const params: Record<string, string> = {
    ...p,
    ...named(names, j.nation, p),
    nation:
      j.nation === undefined
        ? ""
        : j.kind === "yearly-summary"
          ? ` — ${names.nation(j.nation)}`
          : names.nation(j.nation),
  };
  if (j.kind === "yearly-summary") {
    params.category = vt(`journal.category.${p.category}`);
  }
  if (j.kind === "nation-status") {
    if (p.from !== undefined) params.from = vt(`nation.status.${p.from}`);
    if (p.to !== undefined) params.to = vt(`nation.status.${p.to}`);
  } else if (j.kind === "regime-changed" || j.kind === "civilian-transition") {
    if (p.from !== undefined) params.from = vt(`regime.${p.from}`);
    if (p.to !== undefined) params.to = vt(`regime.${p.to}`);
  } else if (p.to !== undefined) {
    params.to = nationOr(p.to);
  }
  for (const key of GROUPED) {
    const v = p[key];
    if (v !== undefined && /^\d+$/.test(v))
      params[key] = INTEGER.format(Number(v));
  }
  if (p.law !== undefined) params.law = vt(`law.${p.law}.name`);
  if (p.objective !== undefined) {
    params.objective = vt(`objective.${p.objective}.name`);
  }
  if (p.alternation !== undefined) {
    params.alternation = vt(`alternation.${p.alternation}`);
  }
  if (p.reason !== undefined) {
    params.reason =
      j.kind === "sanctions-lifted"
        ? vt(`journal.lift-reason.${p.reason}`)
        : vt(`law.reason.${p.reason}`);
  } else if (j.kind === "sanctions-lifted") {
    params.reason = "";
  }
  if (p.aim !== undefined) params.aim = vt(`screen.nuclear.aim-${p.aim}`);
  if (p.target !== undefined) params.target = nationOr(p.target);
  if (p.by !== undefined && p.event === undefined) params.by = nationOr(p.by);
  if (p.against !== undefined) params.against = nationOr(p.against);
  if (p.bloc !== undefined) params.bloc = vt(`bloc.${p.bloc}.name`);
  if (p.region !== undefined) params.region = regionName(names, p.region);
  if (p.kind !== undefined) {
    params.kind = measureName(names, p.kind, p.target, p.direction);
  }
  if (p.result !== undefined) params.result = vt(`bloc.result.${p.result}`);
  if (p.why !== undefined) params.why = vt(`bloc.why.${p.why}`);
  if (p.node !== undefined) params.node = vt(`tech.${p.node}.name`);
  if (p.event !== undefined) {
    const context = {
      nation: nationOr(j.nation),
      other: nationOr(p.other),
      good: p.good === undefined || p.good === "" ? "" : vt(`good.${p.good}`),
    };
    params.event = vt(`event.${p.event}.title`, context);
    params.choice =
      p.choice === undefined || p.choice === ""
        ? vt("screen.events.no-choice")
        : vt(`event.${p.event}.${p.choice}`, context);
  }
  return vt(`journal.${j.kind}`, params);
}
