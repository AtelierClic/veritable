import { NationId } from "../../data/schemas/common";
import { ActorData, ActorRole, Traits } from "../../data/schemas/leaders";
import { Ideology, RegimeData } from "../../data/schemas/politics";
import { ActorState, NationPolitics } from "../../data/schemas/save";
import { EconomyContext } from "../economy/context";
import { Rng } from "../rng";
import { clamp01, clampAxis } from "./ideology";

// Leaders (J4): actors from the data, generated successors, ageing.

export function actorFromData(
  ctx: EconomyContext,
  data: ActorData,
): ActorState {
  return {
    id: data.id,
    name: { kind: "key", key: data.names[ctx.config.leaderNames] },
    born: data.born,
    party: data.party,
    role: data.role,
    traits: { ...data.traits },
  };
}

// Yearly probability that a leader of `age` dies (J5: about 7 % at 80),
// drawn once a month (divided by 12).
export function yearlyDeathProbability(
  cfg: EconomyContext["config"]["politics"]["leaders"],
  age: number,
): number {
  return (
    cfg.deathBase * Math.exp(cfg.deathExponent * (age - cfg.deathAgeOffset))
  );
}

export function ageAt(born: string, date: string): number {
  const [by, bm, bd] = born.split("-").map(Number);
  const [y, m, d] = date.split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

// Traits of a political actor derived from an ideology: aggressiveness
// rises with authority and sovereignty; corruption follows the regime;
// charisma and competence sit around the middle. `noise` (sd of a Gaussian
// draw) is 0 in the ingest tool, config.politics.leaders.traitNoise in play.
export function traitsFromIdeology(
  ideology: Ideology,
  regimeLegitimacyBase: number,
  noise: number,
  rng: Rng | null,
): Traits {
  const jitter = () =>
    rng === null || noise === 0 ? 0 : rng.nextGaussian() * noise;
  return {
    economic: clampAxis(ideology.economic + jitter()),
    authority: clampAxis(ideology.authority + jitter()),
    sovereignty: clampAxis(ideology.sovereignty + jitter()),
    aggressiveness: clamp01(
      0.3 + 0.2 * ideology.authority + 0.2 * ideology.sovereignty + jitter(),
    ),
    corruption: clamp01(0.5 * (1 - regimeLegitimacyBase) + jitter()),
    charisma: clamp01(0.5 + jitter()),
    competence: clamp01(0.5 + jitter()),
  };
}

// A new actor with a literal name drawn from the nation's pool.
export function generateActor(
  ctx: EconomyContext,
  rng: Rng,
  nation: NationId,
  role: ActorRole,
  party: string | null,
  ideology: Ideology,
  regime: RegimeData,
  date: string,
  id: string,
): ActorState {
  const cfg = ctx.config.politics.leaders;
  const pool = ctx.names(nation);
  const first =
    pool === undefined ? "" : pool.first[rng.nextInt(0, pool.first.length)];
  const last =
    pool === undefined ? id : pool.last[rng.nextInt(0, pool.last.length)];
  const age = Math.max(
    30,
    Math.round(cfg.successorAge + rng.nextGaussian() * 8),
  );
  const year = Number(date.slice(0, 4)) - age;
  const month = 1 + rng.nextInt(0, 12);
  const day = 1 + rng.nextInt(0, 28);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    id,
    name: { kind: "literal", text: `${first} ${last}`.trim() },
    born: `${year}-${pad(month)}-${pad(day)}`,
    party,
    role,
    traits: traitsFromIdeology(
      ideology,
      regime.legitimacyBase,
      cfg.traitNoise,
      rng,
    ),
  };
}

export type LeaderEvent =
  | { type: "leader-died"; nation: NationId; leader: string }
  | { type: "leader-succeeded"; nation: NationId; leader: string };

// Monthly: the leader may die of old age; the regime names a successor.
export function stepLeaderAgeing(
  ctx: EconomyContext,
  rng: Rng,
  nation: NationId,
  politics: NationPolitics,
  date: string,
): LeaderEvent[] {
  const age = ageAt(politics.leader.born, date);
  const yearly = yearlyDeathProbability(ctx.config.politics.leaders, age);
  if (rng.next() >= Math.min(1, yearly / 12)) return [];
  const dead = politics.leader;
  const events: LeaderEvent[] = [
    { type: "leader-died", nation, leader: nameOf(dead) },
  ];
  const successor = successorOf(ctx, rng, nation, politics, date);
  politics.leader = successor;
  politics.corruption = successor.traits.corruption;
  events.push({ type: "leader-succeeded", nation, leader: nameOf(successor) });
  return events;
}

export function nameOf(actor: ActorState): string {
  return actor.name.kind === "key" ? actor.name.key : actor.name.text;
}

// The successor of a dead leader, by the succession rule of the regime: the
// ruling party names a new chief (election, party), an heir is born to the
// dynasty (hereditary), the council picks an officer (military-council), the
// clergy a cleric, a warlord takes over.
export function successorOf(
  ctx: EconomyContext,
  rng: Rng,
  nation: NationId,
  politics: NationPolitics,
  date: string,
): ActorState {
  const regime = ctx.regime(politics.regime);
  const old = politics.leader;
  const party = politics.parties.find((p) => p.id === old.party) ?? null;
  const ideology =
    party?.ideology ?? (politics.government.ideology as Ideology) ?? old.traits;
  const id = `${nation.toLowerCase()}-${date}-${rng.nextInt(0, 1_000_000)}`;
  switch (regime.successionRule) {
    case "election":
    case "party": {
      const actor = generateActor(
        ctx,
        rng,
        nation,
        old.role,
        party?.id ?? null,
        ideology,
        regime,
        date,
        id,
      );
      if (party !== null) party.leader = actor;
      return actor;
    }
    case "hereditary":
      return generateActor(
        ctx,
        rng,
        nation,
        "head-of-state",
        null,
        old.traits,
        regime,
        date,
        id,
      );
    case "military-council":
      return generateActor(
        ctx,
        rng,
        nation,
        "military-chief",
        null,
        { economic: 0.2, authority: 0.8, sovereignty: 0.6 },
        regime,
        date,
        id,
      );
    case "clerical":
      return generateActor(
        ctx,
        rng,
        nation,
        "head-of-state",
        null,
        { economic: 0.1, authority: 0.8, sovereignty: 0.7 },
        regime,
        date,
        id,
      );
    case "warlord":
      return generateActor(
        ctx,
        rng,
        nation,
        "military-chief",
        null,
        old.traits,
        regime,
        date,
        id,
      );
  }
}
