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
  return out;
}
