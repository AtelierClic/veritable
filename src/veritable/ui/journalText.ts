import { vt } from "../data/i18n";
import { ReadonlyWorldView } from "../sim/VeritableSim";

// The names the journal keeps as the simulation wrote them (J6c): a leader
// as its i18n key or, for a generated one, its literal name; a party as its
// id. What the journal shows.

export function leaderName(value: string): string {
  return value.startsWith("leader.") ? vt(value) : value;
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

// The parameters of an entry with its names translated.
export function namedParams(
  view: ReadonlyWorldView,
  nation: string | undefined,
  params: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (params.leader !== undefined) out.leader = leaderName(params.leader);
  if (params.winner !== undefined) {
    out.winner = partyName(view, nation, params.winner);
  }
  if (params.parties !== undefined) {
    out.parties = params.parties
      .split(", ")
      .map((id) => partyName(view, nation, id))
      .join(", ");
  }
  if (params.event !== undefined) out.decided = decidedBy(view, nation, params);
  return out;
}

// Who took the choice of an event (J7): " Décidé par vous.", " Décidé par
// le gouvernement (parti).", nothing for another nation or an old entry.
export function decidedBy(
  view: ReadonlyWorldView,
  nation: string | undefined,
  params: Readonly<Record<string, string>>,
): string {
  if (params.by === "player") return ` ${vt("journal.decided.player")}`;
  if (params.by !== "government") return "";
  return params.party === undefined || params.party === ""
    ? ` ${vt("journal.decided.government")}`
    : ` ${vt("journal.decided.government-party", {
        party: partyName(view, nation, params.party),
      })}`;
}
