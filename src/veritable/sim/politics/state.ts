import { INTEREST_GROUPS, NationId } from "../../data/schemas/common";
import { NationData } from "../../data/schemas/nation";
import { Ideology } from "../../data/schemas/politics";
import {
  ActorState,
  NationPolitics,
  PartyState,
  PoliticsState,
} from "../../data/schemas/save";
import { EconomyContext } from "../economy/context";
import { debtHealthOf } from "../economy/init";
import { Rng } from "../rng";
import { formGovernment } from "./elections";
import { meanIdeology } from "./ideology";
import { actorFromData, generateActor } from "./leaders";

// The political state of a nation on the first day (J4): regime of the
// sheet, legitimacy at the base of the regime, the actors and parties of
// leaders/<iso3>.json, the government formed from the head of government's
// party, the next election from the last real one.

function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(Math.min(d, 28))}`;
}
export { addMonths };

export function initNationPolitics(
  ctx: EconomyContext,
  rng: Rng,
  sheet: NationData,
  isPlayer: boolean,
  date: string,
): NationPolitics {
  const cfg = ctx.config.politics;
  const s = cfg.stability;
  const regime = ctx.regime(sheet.regime);
  const data = ctx.leaders(sheet.id);
  const debtHealth = debtHealthOf(ctx, sheet.debtToGdp.value);

  // Parties, each with its leader (generated when the data has none).
  const parties: PartyState[] = [];
  for (const party of data?.parties ?? []) {
    const leaderData = data!.actors.find((a) => a.id === party.leader);
    const leader =
      leaderData !== undefined
        ? actorFromData(ctx, leaderData)
        : generateActor(
            ctx,
            rng,
            sheet.id,
            "party-leader",
            party.id,
            party.ideology,
            regime,
            date,
            `${party.id}-leader`,
          );
    parties.push({
      id: party.id,
      name: { kind: "key", key: party.name },
      ideology: { ...party.ideology },
      support: party.support,
      base: 1, // fitted once the parties are known (fitPartyBases)
      leader,
    });
  }
  if (parties.length === 0) {
    // A nation without party data: one party of the regime's colour.
    const ideology: Ideology = { economic: 0, authority: 0, sovereignty: 0 };
    const id = `${sheet.id.toLowerCase()}-state`;
    parties.push({
      id,
      name: { kind: "key", key: "party.generic" },
      ideology,
      support: 1,
      base: 1,
      leader: generateActor(
        ctx,
        rng,
        sheet.id,
        "party-leader",
        id,
        ideology,
        regime,
        date,
        `${id}-leader`,
      ),
    });
  }

  // The leader in play: the head of state where the state is presidential
  // or appointed, the head of government otherwise (a monarch reigns, the
  // prime minister governs).
  const heads = (data?.actors ?? []).map((a) => actorFromData(ctx, a));
  const headOfState = heads.find((a) => a.role === "head-of-state");
  const headOfGovernment = heads.find((a) => a.role === "head-of-government");
  const presidential =
    regime.id === "presidential" ||
    regime.id === "semi-presidential" ||
    regime.id === "electoral-authoritarian" ||
    regime.government === "appointed";
  let leader: ActorState | undefined = presidential
    ? (headOfState ?? headOfGovernment)
    : (headOfGovernment ?? headOfState);
  const rulingParty =
    parties.find((p) => p.id === (headOfGovernment?.party ?? leader?.party)) ??
    parties[0];
  leader ??= rulingParty.leader;

  const government = formGovernment(ctx, regime, parties, rulingParty.id);
  return {
    groups: isPlayer
      ? Object.fromEntries(INTEREST_GROUPS.map((g) => [g, 0.5]))
      : null,
    opinion: 0.5,
    stability:
      s.opinion * 0.5 +
      s.shortage * 1 +
      s.debt * debtHealth +
      s.legitimacy * regime.legitimacyBase,
    unrest: false,
    reprimanded: false,
    deficitBreachMonths: 0,
    reprimandMalus: 0,
    regime: regime.id,
    legitimacy: regime.legitimacyBase,
    capital: cfg.elections.newGovernmentCapital,
    corruption: leader.traits.corruption,
    pressFreedom: regime.pressFreedom,
    mediaControl: regime.mediaControl,
    leader,
    parties,
    government: {
      parties: government.parties,
      since: date,
      ideology: government.ideology,
    },
    nextElection:
      regime.electionIntervalMonths === null
        ? null
        : addMonths(
            sheet.politics.lastElection,
            sheet.politics.electionIntervalMonths,
          ),
    lastElection: null,
    electionsSuspended: false,
    levers: { propagandaPctGdp: 0, fraud: 0, clientelism: null },
    laws: [],
    repealing: [],
    lowStabilityMonths: 0,
    fraudCoupUntil: null,
    coupRisk: 0,
    groupIdeologies: {
      ...(sheet.politics.groupIdeologies ?? cfg.groupIdeologies),
    },
    alternations: 0,
    coups: 0,
    revolutions: 0,
    electionsWon: 0,
    suspendedFrom: [],
    regimeSince: date,
    regimeBefore: null,
  };
}

export function initPoliticsState(
  ctx: EconomyContext,
  rng: Rng,
  nations: readonly NationData[],
  playerNation: NationId | null,
  autopilot: boolean,
  date: string,
): PoliticsState {
  return {
    nations: Object.fromEntries(
      nations.map((n) => [
        n.id,
        initNationPolitics(ctx, rng, n, n.id === playerNation, date),
      ]),
    ),
    autopilot,
    player: { objectives: [], notes: [] },
  };
}

// Ideology of the government of a nation (for the relations).
export function governmentIdeology(politics: NationPolitics): Ideology {
  return politics.government.ideology;
}

// Mean ideology of a set of parties weighted by their support.
export function partiesIdeology(parties: readonly PartyState[]): Ideology {
  return meanIdeology(
    parties.map((p) => ({ ideology: p.ideology, weight: p.support })),
  );
}
