import { NationId } from "../../data/schemas/common";
import { VeritableConfig } from "../../data/schemas/config";
import {
  DiplomacyState,
  EconomyState,
  ExileState,
  NationState,
} from "../../data/schemas/save";
import { relation } from "../diplomacy/diplomacy";

// Collapse, exile and last stand (J7c; DESIGN.md, section of the same name).
//
// A nation that loses its last tile becomes a government in exile. Its
// recognition R is the share of the world's GDP of the nations that
// recognize it: at first every nation but its annexer and those closer to
// the annexer than to it. Its support S is the share of the world's GDP of
// the nations at `supportRelation` or more with it and at most
// `supportAnnexerMax` with the annexer. R erodes by erosionPerMonth x (1 -
// S) a month, faster (x 1 + blocAcceleration x share of them) when the blocs
// it belonged to recognize the annexation: the recognizers least attached
// to it withdraw first, its supporters last. The exile lives on while
// R + S >= survivalThreshold; it is dissolved after dissolutionMonths in a
// row under it, or at once when nations weighing more than
// `annexationRecognized` of the world's GDP recognize the annexation: its
// annexer, and the nations that withdrew their recognition of the exile and
// are not hostile to the annexer — a nation that never recognized it is not
// counted until it says so (it may be closer to the annexer; it did not
// recognize an annexation that had not happened). The nations of the AI go
// through the same states.

export type ExileRules = VeritableConfig["exile"];

export interface ExileEnv {
  rules: ExileRules;
  diplomacy: DiplomacyState;
  economy: EconomyState;
  nations: readonly NationState[];
  // Full members of each bloc (the blocs a nation belonged to).
  blocsOf: (nation: NationId) => readonly string[];
  membersOf: (bloc: string) => readonly NationId[];
  date: string;
}

// The nations that count in the world's GDP of an exile: every nation not
// dissolved but the exile itself.
function weigh(env: ExileEnv, exile: NationId) {
  const gdp = new Map<NationId, number>();
  let total = 0;
  for (const n of env.nations) {
    if (n.id === exile || n.status === "dissolved") continue;
    const g = Math.max(0, env.economy.nations[n.id]?.gdp ?? 0);
    gdp.set(n.id, g);
    total += g;
  }
  return { gdp, total: Math.max(total, 1e-9) };
}

function supporter(
  env: ExileEnv,
  n: NationId,
  exile: NationId,
  annexer: NationId | null,
): boolean {
  if (n === annexer) return false;
  return (
    relation(env.diplomacy, n, exile) >= env.rules.supportRelation &&
    (annexer === null ||
      relation(env.diplomacy, n, annexer) <= env.rules.supportAnnexerMax)
  );
}

// R, S and the share that recognizes the annexation, now.
export function measureExile(
  env: ExileEnv,
  exile: NationId,
  state: ExileState,
): { recognition: number; support: number; annexation: number } {
  const { gdp, total } = weigh(env, exile);
  const recognizers = new Set(state.recognizers);
  const withdrawn = new Set(state.withdrawn);
  let r = 0;
  let s = 0;
  let a = 0;
  for (const [n, g] of gdp) {
    if (recognizers.has(n)) r += g;
    if (supporter(env, n, exile, state.annexer)) s += g;
    if (recognizesAnnexation(env, n, state, withdrawn)) a += g;
  }
  return { recognition: r / total, support: s / total, annexation: a / total };
}

// The annexer, and a nation that withdrew its recognition of the exile and
// is not hostile to the annexer.
function recognizesAnnexation(
  env: ExileEnv,
  n: NationId,
  state: ExileState,
  withdrawn: ReadonlySet<NationId>,
): boolean {
  if (state.annexer === null) return false;
  if (n === state.annexer) return true;
  return withdrawn.has(n) && relation(env.diplomacy, n, state.annexer) >= 0;
}

// A nation goes into exile: who recognizes it at first.
export function openExile(
  env: ExileEnv,
  exile: NationId,
  annexer: NationId | null,
): ExileState {
  const recognizers: NationId[] = [];
  for (const n of env.nations) {
    if (n.id === exile || n.id === annexer || n.status === "dissolved") {
      continue;
    }
    const toExile = relation(env.diplomacy, n.id, exile);
    const toAnnexer =
      annexer === null ? -Infinity : relation(env.diplomacy, n.id, annexer);
    if (toExile >= toAnnexer) recognizers.push(n.id);
  }
  recognizers.sort();
  const state: ExileState = {
    since: env.date,
    annexer,
    recognizers,
    withdrawn: [],
    recognition: 0,
    support: 0,
    annexation: 0,
    erosion: 0,
    belowMonths: 0,
    lastNegotiation: null,
    dissolvedAt: null,
  };
  Object.assign(state, measureExile(env, exile, state));
  return state;
}

// Share of the blocs the exile belonged to that recognize the annexation
// (more than half of their other members' GDP does).
function blocsRecognizing(
  env: ExileEnv,
  exile: NationId,
  state: ExileState,
): number {
  const blocs = env.blocsOf(exile);
  if (blocs.length === 0 || state.annexer === null) return 0;
  const withdrawn = new Set(state.withdrawn);
  let recognizing = 0;
  for (const bloc of blocs) {
    let total = 0;
    let annexation = 0;
    for (const m of env.membersOf(bloc)) {
      if (m === exile) continue;
      const g = Math.max(0, env.economy.nations[m]?.gdp ?? 0);
      total += g;
      if (recognizesAnnexation(env, m, state, withdrawn)) annexation += g;
    }
    if (total > 0 && annexation / total > 0.5) recognizing++;
  }
  return recognizing / blocs.length;
}

export type ExileOutcome =
  | { kind: "lives" }
  | { kind: "dissolved"; reason: "recognized" | "threshold" };

// `months` of an exile: recognition erodes, the recognizers withdraw, and
// the exile survives or is dissolved.
export function stepExile(
  env: ExileEnv,
  exile: NationId,
  state: ExileState,
  months: number,
): ExileOutcome {
  const rules = env.rules;
  // Nobody holds its land (a test world, land emptied): no annexation to
  // recognize, nothing erodes.
  if (state.annexer === null) return { kind: "lives" };
  const before = measureExile(env, exile, state);
  const speed =
    1 + rules.blocAcceleration * blocsRecognizing(env, exile, state);
  state.erosion +=
    rules.erosionPerMonth * (1 - before.support) * speed * months;
  // Withdrawals, the least attached first, the supporters last.
  const { gdp, total } = weigh(env, exile);
  const attachment = (n: NationId) =>
    (supporter(env, n, exile, state.annexer) ? 1000 : 0) +
    relation(env.diplomacy, n, exile) -
    (state.annexer === null ? 0 : relation(env.diplomacy, n, state.annexer));
  const order = [...state.recognizers].sort(
    (a, b) => attachment(a) - attachment(b) || (a < b ? -1 : 1),
  );
  const withdrawn = new Set<NationId>();
  for (const n of order) {
    const share = (gdp.get(n) ?? 0) / total;
    if (share > state.erosion) break;
    state.erosion -= share;
    withdrawn.add(n);
  }
  if (withdrawn.size > 0) {
    state.recognizers = state.recognizers.filter((n) => !withdrawn.has(n));
    state.withdrawn.push(...order.filter((n) => withdrawn.has(n)));
  }
  // Nothing left to erode: the rest waits.
  if (state.recognizers.length === 0) state.erosion = 0;
  Object.assign(state, measureExile(env, exile, state));
  if (state.recognition + state.support < rules.survivalThreshold) {
    state.belowMonths += months;
  } else {
    state.belowMonths = 0;
  }
  if (state.annexation > rules.annexationRecognized) {
    return { kind: "dissolved", reason: "recognized" };
  }
  if (state.belowMonths >= rules.dissolutionMonths) {
    return { kind: "dissolved", reason: "threshold" };
  }
  return { kind: "lives" };
}

// The stability an occupant loses to the resistance of the exiles whose land
// it holds: weight x their people it holds / its own, at most `cap`.
export function resistanceMalus(
  rules: ExileRules,
  occupied: number,
  held: number,
): number {
  if (occupied <= 0 || held <= 0) return 0;
  return Math.min(
    rules.resistance.cap,
    rules.resistance.weight * (occupied / held),
  );
}

// Does an annexer give the land back when asked (J7c)? The resistance
// weighs on it, it is weak, and it is isolated (sanctioned by enough of its
// partners): all three.
export function acceptsReturn(
  rules: ExileRules,
  resistance: number,
  stability: number,
  sanctionedShare: number,
): boolean {
  return (
    resistance >= rules.negotiation.resistanceMin &&
    stability <= rules.negotiation.stabilityMax &&
    sanctionedShare >= rules.negotiation.sanctionedMin
  );
}

// What the exile tells the journal.
export type ExileEvent =
  | {
      type: "exile-returned";
      nation: NationId;
      way: "liberation" | "collapse" | "negotiation";
      by: NationId;
      tiles: number;
    }
  | { type: "last-stand"; nation: NationId; from: NationId }
  // The player's negotiation, refused by the annexer.
  | { type: "exile-negotiation"; nation: NationId; by: NationId };
