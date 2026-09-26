import { z } from "zod";
import {
  BlocDomain,
  BlocMemberStatus,
  DecisionRule,
} from "../data/schemas/bloc";
import {
  INTEREST_GROUPS,
  NationId,
  NationIdSchema,
} from "../data/schemas/common";
import { GoodIdSchema } from "../data/schemas/goods";
import { SPENDING_POSTS, TAX_IDS } from "../data/schemas/nation";
import {
  AiState,
  BlocMeasureSchema,
  BlocProposal,
  BlocState,
  BlocVoteSchema,
  ContaminationEntry,
  DiplomacyState,
  EventsState,
  ExileSection,
  IntelState,
  JournalEntry,
  Market,
  MilitaryState,
  NationEconomy,
  NationPolitics,
  NationState,
  NationStatus,
  NavalState,
  NuclearState,
  PeaceTermsSchema,
  PinnedObjective,
  SaveFile,
  ScheduleState,
  SPEEDS,
  TechState,
  WorldState,
} from "../data/schemas/save";
import { Scenario } from "../data/schemas/scenario";
import { CONSCRIPTION_LEVELS, POSTURES } from "../data/schemas/war";
import type { AccessionCriteria, MeasureOption, Tally } from "./blocs/blocs";
import type { AffinityTerms } from "./diplomacy/diplomacy";
import type { IntelLevels, IntelRules } from "./intel/intel";
import type { BlastTile } from "./nuclear/blast";
import type { Runoff } from "./politics/elections";
import type { Occupations } from "./war/people";

// The simulation boundary (ARCHITECTURE.md, "Frontière de simulation").
// The client (through the worker) and the headless runner are two consumers of
// this same interface. The simulation does not know a UI exists.
export interface VeritableSim {
  init(scenario: Scenario, seed: number): void;
  restore(snapshot: SaveFile): void;
  snapshot(): SaveFile;
  apply(command: PlayerCommand): void;
  advance(gameMinutes: number): SimEvent[];
  read(): ReadonlyWorldView;
  // J7: what the always-visible interface reads (top bar, event cards),
  // cheap enough to be read four times a second; with the journal entries
  // added since the mark `journalSince` of an earlier HUD.
  hud(journalSince?: number): HudView;
  // J7: the journal, filtered, most recent first (the journal screen).
  queryJournal(query: JournalQuery): JournalPage;
  // J7b: what a declaration of war of the player would bring down, weighed
  // as the AI weighs its own (the action menu of the map).
  warPreview(target: NationId, casusBelli: string): WarPreview;
  // J7b: what the modes of the map colour the nations by.
  mapColors(): MapColors;
}

// The modes of the map (J7b, ui/mapModes.ts): the relations of the player
// with each nation, the wars and their sides, the members and candidates of
// each bloc, the player's level of intelligence on each nation (the mean of
// its categories but the general one, 0 to 3).
export interface MapColors {
  player: NationId | null;
  relations: Record<NationId, number>;
  wars: { aggressors: NationId[]; defenders: NationId[] }[];
  blocs: { id: string; members: NationId[]; candidates: NationId[] }[];
  intel: Record<NationId, number>;
}

export interface WarPreview {
  target: NationId;
  casusBelli: string;
  // Share of the player's trade partners (trade weights) expected to
  // sanction it, and who.
  sanctionsShare: number;
  sanctioners: NationId[];
  // Nations bound to defend the target (blocs of collective defence,
  // guarantees), with the chance they honour it.
  coalition: { nation: NationId; probability: number }[];
  // Relations lost with every nation at the declaration; every month of
  // the war too without casus belli.
  relationsCost: number;
  monthlyRelationsCost: number;
}

// Whose entries the journal screen shows (J7): all, the player's nation,
// its allies, its land neighbours, a region of the world, a bloc.
export type JournalScope =
  | { kind: "all" }
  | { kind: "mine" }
  | { kind: "allies" }
  | { kind: "neighbours" }
  | { kind: "region"; region: string }
  | { kind: "bloc"; bloc: string };

export interface JournalQuery {
  scope: JournalScope;
  // Only the entries that concern one of these nations (a search).
  nations?: readonly NationId[];
  category?: string;
  from?: string; // ISO dates, inclusive
  to?: string;
  link?: string; // one thread ("war:<id>")
  offset?: number;
  limit: number;
}

export interface JournalPage {
  entries: readonly JournalEntry[];
  total: number;
}

// The view of the always-visible interface (J7): the date and speed, the
// version of the full view, the player's decisions waiting (with the
// government's leaning) and the bloc votes awaiting its voice, and who its
// land neighbours and allies are (what makes an event pause the game).
export interface HudView {
  version: number;
  date: string;
  speed: number;
  playerNation: NationId | null;
  pending: EventsState["pending"];
  leanings: Readonly<Record<number, string>>;
  votes: readonly PendingVote[];
  neighbours: readonly NationId[];
  allies: readonly NationId[];
  enemies: readonly NationId[];
  blocs: readonly string[]; // the player's
  // Width of the map in tiles: the place of an entry (a tile index) to its
  // column and row.
  mapWidth: number;
  // Entries added to the journal in this session, and the latest of them
  // since the mark asked for (at most 50).
  journalMark: number;
  journal: readonly JournalEntry[];
  // J7b: what the cards need to show the figures of other nations through
  // perceive (the losses of a war): the seed, the rules, the levels of the
  // player on its enemies and on the nations of the entries sent.
  intel: {
    seed: number;
    rules: IntelRules;
    levels: Record<NationId, IntelLevels>;
  };
}

export interface PendingVote {
  id: number;
  bloc: string;
  kind: BlocProposal["kind"];
  by: NationId;
  target: NationId | null;
  direction: BlocProposal["direction"];
  resolveOn: string;
}

export const PlayerCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set-speed"),
    speed: z.union(SPEEDS.map((s) => z.literal(s))),
  }),
  // Budget sliders of the player's nation. Values are clamped to what the
  // rules allow (ceilings, forced austerity); effect from the next month.
  z.object({
    type: z.literal("set-tax"),
    tax: z.enum(TAX_IDS),
    rate: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("set-spending"),
    post: z.enum(SPENDING_POSTS),
    share: z.number().min(0).max(1),
  }),
  // One embargo: stops the flow of one good from an exporter to an importer.
  z.object({
    type: z.literal("set-embargo"),
    from: NationIdSchema,
    to: NationIdSchema,
    good: GoodIdSchema,
    active: z.boolean(),
  }),
  // Sanctions of the player's nation against another: every good but the
  // exempt ones, both ways.
  z.object({
    type: z.literal("set-sanctions"),
    against: NationIdSchema,
    active: z.boolean(),
  }),
  // War (J3a). The casus belli is an id of data/veritable/war/casus-belli.json
  // and must hold against the target.
  z.object({
    type: z.literal("declare-war"),
    target: NationIdSchema,
    casusBelli: z.string().min(1),
  }),
  z.object({ type: z.literal("raise-division"), template: z.string().min(1) }),
  z.object({ type: z.literal("disband-division"), division: z.number().int() }),
  // front: "A|B" (ids sorted) or null for the reserve; segment: index within
  // the front, or null for the whole front.
  z.object({
    type: z.literal("assign-division"),
    division: z.number().int(),
    front: z.string().nullable(),
    segment: z.number().int().nonnegative().nullable(),
  }),
  z.object({
    type: z.literal("set-posture"),
    division: z.number().int(),
    posture: z.enum(POSTURES),
  }),
  z.object({
    type: z.literal("set-conscription"),
    level: z.enum(CONSCRIPTION_LEVELS),
  }),
  z.object({
    type: z.literal("propose-peace"),
    war: z.string().min(1),
    to: NationIdSchema,
    terms: PeaceTermsSchema,
  }),
  z.object({
    type: z.literal("answer-peace"),
    offer: z.number().int(),
    accept: z.boolean(),
  }),
  // Navy (J3b): the fleet goes to the coastal zones of the target, or home.
  z.object({
    type: z.literal("set-blockade"),
    target: NationIdSchema,
    active: z.boolean(),
  }),
  // A landing on the coast of an enemy: refused unless the zone of the
  // landing tile is controlled.
  z.object({ type: z.literal("landing"), target: NationIdSchema }),
  // J7b (the action menu of the map, and the screens): an air strike on an
  // enemy, at most once every air.cooldownDays; the whole fleet to a sea
  // zone (null: home); the tile a segment of a front breaks through towards
  // (null: none).
  z.object({ type: z.literal("air-strike"), target: NationIdSchema }),
  // J7c: the player's government in exile asks its annexer for its land;
  // the player's dissolved nation hands over to a small one (last stand).
  z.object({ type: z.literal("exile-negotiate") }),
  z.object({ type: z.literal("last-stand"), nation: NationIdSchema }),
  z.object({
    type: z.literal("set-fleet"),
    zone: z.string().min(1).nullable(),
  }),
  z.object({
    type: z.literal("set-objective"),
    front: z.string().min(1),
    segment: z.number().int().nonnegative(),
    tile: z.number().int().nonnegative().nullable(),
  }),
  // The political engine (J4). Laws of data/veritable/laws/; the electoral
  // levers of the player; objectives of data/veritable/politics/
  // objectives.json; free-text notes.
  z.object({ type: z.literal("enact-law"), law: z.string().min(1) }),
  z.object({ type: z.literal("repeal-law"), law: z.string().min(1) }),
  z.object({
    type: z.literal("set-lever"),
    propagandaPctGdp: z.number().min(0).max(1).optional(),
    fraud: z.number().min(0).max(1).optional(),
    clientelism: z.enum(INTEREST_GROUPS).nullable().optional(),
  }),
  z.object({ type: z.literal("pin-objective"), objective: z.string().min(1) }),
  z.object({
    type: z.literal("unpin-objective"),
    objective: z.string().min(1),
  }),
  z.object({ type: z.literal("add-note"), text: z.string().min(1).max(2000) }),
  // Nuclear weapons (J5): a warhead of the player's nation at an enemy, at the
  // concentration of its divisions on their front or at its capital. The
  // screen asks twice; the command carries the second answer.
  z.object({
    type: z.literal("nuclear-launch"),
    target: NationIdSchema,
    aim: z.enum(["front", "capital"]),
    confirmed: z.literal(true),
  }),
  // Blocs (J5): the leader puts a measure to the vote (political capital);
  // a member votes, applies, leaves, answers a call of collective defence.
  z.object({
    type: z.literal("bloc-propose"),
    bloc: z.string().min(1),
    kind: BlocMeasureSchema,
    target: NationIdSchema.nullable(),
    direction: z.enum(["up", "down"]).nullable(),
  }),
  z.object({
    type: z.literal("bloc-vote"),
    proposal: z.number().int(),
    vote: BlocVoteSchema,
  }),
  z.object({ type: z.literal("bloc-apply"), bloc: z.string().min(1) }),
  z.object({ type: z.literal("bloc-leave"), bloc: z.string().min(1) }),
  z.object({
    type: z.literal("bloc-honor"),
    bloc: z.string().min(1),
    war: z.string().min(1),
  }),
  // Technology and events (J5).
  z.object({ type: z.literal("tech-research"), node: z.string().min(1) }),
  z.object({ type: z.literal("tech-cancel"), node: z.string().min(1) }),
  z.object({
    type: z.literal("event-choose"),
    id: z.number().int(),
    choice: z.string().min(1),
  }),
]);
export type PlayerCommand = z.infer<typeof PlayerCommandSchema>;

export type SimEvent =
  | { type: "day-started"; date: string }
  // The monthly clocks have run; the client takes its automatic save on it.
  | { type: "month-started"; date: string }
  | {
      type: "nation-status-changed";
      date: string;
      nation: NationId;
      from: NationStatus;
      to: NationStatus;
    }
  | {
      type:
        | "unrest-started"
        | "unrest-ended"
        | "austerity-started"
        | "austerity-ended"
        | "sovereign-default";
      date: string;
      nation: NationId;
    }
  | {
      type: "bloc-reprimand";
      date: string;
      nation: NationId;
      bloc: string;
      deficitToGdp: number;
      debtToGdp: number;
    }
  | {
      type: "war-declared";
      date: string;
      nation: NationId; // aggressor
      target: NationId;
      casusBelli: string | null;
      war: string;
    }
  | {
      type: "war-joined";
      date: string;
      nation: NationId;
      war: string;
      against: NationId;
    }
  | {
      type: "sanctions-imposed" | "sanctions-lifted";
      date: string;
      nation: NationId; // sanctioned
      by: NationId;
    }
  | {
      type: "peace-offered" | "peace-refused" | "peace-signed";
      date: string;
      nation: NationId; // who offered / refused / the loser
      war: string;
      offer: number;
    }
  | { type: "annexation"; date: string; nation: NationId; by: NationId }
  | {
      type: "landing-refused" | "landing";
      date: string;
      nation: NationId;
      target: NationId;
    }
  // J7b: an air strike the player ordered (damage added to the target).
  | {
      type: "air-strike";
      date: string;
      nation: NationId;
      target: NationId;
      war: string;
      damage: number;
    }
  // The political engine (J4); the parameters are those of the journal.
  | {
      type:
        | "election-held"
        | "government-formed"
        | "elections-suspended"
        | "law-enacted"
        | "law-refused"
        | "law-repealed"
        | "law-repeal-announced"
        | "coup-attempted"
        | "coup-succeeded"
        | "revolution"
        | "leader-died"
        | "leader-succeeded"
        | "fraud-detected"
        | "objective-completed"
        | "regime-changed"
        | "bloc-suspended"
        | "civilian-transition"
        // Nuclear weapons (J5).
        | "nuclear-launch"
        | "nuclear-detonation"
        | "nuclear-intercepted"
        | "dead-hand"
        // The nation AI (J5).
        | "arms-aid-started"
        | "arms-aid-ended"
        | "ai-landing"
        // Blocs (J5).
        | "bloc-proposal"
        | "bloc-decision"
        | "bloc-presidency"
        | "bloc-application"
        | "bloc-accession-opened"
        | "bloc-accession-frozen"
        | "bloc-joined"
        | "bloc-exit-notified"
        | "bloc-left"
        | "bloc-article5"
        | "bloc-article5-refused"
        // Technology and events (J5).
        | "tech-completed"
        | "event-occurred"
        // Exile (J7c).
        | "exile-returned"
        | "exile-negotiation"
        | "last-stand";
      date: string;
      nation: NationId;
      params: Record<string, string>;
    }
  | EventPopup;

// A pop-up for the player (J5): the client shows it and pauses when asked.
export type EventPopup = {
  type: "event-popup";
  date: string;
  nation: NationId;
  id: number;
  event: string;
  pause: boolean;
};

// A front between two belligerents, as the simulation and the UI see it:
// segments with the forces of both sides and the last resolution.
export interface FrontView {
  id: string; // "A|B", ids sorted
  a: NationId;
  b: NationId;
  segments: readonly SegmentView[];
}
export interface SegmentView {
  index: number;
  tiles: number; // tiles of the segment (defender-side border)
  terrain: { plains: number; highland: number; mountain: number }; // shares
  // Per side: divisions engaged, force, posture in effect, and the factors
  // of its force (J5: what a click on a segment of the map shows).
  sides: Record<NationId, SegmentSide>;
  ratio: number; // force of a / force of b, last tick
  // The attack that counts on the segment: who attacks, and its force over
  // the defender's (terrain and structures included); null when nobody
  // attacks.
  attacker: NationId | null;
  attackRatio: number;
  movedTo: NationId | null; // who took tiles last tick
}
export interface SegmentSide {
  divisions: number;
  force: number; // with supply and air, without terrain and structures
  attacking: boolean;
  men: number;
  equipment: number; // 0..1, mean of the engaged divisions
  training: number; // mean of the engaged divisions
  supply: number; // factor
  // Divisions it supplies in full here (J7b; Infinity without logistics).
  capacity: number;
  air: number; // factor
  terrain: number; // factor on its defence
  structures: number; // factor on its defence (defence posts, cities)
}

export interface ReadonlyWorldView {
  readonly seed: number;
  readonly date: string;
  readonly elapsedGameMinutes: number;
  readonly speed: number;
  readonly playerNation: NationId | null;
  readonly nations: readonly Readonly<NationState>[];
  readonly journal: readonly Readonly<JournalEntry>[];
  readonly market: Readonly<Market>;
  readonly economies: Readonly<Record<NationId, Readonly<NationEconomy>>>;
  readonly politics: Readonly<Record<NationId, Readonly<NationPolitics>>>;
  readonly diplomacy: Readonly<DiplomacyState>;
  readonly military: Readonly<MilitaryState>;
  readonly naval: Readonly<NavalState>;
  readonly fronts: readonly FrontView[];
  // Nuclear weapons (J5): arsenals, threat levels, strikes, fallout; the
  // probability that the dead hand of each nuclear nation strikes its
  // annexer; the daily probability of a shot of each nuclear nation nobody
  // plays at the enemy that threatens it most.
  readonly nuclear: Readonly<NuclearState>;
  readonly deadHand: Readonly<Record<NationId, number>>;
  readonly nuclearRisk: Readonly<Record<NationId, number>>;
  // The nation AI (J5): its reviews, defence goals and arms flows.
  readonly ai: Readonly<AiState>;
  // Contested tiles each nation holds (J5), and its tiles on the first day.
  readonly contested: Readonly<Record<NationId, number>>;
  readonly initialTiles: Readonly<Record<NationId, number>>;
  // What the structures built on the map cost each budget last month (US$).
  readonly constructionCost: Readonly<Record<NationId, number>>;
  // Casus belli the player could invoke against each other nation.
  readonly casusBelli: Readonly<Record<NationId, readonly string[]>>;
  // J7b: the nations the player sanctions through a bloc — only a vote of
  // the bloc lifts these.
  readonly blocHeldSanctions: readonly NationId[];
  // The political engine (J4): projected shares of the player's next
  // election (levers applied, no draw), the pinned objectives and notes.
  readonly electionProjection: Readonly<Record<string, number>> | null;
  // J7: the projected runoff where the head of state is elected in two
  // rounds (null elsewhere).
  readonly electionRunoff: Readonly<Runoff> | null;
  readonly objectives: readonly Readonly<PinnedObjective>[];
  readonly notes: readonly Readonly<{ date: string; text: string }>[];
  // Blocs, layers 2 and 3 (J5).
  readonly blocs: readonly BlocView[];
  // Technology (J5): what every nation has and researches; for the player,
  // the cost of each node today and why it cannot start it (null: it can).
  readonly tech: Readonly<TechState>;
  readonly techCosts: Readonly<Record<string, number>>;
  readonly techRefusals: Readonly<Record<string, string | null>>;
  // Events (J5): the player's pop-ups waiting, the history.
  readonly events: Readonly<EventsState>;
  // J7: for each pending event of the player's nation, the choice its
  // government leans towards — the one it takes when the player has not
  // chosen within events.answerDays (instance id → choice id).
  readonly eventLeanings: Readonly<Record<number, string>>;
  // J7: the rolling queue (when each nation was last updated and will be
  // next), and the version of the view: it moves whenever something the
  // player sees has changed (the interface reads the view again then).
  readonly schedule: Readonly<ScheduleState>;
  // Intelligence (J7): what the player knows of every other nation — read
  // only through perceive() (ui/intel.ts), with the military power and the
  // monthly risk of a coup of every nation.
  readonly intel: Readonly<IntelView>;
  readonly power: Readonly<Record<NationId, number>>;
  readonly coupRisk: Readonly<Record<NationId, number>>;
  // J7c: the governments in exile and the dissolved nations; the
  // stability each occupant loses to their resistance; the nations the
  // player's dissolved nation may hand over to.
  readonly exile: Readonly<ExileSection>;
  readonly resistance: Readonly<Record<NationId, number>>;
  readonly lastStandChoices: readonly NationId[];
  readonly version: number;
}

// Intelligence as the interface sees it (J7): the snapshots of the
// indicators and the relations of the player, its levels on every other
// nation and the terms of their relation, the rules of perception.
export interface IntelView {
  state: IntelState;
  levels: Record<NationId, IntelLevels>;
  relationTerms: Record<NationId, AffinityTerms>;
  rules: IntelRules;
  // What is public between the player and each nation: the regions each
  // claims on land the other holds (only nations with claims), and every
  // guarantee of the scenario.
  claims: Record<NationId, { byPlayer: string[]; byThem: string[] }>;
  guarantees: { guarantor: NationId; protected: NationId }[];
}

// A bloc as the screen sees it. Members: the simulated nations only, and
// how many full members it has in the world.
export interface BlocView {
  id: string;
  leader: NationId | null;
  leadership: "rotating" | "hegemon" | "elected";
  termEnds: string | null; // next change of a rotating presidency
  members: readonly { nation: NationId; status: BlocMemberStatus }[];
  worldMembers: number;
  playerStatus: BlocMemberStatus | null;
  rules: Readonly<Record<BlocDomain, DecisionRule>>;
  qualifiedMajority: { memberShare: number; populationShare: number } | null;
  collectiveDefense: boolean; // in the data or voted
  competencies: readonly string[];
  techBranch: string | null;
  state: Readonly<BlocState>;
  contributionPctGdp: number | null; // x the budget scale
  // Pending proposals with the vote they would get today; resolved ones.
  pending: readonly { proposal: Readonly<BlocProposal>; projection: Tally }[];
  resolved: readonly Readonly<BlocProposal>[];
  // What the player may propose (it leads), apply for (it is out).
  options: readonly MeasureOption[];
  criteria: AccessionCriteria | null;
  calls: readonly { war: string; until: string }[];
  exitTradeCostPctGdp: number;
  exitDelayMonths: number;
}

export interface TileGrid {
  width: number;
  height: number;
  // See TILE_NATION_MASK / TILE_FALLOUT_BIT in data/schemas/saveV1.ts.
  tiles: Uint16Array;
  // Contest of each tile (sim/war/contest.ts), since v5; absent in a grid
  // made from an older save, where the contested bit of `tiles` is all
  // there is.
  contest?: Uint16Array;
}

// Geometry of a front as the world computes it (J3a): the simulation reasons
// in segments, never in tiles.
export interface FrontGeometry {
  id: string; // "A|B", ids sorted
  a: NationId;
  b: NationId;
  segments: readonly SegmentGeometry[];
}
export interface SegmentGeometry {
  index: number;
  tiles: number;
  terrain: { plains: number; highland: number; mountain: number }; // shares
  // Multiplier of the structures (defence posts, cities) each side holds on
  // its tiles of the segment.
  defense: Record<NationId, number>;
  // Ports and cities of each side near the segment (logistics, J3b).
  supply: Record<NationId, number>;
  // J7c: the mean contamination of its tiles (the divisions there wear).
  contamination?: number;
}

// The sea as the world sees it today (J3b): zones each nation touches from
// its coast and from its ports, and the warships present in each zone.
export interface NavalSnapshot {
  coast: Record<NationId, string[]>;
  ports: Record<NationId, string[]>;
  ships: Record<string, Record<NationId, number>>;
}

// What the simulation needs from the tiled world. Implemented by
// src/veritable/adapters/CoreBridge.ts over the OpenFront core, and by
// in-memory worlds for tests and the headless runner. Nations are always
// addressed by NationId; tile values use the index of the nation in the
// `nations` argument.
export interface WorldPort {
  tileCounts(): ReadonlyMap<NationId, number>;
  capture(nations: readonly NationId[]): { world: WorldState; grid: TileGrid };
  restore(
    nations: readonly NationId[],
    world: WorldState,
    grid: TileGrid,
  ): void;
  // Fronts between the given pairs of belligerents, cut into segments of
  // about `segmentTiles` tiles. Pairs without a common border are omitted.
  fronts(
    pairs: readonly [NationId, NationId][],
    segmentTiles: number,
  ): FrontGeometry[];
  // Takes up to `tiles` tiles of `loser` for `winner` along a segment of the
  // last computed geometry of the front; returns how many were taken. Taken
  // tiles are tagged contested. `toward` (J7b): a breakthrough takes the
  // tiles nearest that tile first.
  advance(
    front: string,
    segment: number,
    winner: NationId,
    loser: NationId,
    tiles: number,
    toward?: number | null,
  ): number;
  // Annexation: every tile of `from` goes to `to`, tagged contested.
  transferAll(from: NationId, to: NationId): number;
  // The sea today (computed by the world, cached for the day).
  naval(): NavalSnapshot;
  // Zone of the tile a landing of `attacker` on `target` would aim at (an
  // enemy port, else the nearest enemy shore); null when there is none.
  landingZone(attacker: NationId, target: NationId): string | null;
  // Sends the landing: a transport that takes a beachhead of `radius` tiles
  // around the landing tile when it arrives. False when it cannot sail.
  launchLanding(attacker: NationId, target: NationId, radius: number): boolean;
  // Contest of the tiles (J5, sim/war/contest.ts). The month is counted from
  // the start of the campaign; the simulation sets it before any capture.
  setMonth(month: number): void;
  // Contested tiles each nation holds.
  contestedCounts(): ReadonlyMap<NationId, number>;
  // A treaty cedes to `winner` the contested tiles it holds.
  cede(winner: NationId): number;
  // Contests older than their delay end; returns how many.
  settleContested(warMonths: number, cessionMonths: number): number;
  // Structures each nation has on the map, levels summed, by OpenFront unit
  // type (J5: what it builds is paid by its budget).
  structureCounts(): ReadonlyMap<NationId, Record<string, number>>;
  // Nuclear weapons (J5). A warhead of `by` towards `target`, from a silo near
  // its capital (built if it has none); false when the world cannot launch
  // it. Its outcome comes later, through nukeOutcomes().
  launchNuke(
    id: number,
    by: NationId,
    target: NationId,
    aim: NukeAim,
    weapon: "atom" | "hydrogen",
  ): boolean;
  // Launches resolved since the last call: where the warhead burst, or
  // intercepted, or never launched.
  nukeOutcomes(): NukeOutcome[];
  // J7c (sim/nuclear/blast.ts): the land tiles within `radiusKm` of `tile`,
  // their owner, their centre from it in km, their area and their people
  // (units of the population grid, the dead of earlier bursts off; 0
  // without a grid).
  blastTiles(tile: number, radiusKm: number): BlastSite[];
  // J7c: the contamination the simulation keeps (sim/nuclear/
  // contamination.ts). The world takes the dead off its tiles, gives the
  // contamination of each segment of a front and shows it on the map.
  setContamination(entries: readonly ContaminationEntry[]): void;
  // J7c: the contamination of each nation's land, weighted by its people
  // (by its tiles without a population grid).
  contaminatedShares(): ReadonlyMap<NationId, number>;
  // The owner of a tile (null: nobody).
  ownerOf(tile: number): NationId | null;
  // J7c (sim/exile/exile.ts): who holds the first-day land of a nation,
  // settled or not, in tiles and in people (units of the population grid;
  // empty without a grid), and its return: the tiles of it `from` holds go
  // back to it (no longer settled nor contested); returns how many.
  homelandHeld(nation: NationId): {
    tiles: ReadonlyMap<NationId, number>;
    people: ReadonlyMap<NationId, number>;
  };
  returnHomeland(nation: NationId, from: NationId): number;
  // Does the nation still hold its capital?
  capitalHeld(nation: NationId): boolean;
  // Places of the journal (J7): the tile of the capital of a nation (null
  // when the world does not know it), and a tile of `b` on its border with
  // `a` on the way from the capital of `a` to that of `b` (the capital of
  // `b` when the way crosses no common border).
  capitalTile(nation: NationId): number | null;
  borderTile(a: NationId, b: NationId): number | null;
  // Width of the map in tiles (a tile index to its column and row).
  mapWidth(): number;
  // Tiles from the capital of the nation to the nearest front it fights on
  // (last computed geometry); null without a front.
  capitalFrontDistance(nation: NationId): number | null;
  // Claims (J6, sim/war/claimTiles.ts): tiles of a region (a region of the
  // scenario, or "homeland:<nation>") each nation holds, settled tiles
  // excluded.
  claimHolders(region: string): ReadonlyMap<NationId, number>;
  // A treaty in which `loser` cedes land to `winner`: the tiles the winner
  // holds of the loser's first-day land or of `regions` (the loser's
  // claims) are settled; returns how many.
  settleClaims(
    winner: NationId,
    loser: NationId,
    regions: readonly string[],
  ): number;
  // The people of the tiles (J7b, sim/war/people.ts): whether the world has
  // a population grid, the people each nation holds (units of the grid),
  // and the people, capitals and cities that changed hands since the last
  // call.
  peopleKnown(): boolean;
  peopleHoldings(): ReadonlyMap<NationId, number>;
  takeOccupations(): Occupations;
}

export type NukeAim =
  | { kind: "front"; front: string; segment: number }
  | { kind: "capital" }
  | { kind: "city"; index: number };

export interface NukeOutcome {
  id: number;
  status: "detonated" | "intercepted" | "failed";
  // J7c: the tile it burst on (detonated only).
  tile: number | null;
}

// A tile around a burst (J7c).
export interface BlastSite extends BlastTile {
  owner: NationId | null;
}

export { NationIdSchema };
export type { Occupations };
