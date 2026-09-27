import { stepFiscalRule } from "../ai/fiscal";
import {
  AiEnv,
  AiEvent,
  armsFlowOf,
  hasStakes,
  initAi,
  previewWar,
  review,
} from "../ai/nations";
import { deployOnFronts, stepWarAi } from "../ai/war";
import { INTEREST_GROUPS, NationId } from "../data/schemas/common";
import { VeritableConfig } from "../data/schemas/config";
import { NationData } from "../data/schemas/nation";
import { ROW_ID } from "../data/schemas/row";
import {
  AiState,
  BlocsState,
  BlocState,
  Calendar,
  DiplomacyState,
  EconomyState,
  EventsState,
  ExileSection,
  ExileState,
  IntelState,
  JournalEntry,
  MilitaryState,
  NationState,
  NavalState,
  NuclearState,
  PeaceOffer,
  PeaceTerms,
  PoliticsState,
  SAVE_SCHEMA_VERSION,
  SaveFile,
  ScheduleState,
  TechState,
  TerritoryState,
  War,
} from "../data/schemas/save";
import { Scenario } from "../data/schemas/scenario";
import { airMultiplier, airSuperiority, orderAirStrike } from "./air/air";
import {
  accessionCriteria,
  aiApplicationsOf,
  applyForMembership,
  blocData,
  BlocEngineEvent,
  BlocEnv,
  blocSanction,
  castVote,
  computeLeader,
  honorCall,
  initBlocs,
  leaderOf,
  leaveBloc,
  measureOptions,
  memberStatus,
  openToApplications,
  propose,
  sessionDay,
  stepBlocsCalendar,
  stepBlocsDay,
  stepBlocSession,
  syncBlocs,
  tally,
  termEnds,
} from "./blocs/blocs";
import { BlocEvent, stepFiscalRules } from "./blocs/fiscalRule";
import { dateAfter, dayIndex, MINUTES_PER_GAME_DAY } from "./calendar";
import { claimsAgainst, claimsOf, wakeClaims } from "./diplomacy/claims";
import {
  AffinityInputs,
  affinityTerms,
  AffinityTerms,
  allies,
  availableCasusBelli,
  cachedAffinityInputs,
  declareWar,
  DiplomacyEvent,
  DiplomacyStepEnv,
  enemiesOf,
  hitDemocracyRelations,
  imposeSanctions,
  initDiplomacy,
  LiftReason,
  liftSanctions,
  playerLiftCost,
  relation,
  scheduleSanctionReviews,
  stepDiplomacyMonth,
  stepDiplomacyNation,
  warOf,
  warSide,
} from "./diplomacy/diplomacy";
import {
  BudgetEvent,
  settleStartBudget,
  spendingCeiling,
  stepBudget,
} from "./economy/budget";
import { buildContext, EconomyContext, SimData } from "./economy/context";
import {
  growNation,
  refreshTradeAggregates,
  stepPrices,
  stepTrade,
  stepTradeGood,
  stepWorld,
  TradeAffinities,
  tradeAffinities,
} from "./economy/engine";
import { initEconomy, initPolitics } from "./economy/init";
import { populationFactor, populationOf } from "./economy/population";
import {
  chooseEvent,
  eventData,
  eventGrowth,
  EventsEnv,
  EventsEvent,
  governmentChoice,
  initEvents,
  stepEventsDraws,
  stepEventsHousekeeping,
} from "./events/events";
import {
  acceptsReturn,
  ExileEnv,
  ExileEvent,
  openExile,
  resistanceMalus,
  stepExile,
} from "./exile/exile";
import {
  IntelLevels,
  intelLevels,
  IntelRules,
  IntelWorld,
} from "./intel/intel";
import {
  emptyIntel,
  ensureIntel,
  recordRelations,
  takeIntelSnapshots,
} from "./intel/state";
import { compactJournal, entryCategory, entryNations } from "./journal";
import { nationFromData, statusFromTerritory } from "./nation";
import {
  initNaval,
  landingControl,
  NavalEvent,
  setBlockade,
  setFleetZone,
  stepNavalDay,
} from "./naval/naval";
import {
  aimOf,
  deadHandProbability,
  fireProbability,
  initNuclear,
  launch,
  loseStrikesInFlight,
  mainThreat,
  NuclearEnv,
  NuclearEvent,
  stepDeadHand,
  stepNuclearDay,
} from "./nuclear/nuclear";
import {
  coupBaseOf,
  CoupEvent,
  coupProbability,
  stepCoups,
  stepJuntaTransition,
  stepRevolution,
} from "./politics/coups";
import {
  ElectionEvent,
  holdElection,
  projectShares,
  runoffOf,
  voteCoverage,
} from "./politics/elections";
import { clamp01 } from "./politics/ideology";
import {
  enactLaw,
  LawEvent,
  lawModifiers,
  repealLaw,
  stepLawsMonth,
  stepSliders,
} from "./politics/laws";
import { LeaderEvent, stepLeaderAgeing } from "./politics/leaders";
import {
  ObjectiveEvent,
  ObjectiveWorld,
  pinObjective,
  stepObjectivesMonth,
  unpinObjective,
} from "./politics/objectives";
import {
  internalConflictMalus,
  PoliticsEvent,
  stepPolitics,
} from "./politics/politics";
import { Rng } from "./rng";
import {
  cadenceDays,
  dueNations,
  hasten,
  initSchedule,
  reschedule,
} from "./schedule";
import {
  ClockContext,
  DomainSystem,
  NULL_PROBE,
  PerfProbe,
  Scheduler,
} from "./scheduler";
import {
  cancelResearch,
  diffusionShares,
  effectiveCost,
  fillAiProjects,
  initTech,
  researchRefusals,
  startResearch,
  stepTechNation,
  syncTech,
  TechEnv,
  TechEvent,
} from "./tech/tech";
import {
  calendarMonth,
  DAYS_PER_MONTH,
  daysBetweenDates,
  MINUTES_PER_MONTH,
  MINUTES_PER_YEAR,
  walkSd,
  WEEKS_PER_MONTH,
} from "./time";
import {
  BlocView,
  FrontGeometry,
  FrontView,
  HudView,
  IntelView,
  JournalPage,
  JournalQuery,
  JournalScope,
  MapColors,
  PendingVote,
  PlayerCommand,
  PlayerCommandSchema,
  ReadonlyWorldView,
  SegmentGeometry,
  SimEvent,
  VeritableSim,
  WarPreview,
  WorldPort,
} from "./VeritableSim";
import { monthIndex } from "./war/contest";
import {
  enemyPairs,
  Multipliers,
  releaseIdleDivisions,
  resolveTick,
  stepWarLedgers,
  WarMonth,
} from "./war/fronts";
import {
  assignDivision,
  disbandDivision,
  initMilitary,
  militaryPower,
  raiseDivision,
  setConscription,
  setPosture,
  stepMilitaryMonth,
} from "./war/military";
import {
  aiAccepts,
  completeAnnexation,
  findOffer,
  PeaceEvent,
  proposePeace,
  refuseOffer,
  signPeace,
} from "./war/peace";

export interface SimDeps {
  config: VeritableConfig;
  world: WorldPort;
  // Static data of the campaign: goods, rest of the world, blocs, geography.
  data: SimData;
  // Nation sheets of data/veritable/nations/, looked up by scenario.nations.
  nationData: (id: NationId) => NationData | undefined;
  // The scenario of the campaign, for a restore (init receives its own).
  scenario?: Scenario;
  perf?: PerfProbe;
  // True when nobody plays: the AI rules also run the player's nation
  // (headless runner).
  autopilot?: boolean;
}

const METRIC_ADVANCE_CALLS = "sim.advanceCalls";

// What the domain systems report; the simulation dates it.
type DomainEvent =
  | BudgetEvent
  | PoliticsEvent
  | BlocEvent
  | DiplomacyEvent
  | PeaceEvent
  | NavalEvent
  | {
      type: "air-strike";
      nation: NationId;
      target: NationId;
      war: string;
      damage: number;
    }
  | ElectionEvent
  | LawEvent
  | CoupEvent
  | LeaderEvent
  | ObjectiveEvent
  | NuclearEvent
  | AiEvent
  | { type: "bloc-suspended"; nation: NationId; bloc: string }
  | BlocEngineEvent
  | TechEvent
  | Extract<EventsEvent, { type: "event-occurred" }>
  | ExileEvent
  | { type: "note"; nation: NationId; text: string };

// Events of the political engine: they reach the client with their journal
// parameters.
const POLITICAL_EVENTS = new Set<string>([
  "election-held",
  "government-formed",
  "elections-suspended",
  "law-enacted",
  "law-refused",
  "law-repealed",
  "law-repeal-announced",
  "coup-attempted",
  "coup-succeeded",
  "revolution",
  "leader-died",
  "leader-succeeded",
  "fraud-detected",
  "objective-completed",
  "regime-changed",
  "bloc-suspended",
  "civilian-transition",
  "nuclear-launch",
  "nuclear-detonation",
  "nuclear-intercepted",
  "dead-hand",
  "arms-aid-started",
  "arms-aid-ended",
  "ai-landing",
  "bloc-proposal",
  "bloc-decision",
  "bloc-presidency",
  "bloc-application",
  "bloc-accession-opened",
  "bloc-accession-frozen",
  "bloc-joined",
  "bloc-exit-notified",
  "bloc-left",
  "bloc-article5",
  "bloc-article5-refused",
  "tech-completed",
  "event-occurred",
  "exile-returned",
  "exile-negotiation",
  "last-stand",
]);

const CEASEFIRE: PeaceTerms = {
  kind: "ceasefire",
  reparationsPctGdp: 0,
  reparationYears: 0,
  maxDivisions: null,
};

// The most journal entries the always-visible interface receives at once
// (J7): what a quarter of a second at x5 adds, and far more.
const HUD_JOURNAL_MAX = 50;

export class VeritableSimImpl implements VeritableSim {
  private seed = 0;
  private rng = new Rng(0);
  private calendar: Calendar = {
    startDate: "2026-01-01",
    elapsedGameMinutes: 0,
    date: "2026-01-01",
    speed: 1,
  };
  private nations: NationState[] = [];
  private journal: JournalEntry[] = [];
  private metrics: Record<string, number> = {};
  private economy!: EconomyState;
  private politics!: PoliticsState;
  private diplomacy!: DiplomacyState;
  private military!: MilitaryState;
  private naval!: NavalState;
  private territory!: TerritoryState;
  private nuclear!: NuclearState;
  private ai!: AiState;
  private blocs!: BlocsState;
  private tech!: TechState;
  private events!: EventsState;
  // J7: the rolling queue of the nations (sim/schedule.ts).
  private schedule!: ScheduleState;
  // Intelligence (J7): snapshots of the indicators, relations of the player.
  private intel!: IntelState;
  // J7c: the governments in exile and the dissolved nations.
  private exile!: ExileSection;
  // J7: the version of the view is derived from the saved state (the day,
  // the journal): what the player sees moves with them; the interface reads
  // the view again when it changes, at most four times a second, and after
  // each of its own commands.
  private get viewVersion(): number {
    return (
      dayIndex(this.calendar.elapsedGameMinutes) * 100_000 +
      (this.journal.length % 100_000)
    );
  }
  // The nations of the campaign and their index (the draws of the events).
  private knownNations: ReadonlySet<NationId> = new Set();
  private nationIndex: ReadonlyMap<NationId, number> = new Map();
  private scenario!: Scenario;
  private ctx!: EconomyContext;
  private sheets = new Map<NationId, NationData>();
  private initialized = false;

  private pending: SimEvent[] = [];
  private readonly scheduler: Scheduler;

  // Fronts: geometry read from the world once a game day (and after any
  // command or event that changes the wars), and the views of the last tick.
  // Transient: a reloaded campaign reads it again from the current tiles, so
  // its fronts can differ from the saved campaign's until the next day.
  private geometry: FrontGeometry[] = [];
  private geometryDay = -1;
  private frontViews: FrontView[] = [];

  constructor(private readonly deps: SimDeps) {
    this.scheduler = new Scheduler(this.systems(), deps.perf);
  }

  // The day and month clocks of the central scheduler (J7: nothing waits
  // for the 1st but what is calendar by nature). The nations, the goods,
  // the draws of the events and the fronts run tick by tick (tickWork).
  private systems(): DomainSystem[] {
    return [
      {
        domain: "economy",
        onDay: () => {
          stepPrices(this.ctx, this.economy);
          stepWorld(
            this.ctx,
            this.economy.market,
            this.rng,
            1 / DAYS_PER_MONTH,
          );
        },
      },
      {
        domain: "diplomacy",
        onDay: (c) => this.diplomacyDay(c),
      },
      {
        domain: "blocs",
        onDay: (c) => this.blocsDay(c),
        onMonth: (c) => this.blocsCalendar(c),
      },
      {
        domain: "events",
        onDay: (c) => {
          for (const event of stepEventsHousekeeping(this.eventsEnv(c.date))) {
            this.recordEvent(c.date, event);
          }
        },
      },
      {
        domain: "save",
        // J6c: every 1 January, the journal older than journalFullYears
        // is folded into yearly summaries.
        onMonth: (c) => {
          this.intelMonth(c.date);
          if (!c.date.endsWith("-01-01")) return;
          const years = this.deps.config.save.journalFullYears;
          const before = `${Number(c.date.slice(0, 4)) - years}-01-01`;
          this.journal = compactJournal(
            this.journal,
            before,
            this.politics.autopilot ? null : this.playerNationId(),
          );
        },
      },
    ];
  }

  init(scenario: Scenario, seed: number): void {
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed);
    this.calendar = {
      startDate: scenario.startDate,
      elapsedGameMinutes: 0,
      date: scenario.startDate,
      speed: 1,
    };
    this.scenario = scenario;
    const sheets = this.loadSheets(scenario.nations, scenario.id);
    this.nations = sheets.map((data) =>
      nationFromData(data, data.id === scenario.playerDefault),
    );
    this.economy = initEconomy(this.ctx, sheets, this.deps.data.row);
    this.politics = initPolitics(
      this.ctx,
      sheets,
      scenario.playerDefault,
      this.deps.autopilot === true,
      this.rng,
      this.calendar.date,
    );
    settleStartBudget(
      this.ctx,
      this.economy,
      this.politics,
      scenario.startDate,
    );
    this.syncSuspensions();
    this.diplomacy = initDiplomacy(this.ctx, scenario);
    this.military = initMilitary(this.ctx, sheets);
    this.naval = initNaval();
    this.nuclear = initNuclear(sheets);
    this.ai = initAi(scenario.nations);
    this.blocs = initBlocs(this.ctx);
    syncBlocs(this.ctx, this.blocs);
    this.applyScenarioSanctions(scenario);
    this.tech = initTech(this.ctx, sheets);
    fillAiProjects(this.techEnv(scenario.startDate));
    syncTech(this.ctx, this.tech);
    this.events = initEvents();
    for (const bloc of this.blocs.blocs) {
      this.blocs.leaders[bloc.id] =
        computeLeader(
          this.blocEnv(scenario.startDate),
          bloc.id,
          scenario.startDate,
        ) ?? "";
    }
    this.journal = [
      { date: this.calendar.date, kind: "campaign-started", params: {} },
    ];
    this.metrics = { [METRIC_ADVANCE_CALLS]: 0 };
    this.invalidateFronts();
    this.initialized = true;
    this.deps.world.setMonth(0);
    this.refreshTileCounts();
    // The territory of the first day: what the nuclear threat measures
    // losses against (J5).
    this.territory = {
      initialTiles: Object.fromEntries(
        this.nations.map((n) => [n.id, n.tileCount]),
      ),
      structures: Object.fromEntries(this.deps.world.structureCounts()),
      constructionCost: Object.fromEntries(this.nations.map((n) => [n.id, 0])),
    };
    // J7: every good takes its first turn on the first day, and the rolling
    // queue of the nations starts.
    const blockade = this.naval.blockade;
    stepTrade(
      this.ctx,
      this.economy,
      (e, i) => (1 - (blockade[e] ?? 0)) * (1 - (blockade[i] ?? 0)),
      0,
    );
    this.schedule = initSchedule(
      this.ctx.nationIds,
      0,
      (id) => this.cadence(id),
      this.deps.config.time.gameMinutesPerTick,
      this.politics.autopilot ? null : this.playerNationId(),
    );
    // J7: the belligerents of the wars of the scenario take their first
    // war orders together, at the first ticks, once the fronts are known —
    // spread over the first week, the first to come (Ukraine) found the
    // other's segments empty and took land the scenario gives Russia.
    for (const war of this.diplomacy.wars) {
      for (const id of [...war.aggressors, ...war.defenders]) {
        hasten(
          this.schedule,
          id,
          0,
          0,
          this.deps.config.time.gameMinutesPerTick,
        );
      }
    }
    this.intel = emptyIntel();
    this.exile = { nations: {}, lastStands: [] };
    this.ensureIntelState();
    this.warmUp();
  }

  // J6c: the first monthly step of a session ran cold (the engine compiles
  // its code as it goes). J7: no step carries the world any more, but the
  // first calls of each domain still do; a dry run of them at load (the
  // loading screen), on copies of the state and with a throwaway random
  // generator: nothing of the campaign changes, the results are thrown
  // away. Twice: the engine compiles a function hot only after a few calls.
  private warmUp(): void {
    const date = this.calendar.date;
    for (let pass = 0; pass < 2; pass++) {
      const rng = new Rng(pass + 1);
      const economy = structuredClone(this.economy);
      const politics = structuredClone(this.politics);
      const diplomacy = structuredClone(this.diplomacy);
      const military = structuredClone(this.military);
      const events = structuredClone(this.events);
      stepTrade(this.ctx, economy, () => 1, 0);
      for (const id of this.ctx.nationIds) {
        growNation(this.ctx, economy, id, false, rng, 0.25);
        stepSliders(this.ctx, economy.nations[id], 0.25);
        stepBudget(this.ctx, id, economy.nations[id], politics.nations[id], {
          date,
          month: 0,
          months: 0.25,
          monthsCrossed: 0,
        });
        stepPolitics(
          this.ctx,
          id,
          this.sheets.get(id),
          economy.nations[id],
          politics.nations[id],
          0,
          0,
          {},
          0,
          1,
        );
      }
      stepDiplomacyMonth(
        this.ctx,
        diplomacy,
        economy,
        military,
        politics,
        rng,
        date,
        this.aiNations(),
        () => false,
        this.politics.autopilot ? null : this.playerNationId(),
        0.25,
      );
      const env: EventsEnv = {
        ...this.eventsEnv(date),
        rng,
        events,
        economy,
        politics,
        diplomacy,
        military,
        player: null,
      };
      const slots = Math.max(
        1,
        Math.round(
          MINUTES_PER_GAME_DAY / this.deps.config.time.gameMinutesPerTick,
        ),
      );
      for (let slot = 0; slot < slots; slot++) {
        stepEventsDraws(env, slot, slots);
      }
    }
  }

  restore(snapshot: SaveFile): void {
    if (snapshot.schemaVersion !== SAVE_SCHEMA_VERSION) {
      throw new Error(
        `save schemaVersion ${snapshot.schemaVersion} must be migrated to ${SAVE_SCHEMA_VERSION} before restore`,
      );
    }
    const state = structuredClone(snapshot);
    const ids = state.nations.map((n) => n.id);
    this.loadSheets(ids, "save");
    this.scenario = this.deps.scenario ?? {
      id: "save",
      map: "save",
      startDate: state.calendar.startDate,
      nations: ids,
      borders: { source: "save", rasterized: "save" },
      contested: [],
      wars: [],
      playerDefault: state.nations.find((n) => n.isPlayer)?.id ?? ids[0],
    };
    this.seed = state.seed;
    this.rng = Rng.fromState(state.rngState);
    this.calendar = state.calendar;
    this.nations = state.nations;
    this.journal = state.journal;
    this.metrics = state.metrics;
    this.economy = state.economy;
    this.politics = state.politics;
    this.diplomacy = state.diplomacy;
    this.military = state.military;
    this.naval = state.naval;
    this.territory = state.territory;
    this.nuclear = state.nuclear;
    loseStrikesInFlight(this.nuclear);
    this.ai = state.ai;
    this.blocs = state.blocs;
    syncBlocs(this.ctx, this.blocs);
    this.tech = state.tech;
    syncTech(this.ctx, this.tech);
    this.events = state.events;
    this.schedule = state.schedule;
    this.intel = state.intel;
    this.exile = state.exile;
    this.resistanceCache = null;
    this.threatCache = null;
    this.syncSuspensions();
    this.invalidateFronts();
    this.initialized = true;
    this.deps.world.setMonth(this.currentMonth());
    this.deps.world.restore(this.nationIds(), state.world, {
      width: state.tilesInfo.width,
      height: state.tilesInfo.height,
      tiles: state.tiles,
      contest: state.contest,
    });
    // J7c: the contamination of the land (the dead off its people).
    this.deps.world.setContamination(this.nuclear.contamination);
    this.ensureIntelState();
    this.warmUp();
  }

  // Months since the start of the campaign (the clock of the contest).
  private currentMonth(): number {
    return monthIndex(this.calendar.startDate, this.calendar.date);
  }

  snapshot(): SaveFile {
    this.assertInitialized();
    this.refreshTileCounts();
    const { world, grid } = this.deps.world.capture(this.nationIds());
    // J6c: the tile grids come fresh from the capture — no copy of their 16
    // MB each at the scale of the world; the rest is cloned.
    const state = structuredClone({
      schemaVersion: SAVE_SCHEMA_VERSION as SaveFile["schemaVersion"],
      seed: this.seed,
      rngState: this.rng.getState(),
      calendar: this.calendar,
      nations: this.nations,
      blocs: this.blocs,
      world,
      economy: this.economy,
      politics: this.politics,
      diplomacy: this.diplomacy,
      military: this.military,
      naval: this.naval,
      territory: this.territory,
      nuclear: this.nuclear,
      ai: this.ai,
      tech: this.tech,
      events: this.events,
      schedule: this.schedule,
      intel: this.intel,
      exile: this.exile,
      journal: this.journal,
      metrics: this.metrics,
      tilesInfo: { width: grid.width, height: grid.height },
    });
    return {
      ...state,
      tiles: grid.tiles,
      contest: grid.contest ?? new Uint16Array(grid.tiles.length),
    };
  }

  apply(command: PlayerCommand): void {
    this.applyCommand(command);
    // J7b: a command that moved land (a peace, a landing) moved its people.
    this.applyOccupation();
  }

  private applyCommand(command: PlayerCommand): void {
    this.assertInitialized();
    const cmd = PlayerCommandSchema.parse(command);
    const date = this.calendar.date;
    switch (cmd.type) {
      case "set-speed":
        this.calendar.speed = cmd.speed;
        return;
      case "set-tax": {
        // Sliders have a progressive effect (J4): the command sets the
        // target, the value in effect follows it month after month.
        const economy = this.playerEconomy();
        economy.taxTargets[cmd.tax] = Math.min(
          cmd.rate,
          this.deps.config.budget.maxTaxRate[cmd.tax],
        );
        return;
      }
      case "set-spending": {
        const economy = this.playerEconomy();
        economy.spendingTargets[cmd.post] = Math.min(
          cmd.share,
          spendingCeiling(this.ctx, economy, cmd.post),
        );
        return;
      }
      case "set-embargo": {
        const known = (id: string) =>
          id === ROW_ID || this.economy.nations[id] !== undefined;
        if (!known(cmd.from) || !known(cmd.to) || cmd.from === cmd.to) {
          throw new Error(`embargo: unknown pair ${cmd.from} -> ${cmd.to}`);
        }
        const list = this.economy.market.embargoes;
        const at = list.findIndex(
          (e) => e.from === cmd.from && e.to === cmd.to && e.good === cmd.good,
        );
        if (cmd.active && at < 0) {
          list.push({ from: cmd.from, to: cmd.to, good: cmd.good });
        } else if (!cmd.active && at >= 0) list.splice(at, 1);
        return;
      }
      case "set-sanctions": {
        const me = this.requirePlayer();
        if (!this.ctx.nationIds.includes(cmd.against)) {
          throw new Error(`sanctions: unknown nation ${cmd.against}`);
        }
        if (
          !cmd.active &&
          blocSanction(this.ctx, this.blocs, me, cmd.against)
        ) {
          throw new Error("sanctions: held by a bloc, lifted by its vote");
        }
        const event = cmd.active
          ? imposeSanctions(
              this.ctx,
              this.diplomacy,
              this.economy,
              me,
              cmd.against,
              date,
            )
          : liftSanctions(
              this.ctx,
              this.diplomacy,
              this.economy,
              me,
              cmd.against,
            );
        // J7: its allies that keep theirs resent a lift.
        if (!cmd.active && event !== null) {
          playerLiftCost(this.ctx, this.diplomacy, me, cmd.against);
        }
        if (event !== null) this.record(date, event, undefined, "player");
        return;
      }
      case "declare-war": {
        const me = this.requirePlayer();
        // J7c: no war on a nation without land to fight for.
        if (this.beyondReach(cmd.target)) {
          throw new Error("declare-war: the target has no land");
        }
        const event = declareWar(
          this.ctx,
          this.diplomacy,
          this.politics,
          this.military,
          this.scenario,
          me,
          cmd.target,
          cmd.casusBelli,
          date,
        );
        this.record(date, event);
        this.invalidateFronts();
        return;
      }
      case "raise-division": {
        const me = this.requirePlayer();
        const cap = this.diplomacy.demilitarized.find((d) => d.nation === me);
        raiseDivision(
          this.ctx,
          this.military.nations[me],
          cmd.template,
          cap?.maxDivisions ?? null,
        );
        return;
      }
      case "disband-division":
        disbandDivision(
          this.military.nations[this.requirePlayer()],
          cmd.division,
        );
        return;
      case "assign-division":
        assignDivision(
          this.military.nations[this.requirePlayer()],
          cmd.division,
          cmd.front,
          cmd.segment,
        );
        return;
      case "set-posture":
        setPosture(
          this.military.nations[this.requirePlayer()],
          cmd.division,
          cmd.posture,
        );
        return;
      case "set-conscription": {
        const me = this.requirePlayer();
        const ceiling = lawModifiers(
          this.ctx,
          this.politics.nations[me],
        ).conscriptionCeiling;
        const order = ["peace", "partial", "total"] as const;
        const level =
          ceiling !== null && order.indexOf(cmd.level) > order.indexOf(ceiling)
            ? ceiling
            : cmd.level;
        setConscription(
          this.ctx,
          this.military.nations[me],
          populationOf(this.economy, this.sheets, me),
          level,
        );
        return;
      }
      case "propose-peace": {
        const me = this.requirePlayer();
        const war = this.diplomacy.wars.find((w) => w.id === cmd.war);
        if (war === undefined) throw new Error(`no war ${cmd.war}`);
        const mySide = warSide(war, me);
        const theirSide = warSide(war, cmd.to);
        if (mySide === null || theirSide === null || mySide === theirSide) {
          throw new Error(`${cmd.to} is not an enemy in ${cmd.war}`);
        }
        this.offerPeace(war, me, cmd.to, cmd.terms, date);
        return;
      }
      case "answer-peace": {
        const me = this.requirePlayer();
        const found = findOffer(this.diplomacy, cmd.offer);
        if (found === undefined || found.offer.to !== me) {
          throw new Error(`no pending offer ${cmd.offer} for ${me}`);
        }
        if (cmd.accept) this.sign(found.war, found.offer, date);
        else this.record(date, refuseOffer(found.war, found.offer));
        return;
      }
      case "set-blockade": {
        const me = this.requirePlayer();
        if (!this.ctx.nationIds.includes(cmd.target)) {
          throw new Error(`blockade: unknown nation ${cmd.target}`);
        }
        setBlockade(
          this.naval,
          this.deps.world.naval(),
          me,
          cmd.target,
          cmd.active,
        );
        this.navalDay();
        return;
      }
      case "air-strike": {
        const me = this.requirePlayer();
        const war = warOf(this.diplomacy, me, cmd.target);
        if (war === undefined) throw new Error(`${cmd.target} is not an enemy`);
        const damage = orderAirStrike(
          this.ctx,
          this.military,
          this.economy,
          me,
          cmd.target,
          date,
        );
        this.record(date, {
          type: "air-strike",
          nation: me,
          target: cmd.target,
          war: war.id,
          damage,
        });
        return;
      }
      case "set-fleet":
        setFleetZone(this.ctx, this.naval, this.requirePlayer(), cmd.zone);
        this.navalDay();
        return;
      case "set-objective": {
        const objectives =
          this.military.nations[this.requirePlayer()].objectives;
        const key = `${cmd.front}#${cmd.segment}`;
        if (cmd.tile === null) delete objectives[key];
        else objectives[key] = cmd.tile;
        return;
      }
      case "landing": {
        const me = this.requirePlayer();
        if (!enemiesOf(this.diplomacy, me).includes(cmd.target)) {
          throw new Error(`${cmd.target} is not an enemy`);
        }
        const zone = this.deps.world.landingZone(me, cmd.target);
        const control =
          zone === null
            ? 0
            : landingControl(
                this.naval,
                zone,
                me,
                enemiesOf(this.diplomacy, me),
              );
        if (
          zone === null ||
          control < this.deps.config.naval.landingControl ||
          !this.deps.world.launchLanding(
            me,
            cmd.target,
            this.deps.config.naval.landingRadius,
          )
        ) {
          this.record(date, {
            type: "landing-refused",
            nation: me,
            target: cmd.target,
          });
          return;
        }
        this.record(date, { type: "landing", nation: me, target: cmd.target });
        this.invalidateFronts();
        return;
      }
      case "enact-law": {
        const me = this.requirePlayer();
        const law = this.ctx.law(cmd.law);
        const { events, once } = enactLaw(
          this.ctx,
          me,
          this.politics.nations[me],
          this.economy.nations[me],
          law,
          date,
        );
        for (const event of events) this.record(date, event);
        hitDemocracyRelations(
          this.ctx,
          this.diplomacy,
          this.politics,
          me,
          once.democracyRelations,
        );
        this.syncSuspensions();
        return;
      }
      case "repeal-law": {
        const me = this.requirePlayer();
        const events = repealLaw(
          this.ctx,
          me,
          this.politics.nations[me],
          this.ctx.law(cmd.law),
          true,
        );
        for (const event of events) this.record(date, event);
        return;
      }
      case "set-lever": {
        const me = this.requirePlayer();
        const cfg = this.deps.config.politics.elections;
        const levers = this.politics.nations[me].levers;
        if (cmd.propagandaPctGdp !== undefined) {
          levers.propagandaPctGdp = Math.min(
            cmd.propagandaPctGdp,
            cfg.propagandaMaxPctGdp,
          );
        }
        if (cmd.fraud !== undefined)
          levers.fraud = Math.min(cmd.fraud, cfg.fraudMax);
        if (cmd.clientelism !== undefined) levers.clientelism = cmd.clientelism;
        return;
      }
      case "pin-objective": {
        const me = this.requirePlayer();
        pinObjective(
          this.ctx,
          this.politics,
          cmd.objective,
          this.objectiveWorld(me),
        );
        return;
      }
      case "unpin-objective":
        this.requirePlayer();
        unpinObjective(this.politics, cmd.objective);
        return;
      case "exile-negotiate": {
        const me = this.requirePlayer();
        const state = this.exile.nations[me];
        if (this.statusOf(me) !== "exiled" || state === undefined) {
          throw new Error("exile-negotiate: the nation is not in exile");
        }
        this.negotiate(me, state, date, true);
        return;
      }
      case "last-stand": {
        const me = this.requirePlayer();
        if (!this.lastStandChoices().includes(cmd.nation)) {
          throw new Error(`last-stand: ${cmd.nation} is not a choice`);
        }
        this.lastStand(me, cmd.nation, date);
        return;
      }
      case "nuclear-launch": {
        const me = this.requirePlayer();
        if (!enemiesOf(this.diplomacy, me).includes(cmd.target)) {
          throw new Error("nuclear-launch: not at war with the target");
        }
        const env = this.nuclearEnv(date);
        const chosen =
          cmd.aim === "front"
            ? aimOf(env, me, cmd.target)
            : { aim: { kind: "capital" as const }, kind: "capital" as const };
        const events = launch(env, me, cmd.target, chosen.aim, chosen.kind);
        if (events.length === 0) {
          throw new Error("nuclear-launch: no warhead or no vector");
        }
        for (const event of events) this.record(date, event);
        return;
      }
      case "add-note": {
        const me = this.requirePlayer();
        this.politics.player.notes.push({ date, text: cmd.text });
        this.record(date, { type: "note", nation: me, text: cmd.text });
        return;
      }
      case "bloc-propose": {
        const me = this.requirePlayer();
        const politics = this.politics.nations[me];
        const cost = this.deps.config.blocs.capitalCost[cmd.kind];
        if (politics.capital < cost) {
          throw new Error("bloc-propose: not enough political capital");
        }
        const events = propose(this.blocEnv(date), {
          bloc: cmd.bloc,
          by: me,
          kind: cmd.kind,
          target: cmd.target,
          direction: cmd.direction,
        });
        politics.capital -= cost;
        for (const event of events) this.record(date, event);
        return;
      }
      case "bloc-vote":
        castVote(
          this.blocEnv(date),
          this.requirePlayer(),
          cmd.proposal,
          cmd.vote,
        );
        return;
      case "bloc-apply": {
        const me = this.requirePlayer();
        for (const event of applyForMembership(
          this.blocEnv(date),
          me,
          cmd.bloc,
        )) {
          this.record(date, event);
        }
        return;
      }
      case "bloc-leave": {
        const me = this.requirePlayer();
        for (const event of leaveBloc(this.blocEnv(date), me, cmd.bloc)) {
          this.record(date, event);
        }
        return;
      }
      case "tech-research":
        startResearch(this.techEnv(date), this.requirePlayer(), cmd.node);
        return;
      case "tech-cancel":
        cancelResearch(this.techEnv(date), this.requirePlayer(), cmd.node);
        return;
      case "event-choose": {
        this.requirePlayer();
        for (const event of chooseEvent(
          this.eventsEnv(date),
          cmd.id,
          cmd.choice,
        )) {
          if (event.type === "event-occurred") this.record(date, event);
        }
        this.invalidateFronts();
        return;
      }
      case "bloc-honor": {
        const me = this.requirePlayer();
        for (const event of honorCall(
          this.blocEnv(date),
          me,
          cmd.bloc,
          cmd.war,
        )) {
          this.record(date, event);
        }
        this.invalidateFronts();
        return;
      }
    }
  }

  advance(gameMinutes: number): SimEvent[] {
    this.assertInitialized();
    if (!(gameMinutes >= 0)) throw new Error("advance: negative duration");
    const events: SimEvent[] = [];
    const tick = this.deps.config.time.gameMinutesPerTick;
    const from = this.calendar.elapsedGameMinutes;
    const to = from + gameMinutes;
    // J7: the work of the simulation is indexed on the core ticks it
    // crosses: advancing tick by tick or in one call gives the same state.
    for (let t = Math.floor(from / tick) + 1; t <= Math.floor(to / tick); t++) {
      const before = this.calendar.elapsedGameMinutes;
      const now = t * tick;
      this.calendar.elapsedGameMinutes = now;
      this.calendar.date = dateAfter(this.calendar.startDate, now);
      this.deps.world.setMonth(this.currentMonth());
      for (const day of this.scheduler.run(
        this.calendar.startDate,
        before,
        now,
      )) {
        events.push({ type: "day-started", date: day.context.date });
        if (day.monthStarted) {
          events.push({ type: "month-started", date: day.context.date });
        }
      }
      this.tickWork(t, now);
    }
    this.calendar.elapsedGameMinutes = to;
    this.calendar.date = dateAfter(this.calendar.startDate, to);
    this.deps.world.setMonth(this.currentMonth());
    events.push(...this.pending);
    this.pending = [];
    this.metrics[METRIC_ADVANCE_CALLS] =
      (this.metrics[METRIC_ADVANCE_CALLS] ?? 0) + 1;

    this.refreshTileCounts();
    for (const nation of this.nations) {
      const next = statusFromTerritory(nation);
      if (next === nation.status) continue;
      const event: SimEvent = {
        type: "nation-status-changed",
        date: this.calendar.date,
        nation: nation.id,
        from: nation.status,
        to: next,
      };
      nation.status = next;
      events.push(event);
      this.addJournal({
        date: event.date,
        kind: "nation-status",
        nation: nation.id,
        params: { from: event.from, to: event.to },
      });
      // J7c: into exile, or back from it.
      if (next === "exiled") {
        this.exile.nations[nation.id] = openExile(
          this.exileEnv(event.date),
          nation.id,
          this.occupantOf(nation.id),
        );
      } else if (next === "active") {
        delete this.exile.nations[nation.id];
      }
    }
    return events;
  }

  // --- exile (J7c, sim/exile/exile.ts) -------------------------------------------

  private statusOf(id: NationId): string {
    return this.nations.find((n) => n.id === id)?.status ?? "active";
  }

  private exileEnv(date: string): ExileEnv {
    return {
      rules: this.deps.config.exile,
      diplomacy: this.diplomacy,
      economy: this.economy,
      nations: this.nations,
      blocsOf: (nation) =>
        this.blocs.blocs
          .filter((b) =>
            b.members.some((m) => m.nation === nation && m.status === "full"),
          )
          .map((b) => b.id),
      membersOf: (bloc) =>
        this.blocs.blocs
          .find((b) => b.id === bloc)
          ?.members.filter((m) => m.status === "full")
          .map((m) => m.nation) ?? [],
      date,
    };
  }

  // The nation that holds most of the first-day land of `id` (people, else
  // tiles); null when nobody does.
  private occupantOf(id: NationId): NationId | null {
    const held = this.deps.world.homelandHeld(id);
    const counts = held.people.size > 0 ? held.people : held.tiles;
    let best: NationId | null = null;
    let most = 0;
    for (const [n, c] of [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (n === id || c <= most) continue;
      best = n;
      most = c;
    }
    return best;
  }

  // The nation that weighs a war against each nation (the intent of its AI,
  // gain over cost at least 1; the first by id), once a tick (J7c).
  private threats(): Map<NationId, NationId> {
    const at = this.calendar.elapsedGameMinutes;
    if (this.threatCache?.at === at) return this.threatCache.map;
    const map = new Map<NationId, NationId>();
    for (const id of this.ctx.nationIds) {
      const intent = this.ai.nations[id]?.intent;
      if (intent === null || intent === undefined || intent.ratio < 1) continue;
      const known = map.get(intent.target);
      if (known === undefined || id < known) map.set(intent.target, id);
    }
    this.threatCache = { at, map };
    return map;
  }

  private threatCache: { at: number; map: Map<NationId, NationId> } | null =
    null;

  // The stability each occupant loses to the resistance of the governments
  // in exile whose land it holds (J7c), from the world as it is now.
  private resistanceMap(): Map<NationId, number> {
    // Once a tick: the conditions of the events read it for every nation.
    const at = this.calendar.elapsedGameMinutes;
    if (this.resistanceCache?.at === at) return this.resistanceCache.map;
    const map = this.computeResistance();
    this.resistanceCache = { at, map };
    return map;
  }

  private resistanceCache: { at: number; map: Map<NationId, number> } | null =
    null;

  private computeResistance(): Map<NationId, number> {
    const out = new Map<NationId, number>();
    const exiles = Object.entries(this.exile.nations).filter(
      ([, e]) => e.dissolvedAt === null,
    );
    if (exiles.length === 0) return out;
    const world = this.deps.world;
    const known = world.peopleKnown();
    const holdings = known ? world.peopleHoldings() : world.tileCounts();
    const occupied = new Map<NationId, number>();
    for (const [id] of exiles) {
      const held = world.homelandHeld(id);
      for (const [n, c] of known ? held.people : held.tiles) {
        if (n === id) continue;
        occupied.set(n, (occupied.get(n) ?? 0) + c);
      }
    }
    for (const [n, c] of occupied) {
      const m = resistanceMalus(
        this.deps.config.exile,
        c,
        holdings.get(n) ?? 0,
      );
      if (m > 0) out.set(n, m);
    }
    return out;
  }

  // `months` of a government in exile: its recognition, its support, its
  // dissolution; the collapse of its occupant; an AI exile tries to
  // negotiate its return now and then.
  private exileOf(
    id: NationId,
    months: number,
    date: string,
    isAi: boolean,
  ): void {
    let state = this.exile.nations[id];
    if (state === undefined) {
      // An exile of a save of before the J7c: opened at its first update.
      state = openExile(this.exileEnv(date), id, this.occupantOf(id));
      this.exile.nations[id] = state;
    }
    // The occupant may have changed hands itself.
    const occupant = this.occupantOf(id);
    if (occupant !== null) state.annexer = occupant;
    const rules = this.deps.config.exile;
    if (
      isAi &&
      state.annexer !== null &&
      state.annexer !== this.playerNationId() &&
      (state.lastNegotiation === null ||
        monthIndex(state.lastNegotiation, date) >=
          rules.negotiation.cooldownMonths) &&
      this.rng.chance(
        Math.min(1, rules.negotiation.monthlyProbability * months),
      )
    ) {
      if (this.negotiate(id, state, date, false)) return;
    }
    const outcome = stepExile(this.exileEnv(date), id, state, months);
    if (outcome.kind === "dissolved") this.dissolve(id, outcome.reason, date);
  }

  // A negotiated return: the annexer gives the land back when the
  // resistance weighs on it and it is weak or sanctioned. True when it did.
  private negotiate(
    id: NationId,
    state: ExileState,
    date: string,
    byPlayer: boolean,
  ): boolean {
    state.lastNegotiation = date;
    const annexer = state.annexer;
    if (annexer === null || annexer === this.playerNationId()) {
      if (byPlayer) throw new Error("exile-negotiate: no annexer to ask");
      return false;
    }
    const accepts = acceptsReturn(
      this.deps.config.exile,
      this.resistanceMap().get(annexer) ?? 0,
      this.politics.nations[annexer]?.stability ?? 1,
      this.lostTradeShare(annexer, true),
    );
    if (!accepts) {
      if (byPlayer) {
        this.record(date, {
          type: "exile-negotiation",
          nation: id,
          by: annexer,
        });
      }
      return false;
    }
    return this.giveBack(id, annexer, "negotiation", date) > 0;
  }

  // The first-day land of `id` that `from` holds goes back to it.
  private giveBack(
    id: NationId,
    from: NationId,
    way: "liberation" | "collapse" | "negotiation",
    date: string,
  ): number {
    const tiles = this.deps.world.returnHomeland(id, from);
    if (tiles <= 0) return 0;
    this.invalidateFronts();
    this.applyOccupation();
    this.record(date, {
      type: "exile-returned",
      nation: id,
      way,
      by: from,
      tiles,
    });
    return tiles;
  }

  // At a peace: the land of a government in exile that a nation of the
  // other side took from its annexer goes back to it, if that nation is
  // its friend.
  private liberate(war: War, date: string): void {
    const rules = this.deps.config.exile;
    for (const [id, state] of Object.entries(this.exile.nations)) {
      if (state.dissolvedAt !== null || state.annexer === null) continue;
      const liberators = war.aggressors.includes(state.annexer)
        ? war.defenders
        : war.defenders.includes(state.annexer)
          ? war.aggressors
          : [];
      for (const n of liberators) {
        if (
          n === id ||
          relation(this.diplomacy, n, id) < rules.liberatorRelation
        )
          continue;
        const tiles = this.deps.world.returnHomeland(id, n);
        if (tiles <= 0) continue;
        this.invalidateFronts();
        this.applyOccupation();
        this.record(date, {
          type: "exile-returned",
          nation: id,
          way: "liberation",
          by: n,
          tiles,
        });
      }
    }
  }

  // Dissolution: the state is no more. It leaves its blocs, its wars and its
  // sanctions; the record of its exile stays (dissolvedAt).
  private dissolve(
    id: NationId,
    reason: "recognized" | "threshold",
    date: string,
  ): void {
    const nation = this.nations.find((n) => n.id === id);
    if (nation === undefined || nation.status === "dissolved") return;
    const from = nation.status;
    nation.status = "dissolved";
    const state = this.exile.nations[id];
    if (state !== undefined) state.dissolvedAt = date;
    for (const bloc of this.blocs.blocs) {
      bloc.members = bloc.members.filter((m) => m.nation !== id);
    }
    syncBlocs(this.ctx, this.blocs);
    this.diplomacy.sanctions = this.diplomacy.sanctions.filter(
      (s) => s.by !== id && s.against !== id,
    );
    for (const war of this.diplomacy.wars) {
      war.aggressors = war.aggressors.filter((n) => n !== id);
      war.defenders = war.defenders.filter((n) => n !== id);
    }
    this.diplomacy.wars = this.diplomacy.wars.filter(
      (w) => w.aggressors.length > 0 && w.defenders.length > 0,
    );
    this.invalidateFronts();
    this.pending.push({
      type: "nation-status-changed",
      date,
      nation: id,
      from,
      to: "dissolved",
    });
    this.addJournal({
      date,
      kind: "nation-status",
      nation: id,
      params: { from, to: "dissolved", reason },
    });
  }

  // The nations the player's dissolved nation may hand over to: alive,
  // fewer than lastStandMaxPopulation people, not the annexer.
  private lastStandChoices(): NationId[] {
    const me = this.playerNationId();
    if (me === null || this.statusOf(me) !== "dissolved") return [];
    const annexer = this.exile.nations[me]?.annexer ?? null;
    const max = this.deps.config.exile.lastStandMaxPopulation;
    return this.nations
      .filter(
        (n) =>
          n.id !== me &&
          n.id !== annexer &&
          n.status === "active" &&
          (this.economy.nations[n.id]?.population ?? Infinity) < max,
      )
      .map((n) => n.id);
  }

  // The last stand: the player goes on with a small nation of the same
  // world, the journal intact.
  private lastStand(from: NationId, to: NationId, date: string): void {
    const old = this.nations.find((n) => n.id === from)!;
    const next = this.nations.find((n) => n.id === to)!;
    old.isPlayer = false;
    next.isPlayer = true;
    const politics = this.politics.nations[to];
    politics.groups ??= Object.fromEntries(
      INTEREST_GROUPS.map((g) => [g, politics.opinion]),
    ) as NonNullable<typeof politics.groups>;
    this.exile.lastStands.push({ date, from, to });
    this.record(date, { type: "last-stand", nation: to, from });
  }

  // --- the tick (J7) ------------------------------------------------------------

  // Everything but the day and month clocks, at the tick `t` (elapsed
  // `now`): the draws of the events of this slot of the day, the session of
  // the blocs that meet today, the turn of a good, the nations due, and
  // the fronts.
  private tickWork(t: number, now: number): void {
    const probe = this.deps.perf ?? NULL_PROBE;
    const tick = this.deps.config.time.gameMinutesPerTick;
    const slots = Math.max(1, Math.round(MINUTES_PER_GAME_DAY / tick));
    const slot = Math.round((now % MINUTES_PER_GAME_DAY) / tick) % slots;
    const date = this.calendar.date;
    probe.measure("events", "tick", () => {
      const env = this.eventsEnv(date);
      for (const event of stepEventsDraws(env, slot, slots)) {
        this.recordEvent(date, event);
      }
    });
    // The blocs meet at the middle of their session day.
    if (slot === Math.floor(slots / 2)) {
      const day = Number(date.slice(8, 10));
      for (const bloc of this.blocs.blocs) {
        if (sessionDay(bloc.id) !== day) continue;
        probe.measure("blocs", "tick", () => this.blocSession(bloc.id, date));
      }
    }
    probe.measure("trade", "tick", () => this.tradeTurn(t));
    probe.measure("nations", "tick", () => {
      for (const id of dueNations(
        this.schedule,
        this.ctx.nationIds,
        now,
        this.deps.config.schedule.maxUpdatesPerTick,
      )) {
        this.updateNation(id, now);
      }
    });
    probe.measure("war", "tick", () => {
      this.resolveFronts(tick);
      this.applyOccupation();
    });
  }

  // J7b: land that changed hands (a front, a landing, an annexation)
  // carries its share of the people, production, consumption and GDP of the
  // nation that lost it — the share of the people it held (the population
  // grid of the scenario) — the occupier getting war.transfer.
  // productionShare of the production and the GDP; a nation keeps at least
  // residualShare of its first-day GDP, whatever it loses. In a war, the
  // people occupied
  // score (war.warScore.peopleValue a million, contested), and so do a
  // capital and the three largest cities of a nation. Taken every tick and
  // after every command: nothing waits in the world when it is saved.
  private applyOccupation(): void {
    const world = this.deps.world;
    if (!world.peopleKnown()) return;
    const { moves, cities } = world.takeOccupations();
    if (moves.length === 0 && cities.length === 0) return;
    const cfg = this.deps.config.war;
    // The people each nation held before these moves.
    const held = new Map(world.peopleHoldings());
    for (const m of moves) {
      held.set(m.from, (held.get(m.from) ?? 0) + m.people);
      held.set(m.to, (held.get(m.to) ?? 0) - m.people);
    }
    const score = (war: War, nation: NationId, value: number) => {
      war.score[nation] = (war.score[nation] ?? 0) + value;
      war.landValue[nation] = (war.landValue[nation] ?? 0) + value;
    };
    for (const m of moves) {
      const before = held.get(m.from) ?? 0;
      held.set(m.from, before - m.people);
      held.set(m.to, (held.get(m.to) ?? 0) + m.people);
      const loser = this.economy.nations[m.from];
      const winner = this.economy.nations[m.to];
      if (before <= 0 || loser === undefined || winner === undefined) continue;
      // What a nation keeps whatever it loses: residualShare of its GDP of
      // the first day (the sheet) — a floor that does not shrink loss after
      // loss.
      const floor =
        cfg.transfer.residualShare * (this.sheets.get(m.from)?.gdp.value ?? 0);
      const f = Math.max(
        0,
        Math.min(m.people / before, loser.gdp > 0 ? 1 - floor / loser.gdp : 0),
      );
      if (f <= 0) continue;
      const people = f * loser.population;
      loser.population -= people;
      winner.population += people;
      const share = cfg.transfer.productionShare;
      const gdp = f * loser.gdp;
      loser.gdp -= gdp;
      winner.gdp += share * gdp;
      for (const good of Object.keys(loser.production)) {
        const made = f * loser.production[good];
        loser.production[good] -= made;
        winner.production[good] = (winner.production[good] ?? 0) + share * made;
        const used = f * loser.consumption[good];
        loser.consumption[good] -= used;
        winner.consumption[good] = (winner.consumption[good] ?? 0) + used;
      }
      const war = warOf(this.diplomacy, m.from, m.to);
      if (war !== undefined) {
        score(
          war,
          m.to,
          (people / 1e6) * cfg.warScore.peopleValue * cfg.contest.valueShare,
        );
      }
    }
    for (const c of cities) {
      const war = warOf(this.diplomacy, c.from, c.to);
      if (war === undefined) continue;
      score(
        war,
        c.to,
        c.capital ? cfg.warScore.capitalValue : cfg.warScore.cityValue,
      );
    }
  }

  // The goods take turns (J7): the twelve over tradeCycleDays, one at a
  // time, each with the months since its last turn (the length of a cycle).
  private tradeTurn(t: number): void {
    const cfg = this.deps.config;
    const cycle = Math.max(
      1,
      Math.round(
        (cfg.schedule.tradeCycleDays * MINUTES_PER_GAME_DAY) /
          cfg.time.gameMinutesPerTick,
      ),
    );
    const goods = this.ctx.goods.length;
    const turn = Math.floor((t * goods) / cycle);
    if (turn === Math.floor(((t - 1) * goods) / cycle)) return;
    const good = this.ctx.goods[turn % goods];
    const months = (cycle * cfg.time.gameMinutesPerTick) / MINUTES_PER_MONTH;
    const blockade = this.naval.blockade;
    stepTradeGood(
      this.ctx,
      this.economy,
      good,
      (e, i) => (1 - (blockade[e] ?? 0)) * (1 - (blockade[i] ?? 0)),
      months,
      this.affinities(),
    );
    refreshTradeAggregates(this.ctx, this.economy);
  }

  // The affinities of the trade pairs, computed again only when what they
  // read changed: the full members of the blocs, the suspensions, the
  // trade agreements.
  private affinityCache: { key: string; value: TradeAffinities } | null = null;
  private affinities(): TradeAffinities {
    const parts: string[] = [];
    for (const bloc of this.ctx.blocs) {
      if (bloc.tradeBonus === undefined) continue;
      parts.push(bloc.id, ...this.ctx.membersOf(bloc.id));
    }
    parts.push("|", ...this.ctx.pairBonus.keys());
    const key = parts.join(",");
    if (this.affinityCache === null || this.affinityCache.key !== key) {
      this.affinityCache = { key, value: tradeAffinities(this.ctx) };
    }
    return this.affinityCache.value;
  }

  // --- the rolling queue of the nations (J7) ----------------------------------

  // The cadence of a nation at the moment (sim/schedule.ts).
  private cadence(id: NationId): number {
    const player = this.politics.autopilot ? null : this.playerNationId();
    return cadenceDays(this.deps.config, id, {
      player,
      stakes: (n) => this.nationHasStakes(n),
      interacts: (n) => player !== null && this.dealsWith(n, player),
    });
  }

  // A war, a crisis, a dispute with the player, an election soon.
  private nationHasStakes(id: NationId): boolean {
    if (hasStakes(this.aiEnv(this.calendar.date), id)) return true;
    const next = this.politics.nations[id]?.nextElection ?? null;
    if (next === null) return false;
    return (
      daysBetweenDates(this.calendar.date, next) <=
      this.deps.config.schedule.electionSoonDays
    );
  }

  // A land neighbour of the player, at war with it, or in a bloc with it.
  private dealsWith(id: NationId, player: NationId): boolean {
    if (this.ctx.landNeighbours(id, player)) return true;
    if (this.ctx.commonBlocs(id, player) > 0) return true;
    return enemiesOf(this.diplomacy, player).includes(id);
  }

  // One update of a nation: everything that happened to it since the last
  // one, the months elapsed integrated by each domain, in this order: its
  // arms sent abroad, the military, the strikes it suffers, growth and
  // population, the sliders, the budget and the AI fiscal rule, research,
  // opinion and stability, the political engine, the player's objectives,
  // its diplomacy, its applications to blocs, the review of its AI and its
  // war orders.
  private updateNation(id: NationId, now: number): void {
    // J7c: a dissolved state has nothing left to update.
    if (this.statusOf(id) === "dissolved") {
      reschedule(
        this.schedule,
        id,
        now,
        this.deps.config.schedule.calmDays,
        this.deps.config.time.gameMinutesPerTick,
      );
      return;
    }
    const clock = this.schedule.nations[id];
    const minutes = Math.max(0, now - clock.last);
    const months = minutes / MINUTES_PER_MONTH;
    const days = minutes / MINUTES_PER_GAME_DAY;
    const date = this.calendar.date;
    const economy = this.economy.nations[id];
    const politics = this.politics.nations[id];
    const sheet = this.sheets.get(id)!;
    const player = this.playerNationId();
    const isAi = id !== player || this.politics.autopilot;
    const month = calendarMonth(this.calendar.startDate, date);
    const crossed = Math.max(0, month - economy.monthMark);
    economy.monthMark = month;
    const atWar = enemiesOf(this.diplomacy, id).length > 0;
    const modifiers = lawModifiers(this.ctx, politics);

    // Arms sent abroad (a donor at peace), paid at once.
    let lump = 0;
    if (isAi) {
      const flow = armsFlowOf(this.aiEnv(date), id, months);
      lump -= flow.cost;
      for (const event of flow.events) this.record(date, event);
    }

    // The military: pool, arms, training, exhaustion.
    stepMilitaryMonth(
      this.ctx,
      this.military.nations[id],
      sheet,
      economy,
      politics,
      atWar,
      (1 + modifiers.manpowerBonus) * (this.nuclear.fallout[id] ?? 1),
      0,
      months,
      economy.population,
    );
    // The strikes of the strongest enemy in the air, decaying.
    this.airStrikesOn(id, months);
    // J7c: its contaminated land.
    this.contaminationOn(id);
    // J7c: a government in exile.
    if (this.statusOf(id) === "exiled") this.exileOf(id, months, date, isAi);

    // Growth and population.
    growNation(
      this.ctx,
      this.economy,
      id,
      politics.unrest,
      this.rng,
      months,
      this.lostTradeShare(id),
      (this.ctx.techModifiers.get(id)?.growth ?? 0) +
        eventGrowth(this.events, id),
      populationFactor(
        this.deps.config,
        sheet.populationGrowth?.value,
        clock.last / MINUTES_PER_YEAR,
        now / MINUTES_PER_YEAR,
      ),
    );
    stepSliders(this.ctx, economy, months);

    // The budget: transfers per month, the one-offs of the period; the
    // structures built on the map are paid the month after (J5), at the
    // first update of the nation in the new month.
    if (crossed > 0) lump -= this.constructionOf(id);
    if (!atWar) {
      economy.grantsPctGdp *= Math.pow(
        1 - this.deps.config.budget.grantsPeaceDecayPerMonth,
        months,
      );
    }
    const levers = isAi ? 0 : this.leverCostPerMonth(id, months);
    const corruption = clamp01(politics.corruption + modifiers.corruption);
    for (const event of stepBudget(
      this.ctx,
      id,
      economy,
      politics,
      { date, month, months, monthsCrossed: crossed },
      this.transferPerMonth(id) - levers,
      lump,
      this.deps.config.politics.corruptionLeakScale * corruption,
    )) {
      this.record(date, event);
    }
    if (isAi) {
      stepFiscalRule(
        this.ctx,
        economy,
        { defense: this.ai.nations[id]?.defenseGoal, atWar },
        months,
      );
    }

    // Research.
    for (const event of stepTechNation(
      this.updateTechEnv(date),
      id,
      months,
      isAi,
    )) {
      if (id === player || event.params.first === "true") {
        this.record(date, event);
      }
    }

    // Opinion, stability, then the political engine.
    const conflicts = this.deps.data.internalConflicts ?? [];
    const years = now / (MINUTES_PER_GAME_DAY * 365.25);
    for (const event of stepPolitics(
      this.ctx,
      id,
      sheet,
      economy,
      politics,
      this.military.nations[id]?.exhaustion ?? 0,
      this.lostTradeShare(id, true),
      modifiers.groups,
      internalConflictMalus(this.ctx, conflicts, id, years) +
        (this.resistanceMap().get(id) ?? 0),
      months * WEEKS_PER_MONTH,
    )) {
      this.record(date, event);
    }
    this.politicsOf(id, date, months, crossed, isAi);
    if (id === player && !this.politics.autopilot) {
      for (const event of stepObjectivesMonth(
        this.ctx,
        id,
        this.politics,
        this.objectiveWorld(id),
        crossed,
      )) {
        this.record(date, event);
      }
    }

    // Diplomacy: the relations it owns, sanctions, coalitions, memory.
    const before = this.diplomacy.wars.length;
    const joined = this.diplomacy.wars.reduce(
      (s, w) => s + w.aggressors.length + w.defenders.length,
      0,
    );
    // The relations it owns drift at most once a month (every day for the
    // player's: they are on its screens).
    const sinceDrift = (now - clock.drift) / MINUTES_PER_MONTH;
    const drift = id === player || sinceDrift >= 1 ? sinceDrift : 0;
    if (drift > 0) clock.drift = now;
    const aggressor = this.diplomacy.wars.some((w) =>
      w.aggressors.includes(id),
    );
    const standing = aggressor
      ? this.ctx.nationIds.map((p) => relation(this.diplomacy, id, p))
      : null;
    const step = stepDiplomacyNation(
      this.diplomacyEnv(date),
      id,
      months,
      drift,
    );
    // An aggressor whose relations fall through the threshold of sanctions:
    // the nations concerned weigh their sanctions at the next tick, as they
    // did in the same monthly step until the J6, rather than at their next
    // weekly or monthly update.
    if (standing !== null) {
      const below = this.deps.config.diplomacy.sanction.relationsBelow;
      this.ctx.nationIds.forEach((p, k) => {
        if (p === id || standing[k] < below) return;
        if (relation(this.diplomacy, id, p) >= below) return;
        hasten(
          this.schedule,
          p,
          now,
          0,
          this.deps.config.time.gameMinutesPerTick,
        );
      });
    }
    for (const event of step.events) {
      const lift = event.type === "sanctions-lifted";
      this.record(
        date,
        event,
        undefined,
        lift ? step.lifts.shift() : undefined,
      );
    }
    if (isAi) {
      for (const event of aiApplicationsOf(this.blocEnv(date), id, months)) {
        this.record(date, event);
      }
    }

    // The AI: defence, war, navy; its war orders and ceasefires.
    if (isAi) {
      const env = this.aiEnv(date);
      for (const event of review(env, id, days)) this.record(date, event);
    }
    const after = this.diplomacy.wars.reduce(
      (s, w) => s + w.aggressors.length + w.defenders.length,
      0,
    );
    // J7c: the fronts of a war it has just entered are not in the geometry
    // of the day; its orders wait for them (they were given on the old
    // fronts, which do not hold the new enemy: every division stayed in
    // reserve until its next orders, a month later, and a nation of 29
    // divisions lost its land to one).
    if (this.diplomacy.wars.length !== before || after !== joined) {
      this.invalidateFronts();
    }
    const ordersWait = isAi
      ? this.warOrders(id, now, date, economy.population)
      : this.firstDeployment(id, now, date);

    reschedule(
      this.schedule,
      id,
      now,
      this.cadence(id),
      this.deps.config.time.gameMinutesPerTick,
    );
    // Orders waiting for the fronts of the day: the next tick.
    if (ordersWait) {
      const tick = this.deps.config.time.gameMinutesPerTick;
      hasten(this.schedule, id, now, tick / MINUTES_PER_GAME_DAY, tick);
    }
  }

  // J7b: the player's nation at war on the first day of the campaign (a
  // war of the scenario) finds its army on its fronts, deployed as the AI
  // deploys its own, defending, once the fronts are known; its reserve
  // stood behind the lines until then and the enemy walked in. Once only
  // (its lastOrders marks it). True when it waits for the fronts.
  private firstDeployment(id: NationId, now: number, date: string): boolean {
    const ai = this.ai.nations[id];
    if (
      ai === undefined ||
      ai.lastOrders !== null ||
      date !== this.scenario.startDate ||
      enemiesOf(this.diplomacy, id).length === 0
    ) {
      return false;
    }
    if (this.geometryDay !== dayIndex(now)) return true;
    ai.lastOrders = date;
    deployOnFronts(this.ctx, this.diplomacy, this.military, this.geometry, id);
    return false;
  }

  // The war orders of an AI nation (J7): its divisions on the segments of
  // its fronts, postures, levies and ceasefires, every ordersDays of its
  // own time — the monthly step gave them to every nation at once until the
  // J6; weekly orders at every update of a nation at war let a defender
  // answer every Russian push within days and the war of the scenario never
  // ended as it did — and at once when the nation enters a war, once the
  // fronts of the day are known (a war declared in this very tick has none
  // yet). True when the orders wait for them.
  private warOrders(
    id: NationId,
    now: number,
    date: string,
    population: number,
  ): boolean {
    const ai = this.ai.nations[id];
    if (
      ai.lastOrders !== null &&
      daysBetweenDates(ai.lastOrders, date) <
        this.deps.config.ai.nations.war.ordersDays
    ) {
      return false;
    }
    if (
      enemiesOf(this.diplomacy, id).length > 0 &&
      this.geometryDay !== dayIndex(now)
    ) {
      return true;
    }
    ai.lastOrders = date;
    const orders = stepWarAi(
      this.ctx,
      this.diplomacy,
      this.military,
      population,
      this.geometry,
      id,
    );
    for (const to of orders.ceasefireTo) {
      const war = this.diplomacy.wars.find(
        (w) => warSide(w, id) !== null && warSide(w, to) !== null,
      );
      if (war === undefined) continue;
      if (war.offers.some((o) => o.from === id && o.to === to)) continue;
      this.offerPeace(war, id, to, CEASEFIRE, date);
    }
    return false;
  }

  // The political engine of one nation over `months` (J4; once a month
  // until the J6): capital, legitimacy, repeals due, the player's levers,
  // elections due, the leader's age, the end of a junta, coups,
  // revolutions, the opinion shocks of an AI nation.
  private politicsOf(
    id: NationId,
    date: string,
    months: number,
    crossed: number,
    isAi: boolean,
  ): void {
    const cfg = this.deps.config.politics;
    const politics = this.politics.nations[id];
    const economy = this.economy.nations[id];
    const sheet = this.sheets.get(id);
    const regime = this.ctx.regime(politics.regime);
    const modifiers = lawModifiers(this.ctx, politics);

    politics.capital = Math.min(
      cfg.capital.max,
      politics.capital +
        cfg.capital.regenBase *
          (0.5 + politics.leader.traits.charisma) *
          (0.5 + politics.opinion) *
          months,
    );
    const legitimacyBase = clamp01(
      regime.legitimacyBase + modifiers.legitimacyBase,
    );
    politics.legitimacy = clamp01(
      politics.legitimacy +
        Math.sign(legitimacyBase - politics.legitimacy) *
          Math.min(
            cfg.legitimacy.recoveryPerMonth * months,
            Math.abs(legitimacyBase - politics.legitimacy),
          ),
    );
    for (const event of stepLawsMonth(this.ctx, id, politics, date)) {
      this.record(date, event);
    }
    // Clientelism pleases its group and feeds corruption, month by month.
    if (
      !isAi &&
      politics.levers.clientelism !== null &&
      politics.groups !== null
    ) {
      const group = politics.levers.clientelism;
      politics.groups[group] = clamp01(
        politics.groups[group] + cfg.elections.clientelismSatisfaction * months,
      );
      politics.corruption = clamp01(
        politics.corruption + cfg.elections.clientelismCorruption * months,
      );
    }

    // Elections, when due and not suspended by a war at home — or, J7c, by
    // the exile: a government in exile holds no national election (Ukraine,
    // annexed, elected a president two days later).
    if (politics.nextElection !== null && date >= politics.nextElection) {
      // (An exile nobody annexed — a test world, an emptied land — votes.)
      const exiled =
        this.statusOf(id) === "exiled" &&
        (this.exile.nations[id]?.annexer ?? null) !== null;
      const suspended =
        exiled ||
        ((sheet?.politics.electionsSuspendedAtWarAtHome ?? false) &&
          this.hasFrontAtHome(id));
      if (suspended) {
        if (!politics.electionsSuspended) {
          politics.electionsSuspended = true;
          this.record(date, {
            type: "elections-suspended",
            nation: id,
            until: exiled ? "exile" : "war",
          });
        }
      } else {
        politics.electionsSuspended = false;
        const outcome = holdElection(
          this.ctx,
          this.rng,
          id,
          politics,
          sheet,
          date,
        );
        for (const event of outcome.events) this.record(date, event);
        hitDemocracyRelations(
          this.ctx,
          this.diplomacy,
          this.politics,
          id,
          outcome.democracyRelations,
        );
        this.reinstateIfDemocratic(id);
      }
    }

    for (const event of stepLeaderAgeing(
      this.ctx,
      this.rng,
      id,
      politics,
      date,
      months,
    )) {
      this.record(date, event);
    }
    for (const event of stepJuntaTransition(
      this.ctx,
      this.rng,
      id,
      politics,
      date,
      months,
    )) {
      this.record(date, event);
    }
    const coup = stepCoups(
      this.ctx,
      this.rng,
      id,
      politics,
      this.military.nations[id],
      date,
      months,
    );
    for (const event of coup.events) this.record(date, event);
    if (coup.suspendFromBlocs) {
      hitDemocracyRelations(
        this.ctx,
        this.diplomacy,
        this.politics,
        id,
        coup.democracyRelations,
      );
      for (const bloc of this.ctx.blocs) {
        if (
          bloc.suspendsOnCoup === true &&
          this.ctx.isFullMember(bloc, id) &&
          !politics.suspendedFrom.includes(bloc.id)
        ) {
          politics.suspendedFrom.push(bloc.id);
          this.record(date, {
            type: "bloc-suspended",
            nation: id,
            bloc: bloc.id,
          });
        }
      }
      this.syncSuspensions();
    }
    for (const event of stepRevolution(
      this.ctx,
      this.rng,
      id,
      politics,
      economy,
      sheet,
      date,
      months,
      crossed,
    )) {
      this.record(date, event);
    }
    this.reinstateIfDemocratic(id);

    // AI nations: random shocks in proportion to the fragility of the
    // regime, so that they know unrest too (per sqrt(month)).
    if (politics.groups === null) {
      const sd =
        cfg.aiShock.sd *
        (1 - politics.legitimacy) *
        (1 + cfg.aiShock.coupScale * coupBaseOf(this.ctx, id, politics));
      politics.opinion = clamp01(
        politics.opinion + walkSd(sd, months) * this.rng.nextGaussian(),
      );
    }
  }

  // What the player's levers cost per month: propaganda (share of GDP) and
  // clientelism (J4).
  private leverCostPerMonth(id: NationId, months: number): number {
    void months;
    const cfg = this.deps.config.politics.elections;
    const politics = this.politics.nations[id];
    const economy = this.economy.nations[id];
    let cost = (politics.levers.propagandaPctGdp * economy.gdp) / 12;
    if (politics.levers.clientelism !== null) {
      cost += (cfg.clientelismCostPctGdp * economy.gdp) / 12;
    }
    return cost;
  }

  // Transfers per month into the budget of a nation: reparations it pays
  // or receives (a share of the payer's GDP), the net of its blocs' budgets
  // of the month.
  private transferPerMonth(id: NationId): number {
    let net = 0;
    for (const r of this.diplomacy.reparations) {
      if (r.from !== id && r.to !== id) continue;
      const payer = this.economy.nations[r.from];
      if (payer === undefined) continue;
      const amount = (r.pctGdp * payer.gdp) / 12;
      if (r.from === id) net -= amount;
      if (r.to === id) net += amount;
    }
    if (this.economy.nations[id] !== undefined) {
      net += this.blocs.net[id] ?? 0;
    }
    return net;
  }

  // The contamination of a nation's land (J7c): its production and GDP
  // follow 1 - the people-weighted contaminated share of its land, down as
  // a burst spreads it, up as it heals.
  private contaminationOn(id: NationId): void {
    const economy = this.economy.nations[id];
    const cap = this.deps.config.nuclear.contamination.shareCap;
    const share = Math.min(
      cap,
      this.deps.world.contaminatedShares().get(id) ?? 0,
    );
    const before = Math.min(cap, economy.contamination);
    if (share === before) return;
    const factor = (1 - share) / (1 - before);
    economy.gdp *= factor;
    for (const good of Object.keys(economy.production)) {
      economy.production[good] *= factor;
    }
    economy.contamination = share;
  }

  // Strikes from the air (J3b): the damage of the strongest enemy in the
  // air, the old damage decaying month by month.
  private airStrikesOn(id: NationId, months: number): void {
    const cfg = this.deps.config.air;
    const nation = this.economy.nations[id];
    let worst = 0;
    for (const enemy of enemiesOf(this.diplomacy, id)) {
      worst = Math.max(worst, airSuperiority(this.military, enemy, id));
    }
    const decayed =
      nation.strikeDamage * Math.pow(cfg.strikeDecayPerMonth, months);
    nation.strikeDamage = Math.min(
      1,
      Math.max(decayed, worst > 0 ? cfg.strikeShare * worst : 0),
    );
  }

  // The world of the diplomacy step of an update.
  private diplomacyEnv(date: string): DiplomacyStepEnv {
    return {
      ctx: this.ctx,
      state: this.diplomacy,
      economy: this.economy,
      military: this.military,
      politics: this.politics,
      rng: this.rng,
      date,
      aiNations: this.aiNations(),
      player: this.politics.autopilot ? null : this.playerNationId(),
      blocHeld: (by, against) =>
        blocSanction(this.ctx, this.blocs, by, against),
      ...this.dailyDiplomacy(date),
    };
  }

  // What the diplomacy of the updates of a day reads of the world, frozen
  // for the day (J7): the affinity inputs (blocs, sanctions, wars) and the
  // military power of every nation — at 208 nations they cost more than
  // the rest of an update.
  private diplomacyCache: {
    day: number;
    inputs: AffinityInputs;
    power: Map<NationId, number>;
  } | null = null;
  private dailyDiplomacy(date: string): {
    inputs: AffinityInputs;
    power: Map<NationId, number>;
  } {
    const day = dayIndex(this.calendar.elapsedGameMinutes);
    let cache = this.diplomacyCache;
    if (cache === null || cache.day !== day) {
      cache = {
        day,
        inputs: cachedAffinityInputs(this.ctx, this.diplomacy, date),
        power: new Map(
          this.ctx.nationIds.map((n) => [
            n,
            militaryPower(this.ctx, this.military, n),
          ]),
        ),
      };
      this.diplomacyCache = cache;
    }
    return { inputs: cache.inputs, power: cache.power };
  }

  // --- the daily and monthly clocks ------------------------------------------------

  private diplomacyDay(clock: ClockContext): void {
    this.navalDay();
    // Contests old enough end (J5): 5 years after a cession, 10 after the
    // last capture. J7: every day.
    const contest = this.deps.config.war.contest;
    this.deps.world.settleContested(contest.warMonths, contest.cessionMonths);
    // Each war closes its month on its own anniversary (J7); a month in
    // which the line moved goes to the journal, on the thread of its war.
    for (const month of stepWarLedgers(this.diplomacy, clock.date)) {
      this.recordWarMonth(clock.date, month);
    }
    // Reparations over.
    this.diplomacy.reparations = this.diplomacy.reparations.filter(
      (r) => clock.date < r.until,
    );
  }

  private blocsDay(clock: ClockContext): void {
    let joined = false;
    for (const event of stepBlocsDay(this.blocEnv(clock.date))) {
      // J7c: a lift of a bloc is the vote of its members (way (c)); it was
      // journaled as relations healed.
      this.record(
        clock.date,
        event,
        undefined,
        event.type === "sanctions-lifted" ? "vote" : undefined,
      );
      if (event.type === "war-joined") joined = true;
    }
    if (joined) this.invalidateFronts();
  }

  private blocSession(id: string, date: string): void {
    let joined = false;
    for (const event of stepBlocSession(this.blocEnv(date), id)) {
      this.record(
        date,
        event,
        undefined,
        event.type === "sanctions-lifted" ? "vote" : undefined,
      );
      if (event.type === "war-joined") joined = true;
    }
    if (joined) this.invalidateFronts();
  }

  // The 1st of the month: presidencies, the budgets of the blocs, the
  // fiscal rule of the EU (calendar by nature).
  private blocsCalendar(clock: ClockContext): void {
    for (const event of stepBlocsCalendar(this.blocEnv(clock.date))) {
      this.record(clock.date, event);
    }
    for (const id of this.ctx.nationIds) {
      const events = stepFiscalRules(
        this.ctx.blocs,
        (bloc, nation) => this.ctx.isFullMember(bloc, nation),
        id,
        this.economy.nations[id],
        this.politics.nations[id],
      );
      for (const event of events) this.record(clock.date, event);
    }
  }

  // An event of the events engine: a pop-up for the client, a line in the
  // journal for the events of the player, of the world, and the scripted
  // ones of the AI nations.
  private recordEvent(date: string, event: EventsEvent): void {
    const player = this.politics.autopilot ? null : this.playerNationId();
    if (event.type === "event-popup") {
      const data = this.ctx.events.find((e) => e.id === event.instance.event);
      this.pending.push({
        type: "event-popup",
        date,
        nation: event.nation,
        id: event.instance.id,
        event: event.instance.event,
        pause: data?.pause ?? true,
      });
      return;
    }
    const data = this.ctx.events.find((e) => e.id === event.params.event);
    if (
      event.nation === player ||
      data?.scope === "world" ||
      (data?.kind === "scripted" && data.journal)
    ) {
      this.record(date, event);
    }
    // An event that touched a nation: its next update comes soon.
    if (event.nation !== player) {
      hasten(
        this.schedule,
        event.nation,
        this.calendar.elapsedGameMinutes,
        this.deps.config.schedule.stakesDays,
        this.deps.config.time.gameMinutesPerTick,
      );
    }
  }

  // Structures built since the last count of a nation, at their cost: the
  // legacy gold is no resource in a campaign, the national budget pays
  // (J5). J6c: a nation never counted pays nothing — its first count is the
  // reference. J7: counted at the first update of the nation in a month.
  private constructionOf(id: NationId): number {
    const prices = this.deps.config.budget.structureCostUsd;
    const count = this.structureCount(id);
    const before = this.territory.structures[id];
    let cost = 0;
    if (before !== undefined) {
      for (const [type, n] of Object.entries(count)) {
        cost += Math.max(0, n - (before[type] ?? 0)) * (prices[type] ?? 0);
      }
    }
    this.territory.structures[id] = count;
    this.territory.constructionCost[id] = cost;
    return cost;
  }

  // The structures of a nation on the map, counted at most once a game day
  // for the whole world (the count reads every unit of the core).
  private structureCache: {
    day: number;
    counts: ReadonlyMap<NationId, Record<string, number>>;
  } | null = null;
  private structureCount(id: NationId): Record<string, number> {
    const day = dayIndex(this.calendar.elapsedGameMinutes);
    let cache = this.structureCache;
    if (cache === null || cache.day !== day) {
      cache = { day, counts: this.deps.world.structureCounts() };
      this.structureCache = cache;
    }
    // Key order is part of the bytes of a save: sorted, whatever the order
    // the core lists its units in.
    return Object.fromEntries(
      Object.entries(cache.counts.get(id) ?? {}).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    );
  }

  // --- intelligence (J7) -------------------------------------------------------

  // What the indicators of intelligence are read from: the state, and the
  // military power and the monthly risk of a coup of every nation (once a
  // game day).
  private intelWorldCache: { day: number; world: IntelWorld } | null = null;
  private intelWorld(): IntelWorld {
    const day = dayIndex(this.calendar.elapsedGameMinutes);
    if (this.intelWorldCache?.day === day) return this.intelWorldCache.world;
    const date = this.calendar.date;
    const power: Record<NationId, number> = {};
    const coupRisk: Record<NationId, number> = {};
    for (const id of this.ctx.nationIds) {
      power[id] = militaryPower(this.ctx, this.military, id);
      const politics = this.politics.nations[id];
      coupRisk[id] =
        politics === undefined
          ? 0
          : coupProbability(
              this.ctx,
              id,
              politics,
              this.military.nations[id],
              date,
            );
    }
    const env = this.nuclearEnv(date);
    const world: IntelWorld = {
      economies: this.economy.nations,
      politics: this.politics.nations,
      military: this.military,
      nuclear: this.nuclear,
      power,
      coupRisk,
      nuclearRisk: this.nuclearRisk(),
      deadHand: Object.fromEntries(
        Object.keys(this.nuclear.nations).map((id) => [
          id,
          deadHandProbability(env, id),
        ]),
      ),
    };
    this.intelWorldCache = { day, world };
    return world;
  }

  private intelViewer(): NationId | null {
    return this.politics.autopilot ? null : this.playerNationId();
  }

  // The 1st of a month: the snapshots of the indicators, the relations of
  // the player.
  private intelMonth(date: string): void {
    this.intelWorldCache = null;
    takeIntelSnapshots(this.intel, this.intelWorld(), this.ctx.nationIds, date);
    const viewer = this.intelViewer();
    recordRelations(
      this.intel,
      viewer,
      this.ctx.nationIds,
      (id) => (viewer === null ? 0 : relation(this.diplomacy, viewer, id)),
      date,
      this.deps.config.intel.trendMonths + 1,
    );
  }

  // A new campaign, or a save without snapshots (migrated): from today.
  private ensureIntelState(): void {
    const date = this.calendar.date;
    ensureIntel(this.intel, this.intelWorld(), this.ctx.nationIds, date);
    const viewer = this.intelViewer();
    if (this.intel.relations.viewer !== viewer) {
      recordRelations(
        this.intel,
        viewer,
        this.ctx.nationIds,
        (id) => (viewer === null ? 0 : relation(this.diplomacy, viewer, id)),
        `${date.slice(0, 7)}-01`,
        this.deps.config.intel.trendMonths + 1,
      );
    }
  }

  // The levels of intelligence of a nation on another.
  private intelLevelsOf(viewer: NationId, target: NationId): IntelLevels {
    const mine = this.ctx.blocsOf(viewer);
    let alliance = this.ctx.guarantees.some(
      (g) =>
        (g.guarantor === viewer && g.protected === target) ||
        (g.guarantor === target && g.protected === viewer),
    );
    let union = false;
    for (const bloc of this.ctx.blocsOf(target)) {
      if (!mine.includes(bloc)) continue;
      const type = this.ctx.blocType(bloc);
      if (type === "military-alliance") alliance = true;
      if (type === "economic-union") union = true;
    }
    return intelLevels(this.deps.config.intel as IntelRules, {
      relation: relation(this.diplomacy, viewer, target),
      alliance,
      union,
      neighbour: this.ctx.landNeighbours(viewer, target),
      atWar: enemiesOf(this.diplomacy, viewer).includes(target),
      regime: this.politics.nations[target]?.regime ?? null,
    });
  }

  read(): ReadonlyWorldView {
    this.assertInitialized();
    const player = this.playerNationId();
    // One environment for the technology of the view, the shares of each
    // node counted once (J6c).
    const techEnv = player === null ? null : this.techEnv(this.calendar.date);
    if (techEnv !== null) techEnv.shares = diffusionShares(techEnv);
    const casusBelli: Record<NationId, string[]> = {};
    if (player !== null) {
      for (const id of this.ctx.nationIds) {
        if (id === player) continue;
        casusBelli[id] = availableCasusBelli(
          this.ctx,
          this.diplomacy,
          this.politics,
          this.scenario,
          player,
          id,
        );
      }
    }
    const shares =
      player === null
        ? null
        : projectShares(
            this.ctx,
            this.politics.nations[player],
            this.sheets.get(player),
            this.calendar.date,
          );
    const coverage =
      player === null ? 1 : voteCoverage(this.ctx, this.sheets.get(player));
    const projection =
      shares === null
        ? null
        : Object.fromEntries(
            Object.entries(shares).map(([id, s]) => [id, s * coverage]),
          );
    return {
      seed: this.seed,
      date: this.calendar.date,
      elapsedGameMinutes: this.calendar.elapsedGameMinutes,
      speed: this.calendar.speed,
      playerNation: player,
      nations: this.nations,
      journal: this.journal,
      market: this.economy.market,
      economies: this.economy.nations,
      politics: this.politics.nations,
      diplomacy: this.diplomacy,
      military: this.military,
      naval: this.naval,
      fronts: this.frontViews,
      nuclear: this.nuclear,
      deadHand: this.intelWorld().deadHand,
      nuclearRisk: this.intelWorld().nuclearRisk,
      ai: this.ai,
      contested: Object.fromEntries(this.deps.world.contestedCounts()),
      initialTiles: this.territory.initialTiles,
      constructionCost: this.territory.constructionCost,
      casusBelli,
      blocHeldSanctions:
        player === null
          ? []
          : this.ctx.nationIds.filter(
              (id) =>
                id !== player && blocSanction(this.ctx, this.blocs, player, id),
            ),
      electionProjection: projection,
      electionRunoff:
        player === null || projection === null
          ? null
          : runoffOf(
              this.ctx,
              this.politics.nations[player],
              this.sheets.get(player),
              shares ?? projection,
              this.calendar.date,
            ),
      objectives: this.politics.player.objectives,
      notes: this.politics.player.notes,
      blocs: this.blocViews(player),
      tech: this.tech,
      techCosts:
        techEnv === null
          ? {}
          : Object.fromEntries(
              this.ctx.tech.map((n) => [n.id, effectiveCost(techEnv, n)]),
            ),
      techRefusals:
        techEnv === null || player === null
          ? {}
          : researchRefusals(techEnv, player),
      events: this.events,
      eventLeanings: this.eventLeanings(),
      schedule: this.schedule,
      intel: this.intelView(player),
      power: this.intelWorld().power,
      coupRisk: this.intelWorld().coupRisk,
      exile: this.exile,
      resistance: Object.fromEntries(this.resistanceMap()),
      lastStandChoices: this.lastStandChoices(),
      version: this.viewVersion,
    };
  }

  // What the player knows of every other nation (J7): its levels, the
  // terms of their relation.
  private intelView(player: NationId | null): IntelView {
    const levels: Record<NationId, IntelLevels> = {};
    const relationTerms: Record<NationId, AffinityTerms> = {};
    const claims: IntelView["claims"] = {};
    if (player !== null) {
      const { inputs } = this.dailyDiplomacy(this.calendar.date);
      for (const id of this.ctx.nationIds) {
        if (id === player) continue;
        levels[id] = this.intelLevelsOf(player, id);
        relationTerms[id] = affinityTerms(
          this.ctx,
          this.diplomacy,
          this.politics,
          player,
          id,
          false,
          inputs,
        );
        const byPlayer = claimsAgainst(this.ctx, this.diplomacy, player, id);
        const byThem = claimsAgainst(this.ctx, this.diplomacy, id, player);
        if (byPlayer.length > 0 || byThem.length > 0) {
          claims[id] = {
            byPlayer: byPlayer.map((c) => c.region),
            byThem: byThem.map((c) => c.region),
          };
        }
      }
    }
    return {
      state: this.intel,
      levels,
      relationTerms,
      rules: this.deps.config.intel as IntelRules,
      claims,
      guarantees: this.ctx.guarantees.map((g) => ({
        guarantor: g.guarantor,
        protected: g.protected,
      })),
    };
  }

  hud(journalSince?: number): HudView {
    this.assertInitialized();
    const player = this.playerNationId();
    const fresh =
      journalSince === undefined
        ? 0
        : Math.min(
            HUD_JOURNAL_MAX,
            Math.max(0, this.journalAdded - journalSince),
          );
    const votes: PendingVote[] = [];
    const neighbours: NationId[] = [];
    const friends: NationId[] = [];
    if (player !== null) {
      for (const p of this.blocs.proposals) {
        if (p.result !== "pending" || p.cast[player] !== undefined) continue;
        if (p.by === player || p.target === player) continue;
        if (!this.ctx.membersOf(p.bloc).includes(player)) continue;
        votes.push({
          id: p.id,
          bloc: p.bloc,
          kind: p.kind,
          by: p.by,
          target: p.target,
          direction: p.direction,
          resolveOn: p.resolveOn,
        });
      }
      for (const id of this.ctx.nationIds) {
        if (id === player) continue;
        if (this.ctx.landNeighbours(id, player)) neighbours.push(id);
        if (allies(this.ctx, id, player)) friends.push(id);
      }
    }
    return {
      version: this.viewVersion,
      date: this.calendar.date,
      speed: this.calendar.speed,
      playerNation: player,
      pending: this.events.pending,
      leanings: this.eventLeanings(),
      votes,
      neighbours,
      allies: friends,
      enemies: player === null ? [] : enemiesOf(this.diplomacy, player),
      blocs: player === null ? [] : this.ctx.blocsOf(player),
      mapWidth: this.deps.world.mapWidth(),
      journalMark: this.journalAdded,
      journal: fresh === 0 ? [] : this.journal.slice(-fresh),
      intel: this.hudIntel(
        player,
        fresh === 0 ? [] : this.journal.slice(-fresh),
      ),
    };
  }

  // The levels of the player on its enemies and on the nations of the
  // journal entries sent to the cards (J7b).
  private hudIntel(
    player: NationId | null,
    entries: readonly JournalEntry[],
  ): HudView["intel"] {
    const levels: Record<NationId, IntelLevels> = {};
    if (player !== null) {
      const ids = new Set<NationId>(enemiesOf(this.diplomacy, player));
      for (const e of entries) {
        for (const id of entryNations(e)) ids.add(id);
      }
      ids.delete(player);
      for (const id of ids) {
        if (this.politics.nations[id] === undefined) continue;
        levels[id] = this.intelLevelsOf(player, id);
      }
    }
    return {
      seed: this.seed,
      rules: this.deps.config.intel as IntelRules,
      levels,
    };
  }

  mapColors(): MapColors {
    this.assertInitialized();
    const player = this.playerNationId();
    const relations: Record<NationId, number> = {};
    const intel: Record<NationId, number> = {};
    if (player !== null) {
      for (const id of this.ctx.nationIds) {
        if (id === player) continue;
        relations[id] = relation(this.diplomacy, player, id);
        const l = this.intelLevelsOf(player, id);
        intel[id] =
          (l.economy + l.politics + l.army + l.nuclear + l.intentions) / 5;
      }
    }
    return {
      player,
      relations,
      wars: this.diplomacy.wars.map((w) => ({
        aggressors: [...w.aggressors],
        defenders: [...w.defenders],
      })),
      blocs: this.blocs.blocs.map((b) => ({
        id: b.id,
        members: b.members
          .filter((m) => m.status === "full")
          .map((m) => m.nation),
        candidates: b.members
          .filter((m) => m.status === "candidate")
          .map((m) => m.nation),
      })),
      intel,
    };
  }

  warPreview(target: NationId, casusBelli: string): WarPreview {
    this.assertInitialized();
    const me = this.requirePlayer();
    if (!this.ctx.nationIds.includes(target) || target === me) {
      throw new Error(`war-preview: no war on ${target}`);
    }
    return previewWar(this.aiEnv(this.calendar.date), me, target, casusBelli);
  }

  queryJournal(query: JournalQuery): JournalPage {
    this.assertInitialized();
    const scope = this.scopeNations(query.scope);
    const wanted =
      query.nations === undefined ? null : new Set<string>(query.nations);
    const offset = query.offset ?? 0;
    const entries: JournalEntry[] = [];
    let total = 0;
    // The journal is in date order: from the end, until `from`.
    for (let i = this.journal.length - 1; i >= 0; i--) {
      const e = this.journal[i];
      if (query.from !== undefined && e.date < query.from) break;
      if (query.to !== undefined && e.date > query.to) continue;
      if (query.link !== undefined && e.link !== query.link) continue;
      if (query.category !== undefined && entryCategory(e) !== query.category)
        continue;
      if (scope !== null || wanted !== null) {
        const nations = entryNations(e);
        if (scope !== null && !nations.some((n) => scope.has(n))) continue;
        if (wanted !== null && !nations.some((n) => wanted.has(n))) continue;
      }
      if (total >= offset && entries.length < query.limit) entries.push(e);
      total++;
    }
    return { entries, total };
  }

  // The nations of a scope of the journal; null: all of them.
  private scopeNations(scope: JournalScope): ReadonlySet<string> | null {
    const player = this.playerNationId();
    const ids = this.ctx.nationIds;
    switch (scope.kind) {
      case "all":
        return null;
      case "mine":
        return new Set(player === null ? [] : [player]);
      case "allies":
        return new Set(
          player === null
            ? []
            : ids.filter((id) => id !== player && allies(this.ctx, id, player)),
        );
      case "neighbours":
        return new Set(
          player === null
            ? []
            : ids.filter((id) => this.ctx.landNeighbours(id, player)),
        );
      case "region":
        return new Set(
          ids.filter((id) => {
            const g = this.sheets.get(id)?.geography;
            return g?.region === scope.region || g?.subregion === scope.region;
          }),
        );
      case "bloc":
        return new Set(this.ctx.membersOf(scope.bloc));
    }
  }

  // The choice the government leans towards for each pending event (J7).
  private eventLeanings(): Record<number, string> {
    const out: Record<number, string> = {};
    if (this.events.pending.length === 0) return out;
    const env = this.eventsEnv(this.calendar.date);
    for (const p of this.events.pending) {
      out[p.id] = governmentChoice(
        env,
        p.nation,
        eventData(this.ctx, p.event),
        p.id,
      );
    }
    return out;
  }

  private techEnv(date: string): TechEnv {
    return {
      ctx: this.ctx,
      tech: this.tech,
      economy: this.economy,
      blocs: this.blocs,
      sheets: this.sheets,
      aiNations: this.aiNations(),
      date,
    };
  }

  // The research environment of an update, the diffusion shares counted
  // once a game day (J7).
  private sharesCache: {
    day: number;
    shares: ReadonlyMap<string, number>;
  } | null = null;
  private updateTechEnv(date: string): TechEnv {
    const env = this.techEnv(date);
    const day = dayIndex(this.calendar.elapsedGameMinutes);
    let cache = this.sharesCache;
    if (cache === null || cache.day !== day) {
      cache = { day, shares: diffusionShares(env) };
      this.sharesCache = cache;
    }
    env.shares = cache.shares;
    return env;
  }

  private eventsEnv(date: string): EventsEnv {
    return {
      ctx: this.ctx,
      rng: this.rng,
      events: this.events,
      economy: this.economy,
      politics: this.politics,
      diplomacy: this.diplomacy,
      military: this.military,
      nuclear: this.nuclear,
      territory: this.territory,
      nations: this.nations,
      sheets: this.sheets,
      player: this.politics.autopilot ? null : this.playerNationId(),
      // J7c: the floor of the player's decisions holds in autopilot too
      // (the headless runner measures what a player would get).
      played: this.playerNationId(),
      date,
      seed: this.seed,
      known: this.knownNations,
      nationIndex: this.nationIndex,
      systems: {
        capitalHeld: (nation) => this.deps.world.capitalHeld(nation),
        occupation: (nation) => this.resistanceMap().get(nation) ?? 0,
        threat: (nation) => this.threats().get(nation) ?? null,
        occupier: (nation) =>
          this.exile.nations[nation]?.annexer ?? this.occupantOf(nation),
        recognition: (nation) =>
          this.exile.nations[nation]?.dissolvedAt === null
            ? (this.exile.nations[nation]?.recognition ?? 0)
            : 0,
        beyondReach: (nation) => this.beyondReach(nation),
      },
    };
  }

  // The blocs as the screen sees them (J5).
  private blocViews(player: NationId | null): BlocView[] {
    const env = this.blocEnv(this.calendar.date);
    return this.blocs.blocs.map((bloc) => {
      const data = blocData(this.ctx, bloc.id);
      const status = player === null ? null : memberStatus(bloc, player);
      const member = status === "full" || status === "suspended";
      const proposals = this.blocs.proposals.filter((p) => p.bloc === bloc.id);
      return {
        id: bloc.id,
        leader: leaderOf(this.blocs, bloc.id),
        leadership: data.leadership.kind,
        termEnds: termEnds(this.ctx, bloc.id, this.calendar.date),
        members: bloc.members
          .filter((m) => this.ctx.nationIds.includes(m.nation))
          .map((m) => ({ nation: m.nation, status: m.status })),
        worldMembers: bloc.members.filter((m) => m.status === "full").length,
        playerStatus: status,
        rules: data.decisionRules,
        qualifiedMajority: data.qualifiedMajority ?? null,
        collectiveDefense:
          data.collectiveDefense !== undefined || bloc.commonDefense,
        competencies: data.competencies ?? [],
        techBranch: data.techBranch ?? null,
        state: bloc,
        contributionPctGdp:
          data.budget === undefined
            ? null
            : data.budget.contributionPctGdp * bloc.budgetScale,
        pending: proposals
          .filter((p) => p.result === "pending")
          .map((p) => ({ proposal: p, projection: tally(env, p) })),
        resolved: proposals.filter((p) => p.result !== "pending").reverse(),
        options: player === null ? [] : measureOptions(env, player, bloc.id),
        criteria:
          player === null || member || !openToApplications(data)
            ? null
            : accessionCriteria(env, bloc.id, player),
        calls: this.blocs.calls
          .filter((c) => c.bloc === bloc.id && c.nation === player)
          .map((c) => ({ war: c.war, until: c.until })),
        exitTradeCostPctGdp: data.exit.tradeCostPctGdp,
        exitDelayMonths: data.exit.delayMonths,
      };
    });
  }

  private blocEnv(date: string): BlocEnv {
    return {
      ctx: this.ctx,
      rng: this.rng,
      state: this.blocs,
      diplomacy: this.diplomacy,
      economy: this.economy,
      politics: this.politics,
      military: this.military,
      sheets: this.sheets,
      aiNations: this.aiNations(),
      date,
    };
  }

  // Daily probability of a shot of each nuclear nation at the enemy that
  // threatens it most (what the nuclear panel shows).
  private nuclearRisk(): Record<NationId, number> {
    const env = this.nuclearEnv(this.calendar.date);
    const risk: Record<NationId, number> = {};
    for (const id of Object.keys(this.nuclear.nations)) {
      const target = mainThreat(env, id);
      risk[id] = target === null ? 0 : fireProbability(env, id, target);
    }
    return risk;
  }

  // Logistics and air, read by the resolution of the fronts.
  private readonly multipliers: Multipliers = {
    supply: (nation, segment, divisions) => {
      const capacity = this.supplyCapacity(nation, segment);
      return divisions <= 0 ? 1 : Math.min(1, capacity / divisions);
    },
    capacity: (nation, segment) => this.supplyCapacity(nation, segment),
    air: (nation, enemy) =>
      airMultiplier(this.ctx, this.military, nation, enemy),
    technology: (nation) => this.ctx.techModifiers.get(nation)?.land ?? 1,
  };

  // Divisions a nation supplies in full on a segment (J3b): the base, the
  // ports and cities in range, its infrastructure, less the strikes.
  private supplyCapacity(nation: NationId, segment: SegmentGeometry): number {
    const cfg = this.deps.config.logistics;
    const economy = this.economy.nations[nation];
    return (
      (cfg.base +
        cfg.perStructure * (segment.supply[nation] ?? 0) +
        cfg.infrastructureScale * (economy?.spending.infrastructure ?? 0)) *
      (1 - (economy?.strikeDamage ?? 0))
    );
  }

  // Share of the trade partners of a nation that sanction it or fight it
  // (or, with `sanctionsOnly`, that sanction it). J7: once a game day per
  // nation (an update reads it twice, and it weighs every partner).
  private lostShareCache: { day: number; values: Map<string, number> } | null =
    null;
  private lostTradeShare(id: NationId, sanctionsOnly = false): number {
    const day = dayIndex(this.calendar.elapsedGameMinutes);
    let cache = this.lostShareCache;
    if (cache === null || cache.day !== day) {
      cache = { day, values: new Map() };
      this.lostShareCache = cache;
    }
    const key = sanctionsOnly ? `${id}|s` : id;
    let value = cache.values.get(key);
    if (value === undefined) {
      value = this.computeLostTradeShare(id, sanctionsOnly);
      cache.values.set(key, value);
    }
    return value;
  }

  private computeLostTradeShare(id: NationId, sanctionsOnly: boolean): number {
    const lost = new Set<NationId>(
      sanctionsOnly ? [] : enemiesOf(this.diplomacy, id),
    );
    for (const s of this.diplomacy.sanctions) {
      if (s.against === id) lost.add(s.by);
    }
    if (lost.size === 0) return 0;
    let total = this.ctx.partnerWeight(id, ROW_ID);
    let blocked = 0;
    for (const other of this.ctx.nationIds) {
      const w = this.ctx.partnerWeight(id, other);
      total += w;
      if (lost.has(other)) blocked += w;
    }
    return total > 0 ? blocked / total : 0;
  }

  private navalDay(): void {
    const date = this.calendar.date;
    // Annexations the dead hand delayed: the land changes hands the day
    // after the signature (J5).
    const due = this.diplomacy.pendingAnnexations.filter((p) => p.at < date);
    for (const pending of due) {
      this.diplomacy.pendingAnnexations.splice(
        this.diplomacy.pendingAnnexations.indexOf(pending),
        1,
      );
      this.record(
        date,
        completeAnnexation(
          this.deps.world,
          this.diplomacy,
          this.military,
          pending.war,
          pending.nation,
          pending.by,
        ),
      );
      this.invalidateFronts();
    }
    for (const event of stepNuclearDay(this.nuclearEnv(date))) {
      this.record(date, event);
    }
    stepNavalDay(
      this.ctx,
      this.naval,
      this.deps.world.naval(),
      this.diplomacy,
      this.military,
    );
  }

  // --- the military tick --------------------------------------------------------

  private invalidateFronts(): void {
    this.geometryDay = -1;
    this.geometry = [];
    this.frontViews = [];
  }

  // The fronts are resolved once per core tick; an advance covering several
  // ticks (tests, headless days) resolves them as many times.
  private resolveFronts(gameMinutes: number): void {
    if (this.diplomacy.wars.length === 0) {
      if (this.frontViews.length > 0) this.frontViews = [];
      return;
    }
    const day = dayIndex(this.calendar.elapsedGameMinutes);
    // J6c: tick by tick, the geometry of a new day is read one tick after
    // midnight, not in the tick that already carries the daily and monthly
    // steps of the domains; an advance by whole days reads it at once.
    const intoDay =
      this.calendar.elapsedGameMinutes - day * MINUTES_PER_GAME_DAY;
    const deferred =
      this.geometryDay >= 0 &&
      intoDay === 0 &&
      gameMinutes < MINUTES_PER_GAME_DAY;
    if (day !== this.geometryDay && !deferred) {
      this.geometry = this.deps.world.fronts(
        enemyPairs(this.diplomacy),
        this.deps.config.war.segmentTiles,
      );
      this.geometryDay = day;
      releaseIdleDivisions(this.diplomacy, this.military, this.geometry);
    }
    if (this.geometry.length === 0) {
      this.frontViews = [];
      return;
    }
    const steps = Math.max(
      1,
      Math.round(gameMinutes / this.deps.config.time.gameMinutesPerTick),
    );
    for (let i = 0; i < steps; i++) {
      this.frontViews = resolveTick(
        this.ctx,
        this.deps.world,
        this.diplomacy,
        this.military,
        this.geometry,
        this.rng,
        this.multipliers,
      );
    }
  }

  // --- domain clocks ----------------------------------------------------------

  // J6b: sanctions in force on the first day. `by` is a nation, a bloc (its
  // full members apply them, and the bloc holds them: no member lifts them
  // alone, a new member takes them on) or "*" (every nation but `except`);
  // `against` a nation or a bloc (each of its full members). Without
  // `goods`, full sanctions; with, embargoes on those goods only, both ways.
  private applyScenarioSanctions(scenario: Scenario): void {
    const known = (id: string) => this.ctx.nationIds.includes(id);
    const blocOf = (id: string) => this.blocs.blocs.find((b) => b.id === id);
    const expand = (id: string) =>
      blocOf(id) !== undefined
        ? this.ctx.membersOf(id).filter(known)
        : known(id)
          ? [id]
          : [];
    for (const s of scenario.sanctions ?? []) {
      for (const against of expand(s.against)) {
        this.applyScenarioSanction(s, against, known, blocOf);
      }
    }
  }

  private applyScenarioSanction(
    s: NonNullable<Scenario["sanctions"]>[number],
    against: NationId,
    known: (id: string) => boolean,
    blocOf: (id: string) => BlocState | undefined,
  ): void {
    const bloc = s.by === "*" ? undefined : blocOf(s.by);
    const by = (
      s.by === "*"
        ? this.ctx.nationIds
        : bloc !== undefined
          ? this.ctx.membersOf(bloc.id).filter(known)
          : known(s.by)
            ? [s.by]
            : []
    ).filter((n) => n !== against && !(s.except ?? []).includes(n));
    if (bloc !== undefined && s.goods === undefined) {
      if (!bloc.sanctions.includes(against)) bloc.sanctions.push(against);
    }
    // Every sanction of the first day is one of policy, those against
    // Russia included (since 2014): never lifted while the target wages a
    // war of aggression, and after that only on a change of its regime.
    for (const nation of by) {
      if (s.goods === undefined) {
        imposeSanctions(
          this.ctx,
          this.diplomacy,
          this.economy,
          nation,
          against,
          s.since,
        );
        const record = this.diplomacy.sanctions.find(
          (r) => r.by === nation && r.against === against,
        );
        if (record !== undefined) record.policy = true;
        continue;
      }
      const list = this.economy.market.embargoes;
      for (const good of s.goods) {
        for (const [from, to] of [
          [against, nation],
          [nation, against],
        ]) {
          if (
            !list.some((e) => e.from === from && e.to === to && e.good === good)
          ) {
            list.push({ from, to, good });
          }
        }
      }
    }
  }

  // A front on the nation's own territory (any front it is part of).
  // J7b: or at war with a land neighbour — at the first tick of a campaign
  // the fronts of the day are not computed yet, and Ukraine, whose updates
  // come first, held the election its war suspends.
  private hasFrontAtHome(id: NationId): boolean {
    return (
      this.geometry.some((g) => g.a === id || g.b === id) ||
      enemiesOf(this.diplomacy, id).some((e) => this.ctx.landNeighbours(id, e))
    );
  }

  // A suspended member that is a democracy again gets back in.
  private reinstateIfDemocratic(id: NationId): void {
    const politics = this.politics.nations[id];
    if (politics.suspendedFrom.length === 0) return;
    if (!this.ctx.regime(politics.regime).democratic) return;
    politics.suspendedFrom = [];
    this.syncSuspensions();
  }

  // The context's view of the bloc suspensions follows the political state.
  private syncSuspensions(): void {
    this.ctx.suspensions.clear();
    for (const [id, politics] of Object.entries(this.politics.nations)) {
      for (const bloc of politics.suspendedFrom) {
        this.ctx.suspensions.add(`${bloc}|${id}`);
      }
    }
  }

  private objectiveWorld(nation: NationId): ObjectiveWorld {
    return {
      date: this.calendar.date,
      economy: this.economy.nations[nation],
      politics: this.politics.nations[nation],
      diplomacy: this.diplomacy,
      scenario: this.scenario,
      claims: claimsOf(this.diplomacy, nation).map((c) => ({
        region: c.region,
        claimant: c.claimant,
        holders: Object.fromEntries(this.ctx.claimHolders(c.region)),
      })),
      blocMembers: (bloc) => this.ctx.membersOf(bloc),
      monthsSince: (date) => {
        const [y, m] = date.split("-").map(Number);
        const [cy, cm] = this.calendar.date.split("-").map(Number);
        return (cy - y) * 12 + (cm - m);
      },
    };
  }

  // An offer from `from` to `to`: an AI recipient answers at once, the player
  // gets it as a pending offer (and an event). An offer between two AI
  // nations only reaches the journal when it is signed: refused ones came
  // every month of every AI war and drowned it.
  private offerPeace(
    war: War,
    from: NationId,
    to: NationId,
    terms: PeaceTerms,
    date: string,
  ): void {
    const offer = proposePeace(this.diplomacy, war, from, to, terms, date);
    const ai = this.aiNations();
    const betweenAi = ai.includes(from) && ai.includes(to);
    if (!betweenAi) {
      this.record(
        date,
        { type: "peace-offered", nation: from, war: war.id, offer: offer.id },
        terms.kind,
      );
    }
    if (!ai.includes(to)) return; // the player answers later
    if (aiAccepts(this.ctx, war, this.military, from, to, terms)) {
      this.sign(war, offer, date);
    } else {
      const refused = refuseOffer(war, offer);
      if (!betweenAi) this.record(date, refused, terms.kind);
    }
  }

  private sign(war: War, offer: PeaceOffer, date: string): void {
    // J5: the dead hand of a nuclear nation about to be annexed may strike
    // the capital of the annexer; the land then changes hands the next day.
    let defer = false;
    if (offer.terms.kind === "annexation") {
      const hand = stepDeadHand(this.nuclearEnv(date), offer.to, offer.from);
      defer = hand.fired;
      for (const event of hand.events) this.record(date, event);
    }
    const events = signPeace(
      this.ctx,
      this.deps.world,
      this.diplomacy,
      this.military,
      this.nations,
      war,
      offer,
      date,
      defer,
    );
    for (const event of events) this.record(date, event, offer.terms.kind);
    // J7c: the land of a government in exile its friends took back from its
    // annexer goes back to it.
    this.liberate(war, date);
    // Divisions facing a former enemy go home.
    releaseIdleDivisions(this.diplomacy, this.military, this.geometry);
    this.invalidateFronts();
  }

  // An event of a domain: returned by advance(), and written in the journal.
  // J7: the way a sanction fell (`reason`), and what a change of regime or
  // of leader sets off (the review of the sanctions against the nation, its
  // sleeping claims woken).
  private record(
    date: string,
    event: DomainEvent,
    terms?: string,
    reason?: LiftReason,
  ): void {
    this.afterEvent(date, event);
    let params: Record<string, string> = {};
    switch (event.type) {
      case "bloc-reprimand":
        params = {
          bloc: event.bloc,
          deficit: (event.deficitToGdp * 100).toFixed(1),
          debt: (event.debtToGdp * 100).toFixed(0),
        };
        break;
      case "war-declared":
        params = {
          target: event.target,
          casusBelli: event.casusBelli ?? "none",
          war: event.war,
        };
        break;
      case "war-joined":
        params = { war: event.war, against: event.against };
        break;
      case "sanctions-imposed":
        params = { by: event.by };
        break;
      case "sanctions-lifted":
        params = { by: event.by, reason: reason ?? "relations" };
        break;
      case "peace-offered":
      case "peace-refused":
      case "peace-signed":
        params = {
          war: event.war,
          offer: String(event.offer),
          terms: terms ?? "ceasefire",
        };
        break;
      case "annexation":
        params = { by: event.by };
        break;
      // Claims (J6).
      case "claims-settled":
        params = { by: event.by, tiles: String(event.tiles) };
        break;
      case "claim-weakened":
        params = { region: event.region, weight: event.weight.toFixed(2) };
        break;
      case "landing":
      case "landing-refused":
        params = { target: event.target };
        break;
      case "air-strike":
        params = {
          target: event.target,
          war: event.war,
          damage: (event.damage * 100).toFixed(1),
        };
        break;
      case "election-held":
        params = {
          winner: event.winner,
          share: (event.share * 100).toFixed(1),
          alternation: String(event.alternation),
          round: event.runoff === true ? "2" : "1",
        };
        break;
      case "government-formed":
        params = { parties: event.parties.join(", "), leader: event.leader };
        break;
      case "elections-suspended":
        params = { until: event.until };
        break;
      case "law-enacted":
      case "law-repealed":
        params = { law: event.law };
        break;
      case "law-refused":
        params = { law: event.law, reason: event.reason };
        break;
      case "law-repeal-announced":
        params = { law: event.law, at: event.at };
        break;
      case "coup-succeeded":
      case "revolution":
      case "leader-died":
      case "leader-succeeded":
        params = { leader: event.leader };
        break;
      case "fraud-detected":
        params = { fraud: (event.fraud * 100).toFixed(0) };
        break;
      case "objective-completed":
        params = { objective: event.objective };
        break;
      case "regime-changed":
        params = { from: event.from, to: event.to };
        break;
      case "bloc-suspended":
        params = { bloc: event.bloc };
        break;
      case "civilian-transition":
        params = { to: event.to };
        break;
      case "note":
        params = { text: event.text };
        break;
      case "nuclear-launch":
        params = {
          target: event.target,
          aim: event.aim,
          threat: String(event.threat),
        };
        break;
      case "exile-returned":
        params = { way: event.way, by: event.by, tiles: String(event.tiles) };
        break;
      case "exile-negotiation":
        params = { by: event.by };
        break;
      case "last-stand":
        params = { from: event.from };
        break;
      case "nuclear-detonation":
        params = {
          by: event.by,
          tiles: String(event.tiles),
          deaths: String(Math.round(event.deaths)),
        };
        break;
      case "nuclear-intercepted":
        params = { by: event.by };
        break;
      case "dead-hand":
        params = { target: event.target };
        break;
      case "arms-aid-started":
      case "arms-aid-ended":
        params = { to: event.to };
        break;
      case "ai-landing":
        params = { target: event.target };
        break;
      case "tech-completed":
      case "event-occurred":
      case "bloc-proposal":
      case "bloc-decision":
      case "bloc-presidency":
      case "bloc-application":
      case "bloc-accession-opened":
      case "bloc-accession-frozen":
      case "bloc-joined":
      case "bloc-exit-notified":
      case "bloc-left":
      case "bloc-article5":
      case "bloc-article5-refused":
        params = event.params;
        break;
      default:
        break;
    }
    if (POLITICAL_EVENTS.has(event.type)) {
      this.pending.push({
        type: event.type,
        date,
        nation: event.nation,
        params,
      } as SimEvent);
    } else if (event.type === "sanctions-lifted") {
      this.pending.push({ ...event, date, reason: params.reason });
    } else if (event.type !== "note") {
      this.pending.push({ ...event, date } as SimEvent);
    }
    const place = this.placeOf(event);
    this.addJournal({
      date,
      kind: event.type,
      nation: event.nation,
      params,
      ...(place === null ? {} : { tile: place }),
      ...(params.war === undefined || params.war === ""
        ? {}
        : { link: `war:${params.war}` }),
    });
  }

  // What an event sets off beyond its domain (J7): a change of regime opens
  // the review of the sanctions against the nation (way (a) of the answer
  // of Lukas to the J6) and wakes its sleeping claims, as does a
  // sovereignist leader coming to power.
  private afterEvent(date: string, event: DomainEvent): void {
    const nation = event.nation;
    // J7c: an occupant that collapses — its people overthrow it, or its
    // state fails — gives back the land of the governments in exile it
    // holds.
    if (
      event.type === "revolution" ||
      (event.type === "regime-changed" && event.to === "failed-state")
    ) {
      for (const [id, state] of Object.entries(this.exile.nations)) {
        if (state.dissolvedAt === null && state.annexer === nation) {
          this.giveBack(id, nation, "collapse", date);
        }
      }
    }
    // A nation drawn into a war decides within the day (its orders, its
    // mobilisation, its sanctions), not at its next calm update.
    if (event.type === "war-declared" || event.type === "war-joined") {
      const war = this.diplomacy.wars.find((w) => w.id === event.war);
      for (const id of war === undefined
        ? [nation]
        : [...war.aggressors, ...war.defenders]) {
        hasten(
          this.schedule,
          id,
          this.calendar.elapsedGameMinutes,
          1,
          this.deps.config.time.gameMinutesPerTick,
        );
        // Its war orders at that update, whenever it had its last ones.
        const ai = this.ai.nations[id];
        if (ai !== undefined) ai.lastOrders = null;
      }
    }
    if (event.type === "regime-changed") {
      scheduleSanctionReviews(this.ctx, this.diplomacy, this.rng, nation, date);
      this.wake(nation, date);
      return;
    }
    if (
      event.type === "government-formed" ||
      event.type === "leader-succeeded" ||
      event.type === "coup-succeeded" ||
      event.type === "revolution"
    ) {
      const leader = this.politics.nations[nation]?.leader;
      if (
        leader !== undefined &&
        leader.traits.sovereignty >
          this.deps.config.diplomacy.claims.wakeSovereigntyAbove
      ) {
        this.wake(nation, date);
      }
    }
  }

  // Entries added to the journal in this session (J7): the always-visible
  // interface asks for those it has not seen yet (the yearly compaction
  // shortens the journal, never its tail). Every entry gets a place: the
  // one given, else the capital of its nation.
  private journalAdded = 0;
  private addJournal(entry: JournalEntry): void {
    if (entry.tile === undefined && entry.nation !== undefined) {
      const tile = this.deps.world.capitalTile(entry.nation);
      if (tile !== null) entry.tile = tile;
    }
    this.journal.push(entry);
    this.journalAdded += 1;
  }

  // Where an event happened (J7): a declaration of war on the border of the
  // two nations, a strike or a landing at its target; else (null) the
  // capital of the nation.
  private placeOf(event: DomainEvent): number | null {
    const world = this.deps.world;
    switch (event.type) {
      case "war-declared":
        return world.borderTile(event.nation, event.target);
      case "war-joined":
        return world.borderTile(event.nation, event.against);
      case "nuclear-launch":
      case "dead-hand":
      case "landing":
      case "landing-refused":
      case "ai-landing":
      case "air-strike":
        return world.capitalTile(event.target);
      // J7c: ground zero.
      case "nuclear-detonation":
        return event.tile ?? world.capitalTile(event.nation);
      case "exile-returned":
      case "last-stand":
        return world.capitalTile(event.nation);
      default:
        return null;
    }
  }

  // A month of a war in which the line moved (J7): who gained, how many
  // tiles, and the men each side lost since the war began.
  private recordWarMonth(date: string, month: WarMonth): void {
    const { war, tiles } = month;
    const sum = (side: readonly NationId[]) =>
      side.reduce((s, id) => s + (tiles[id] ?? 0), 0);
    const aggressors = sum(war.aggressors);
    const defenders = sum(war.defenders);
    if (Math.round(aggressors) === 0 && Math.round(defenders) === 0) return;
    const gainers = aggressors >= defenders ? war.aggressors : war.defenders;
    const losers = gainers === war.aggressors ? war.defenders : war.aggressors;
    const losses = (side: readonly NationId[]) =>
      Math.round(side.reduce((s, id) => s + (war.losses[id] ?? 0), 0));
    this.addJournal({
      date,
      kind: "war-month",
      nation: gainers[0],
      params: {
        war: war.id,
        against: losers[0],
        tiles: String(Math.round(Math.abs(aggressors - defenders) / 2)),
        losses: String(losses(gainers)),
        lossesAgainst: String(losses(losers)),
      },
      ...(this.borderPlace(gainers[0], losers[0]) ?? {}),
      link: `war:${war.id}`,
    });
  }

  private borderPlace(a: NationId, b: NationId): { tile: number } | null {
    const tile = this.deps.world.borderTile(a, b);
    return tile === null ? null : { tile };
  }

  private wake(nation: NationId, date: string): void {
    for (const woken of wakeClaims(this.ctx, this.diplomacy, nation)) {
      this.addJournal({
        date,
        kind: "claim-weakened",
        nation,
        params: {
          region: woken.region,
          weight: woken.weight.toFixed(2),
          woken: "true",
        },
      });
    }
  }

  // --- helpers ------------------------------------------------------------------

  private loadSheets(ids: readonly NationId[], origin: string): NationData[] {
    const sheets = ids.map((id) => {
      const data = this.deps.nationData(id);
      if (data === undefined) {
        throw new Error(`${origin}: no nation sheet for ${id}`);
      }
      return data;
    });
    this.sheets = new Map(sheets.map((s) => [s.id, s]));
    this.ctx = buildContext(this.deps.config, this.deps.data, sheets);
    this.knownNations = new Set(this.ctx.nationIds);
    this.nationIndex = new Map(this.ctx.nationIds.map((n, i) => [n, i]));
    this.ctx.claimHolders = (region) => this.deps.world.claimHolders(region);
    this.ctx.worldSupplyShock = (good) =>
      this.economy?.market.rowSupplyShock[good] ?? 0;
    // The distances of every trade pair and the partner weights, at load
    // rather than in the first monthly step (J6c: tens of milliseconds at
    // 208 nations).
    this.ctx.tradeGrid();
    for (const id of this.ctx.nationIds) this.ctx.partnerTotal(id);
    return sheets;
  }

  private playerNationId(): NationId | null {
    return this.nations.find((n) => n.isPlayer)?.id ?? null;
  }

  private requirePlayer(): NationId {
    const id = this.playerNationId();
    if (id === null) throw new Error("no player nation");
    return id;
  }

  // Nations run by the AI rules: everyone but the player, or everyone when
  // nobody plays (headless autopilot).
  private aiEnv(date: string): AiEnv {
    return {
      ctx: this.ctx,
      rng: this.rng,
      world: this.deps.world,
      ai: this.ai,
      diplomacy: this.diplomacy,
      economy: this.economy,
      military: this.military,
      politics: this.politics,
      naval: this.naval,
      nuclear: this.nuclear,
      blocs: this.blocs,
      nations: this.nations,
      sheets: this.sheets,
      scenario: this.scenario,
      aiNations: this.aiNations(),
      player: this.playerNationId(),
      date,
      beyondReach: (id) => this.beyondReach(id),
    };
  }

  // J7c: a nation no war, no border incident and no bloc measure reaches: a
  // dissolved nation, or a government in exile whose land an annexer
  // holds (an exile nobody annexed — a test world — is still in reach).
  private beyondReach(id: NationId): boolean {
    const status = this.statusOf(id);
    return (
      status === "dissolved" ||
      (status === "exiled" &&
        (this.exile.nations[id]?.annexer ?? null) !== null)
    );
  }

  private nuclearEnv(date: string): NuclearEnv {
    return {
      ctx: this.ctx,
      world: this.deps.world,
      rng: this.rng,
      nuclear: this.nuclear,
      diplomacy: this.diplomacy,
      economy: this.economy,
      military: this.military,
      politics: this.politics,
      territory: this.territory,
      nations: this.nations,
      sheets: this.sheets,
      fronts: this.frontViews,
      aiNations: this.aiNations(),
      date,
      blocNet: (id) => this.blocs.net[id] ?? 0,
    };
  }

  private aiNations(): NationId[] {
    const player = this.playerNationId();
    return this.ctx.nationIds.filter(
      (id) => id !== player || this.politics.autopilot,
    );
  }

  private playerEconomy() {
    return this.economy.nations[this.requirePlayer()];
  }

  private nationIds(): NationId[] {
    return this.nations.map((n) => n.id);
  }

  private refreshTileCounts(): void {
    const counts = this.deps.world.tileCounts();
    for (const nation of this.nations) {
      nation.tileCount = counts.get(nation.id) ?? 0;
    }
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error("VeritableSim used before init() or restore()");
    }
  }
}
