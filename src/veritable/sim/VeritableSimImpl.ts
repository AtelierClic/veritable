import { stepFiscalRule } from "../ai/fiscal";
import {
  AiEnv,
  AiEvent,
  armsFlowOf,
  hasStakes,
  initAi,
  review,
} from "../ai/nations";
import { stepWarAi } from "../ai/war";
import { NationId } from "../data/schemas/common";
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
import { airMultiplier, airSuperiority } from "./air/air";
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
import { claimsOf, wakeClaims } from "./diplomacy/claims";
import {
  AffinityInputs,
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
import { compactJournal, entryCategory, entryNations } from "./journal";
import { nationFromData, statusFromTerritory } from "./nation";
import {
  initNaval,
  landingControl,
  NavalEvent,
  setBlockade,
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
  stepCoups,
  stepJuntaTransition,
  stepRevolution,
} from "./politics/coups";
import {
  ElectionEvent,
  holdElection,
  projectShares,
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
  JournalPage,
  JournalQuery,
  JournalScope,
  PendingVote,
  PlayerCommand,
  PlayerCommandSchema,
  ReadonlyWorldView,
  SimEvent,
  VeritableSim,
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
    }
    return events;
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
    probe.measure("war", "tick", () => this.resolveFronts(tick));
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
      internalConflictMalus(this.ctx, conflicts, id, years),
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
      const orders = stepWarAi(
        this.ctx,
        this.diplomacy,
        this.military,
        economy.population,
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
    }
    const after = this.diplomacy.wars.reduce(
      (s, w) => s + w.aggressors.length + w.defenders.length,
      0,
    );
    if (this.diplomacy.wars.length !== before || after !== joined) {
      this.invalidateFronts();
    }

    reschedule(
      this.schedule,
      id,
      now,
      this.cadence(id),
      this.deps.config.time.gameMinutesPerTick,
    );
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

    // Elections, when due and not suspended by a war at home.
    if (politics.nextElection !== null && date >= politics.nextElection) {
      const suspended =
        (sheet?.politics.electionsSuspendedAtWarAtHome ?? false) &&
        this.hasFrontAtHome(id);
      if (suspended) {
        if (!politics.electionsSuspended) {
          politics.electionsSuspended = true;
          this.record(date, {
            type: "elections-suspended",
            nation: id,
            until: "war",
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
      this.record(clock.date, event);
      if (event.type === "war-joined") joined = true;
    }
    if (joined) this.invalidateFronts();
  }

  private blocSession(id: string, date: string): void {
    let joined = false;
    for (const event of stepBlocSession(this.blocEnv(date), id)) {
      this.record(date, event);
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
      deadHand: Object.fromEntries(
        Object.keys(this.nuclear.nations).map((id) => [
          id,
          deadHandProbability(this.nuclearEnv(this.calendar.date), id),
        ]),
      ),
      nuclearRisk: this.nuclearRisk(),
      ai: this.ai,
      contested: Object.fromEntries(this.deps.world.contestedCounts()),
      initialTiles: this.territory.initialTiles,
      constructionCost: this.territory.constructionCost,
      casusBelli,
      electionProjection:
        player === null
          ? null
          : projectShares(
              this.ctx,
              this.politics.nations[player],
              this.sheets.get(player),
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
      version: this.viewVersion,
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
    };
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
      date,
      seed: this.seed,
      known: this.knownNations,
      nationIndex: this.nationIndex,
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
      const cfg = this.deps.config.logistics;
      const economy = this.economy.nations[nation];
      const capacity =
        (cfg.base +
          cfg.perStructure * (segment.supply[nation] ?? 0) +
          cfg.infrastructureScale * (economy?.spending.infrastructure ?? 0)) *
        (1 - (economy?.strikeDamage ?? 0));
      return divisions <= 0 ? 1 : Math.min(1, capacity / divisions);
    },
    air: (nation, enemy) =>
      airMultiplier(this.ctx, this.military, nation, enemy),
    technology: (nation) => this.ctx.techModifiers.get(nation)?.land ?? 1,
  };

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
  private hasFrontAtHome(id: NationId): boolean {
    return this.geometry.some((g) => g.a === id || g.b === id);
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
      case "election-held":
        params = {
          winner: event.winner,
          share: (event.share * 100).toFixed(1),
          alternation: String(event.alternation),
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
      case "nuclear-detonation":
        params = { by: event.by, tiles: String(event.tiles) };
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
        return world.capitalTile(event.target);
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
    };
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
