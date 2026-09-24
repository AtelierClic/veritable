import { stepFiscalRule } from "../ai/fiscal";
import {
  AiEnv,
  AiEvent,
  dueThisTick,
  initAi,
  review,
  stepArmsFlows,
} from "../ai/nations";
import { stepWarAi } from "../ai/war";
import { NationId } from "../data/schemas/common";
import { VeritableConfig } from "../data/schemas/config";
import { NationData } from "../data/schemas/nation";
import { ROW_ID } from "../data/schemas/row";
import {
  AiState,
  BlocsState,
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
  TechState,
  TerritoryState,
  War,
} from "../data/schemas/save";
import { Scenario } from "../data/schemas/scenario";
import { airMultiplier, stepAirMonth } from "./air/air";
import {
  accessionCriteria,
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
  stepBlocsMonth,
  syncBlocs,
  tally,
  termEnds,
} from "./blocs/blocs";
import { BlocEvent, stepFiscalRules } from "./blocs/fiscalRule";
import { dateAfter, dayIndex } from "./calendar";
import { claimsOf } from "./diplomacy/claims";
import {
  availableCasusBelli,
  declareWar,
  DiplomacyEvent,
  enemiesOf,
  hitDemocracyRelations,
  imposeSanctions,
  initDiplomacy,
  liftSanctions,
  stepDiplomacyMonth,
  warSide,
} from "./diplomacy/diplomacy";
import { BudgetEvent, spendingCeiling, stepBudget } from "./economy/budget";
import { buildContext, EconomyContext, SimData } from "./economy/context";
import {
  MonthlyTrade,
  stepGrowth,
  stepPrices,
  stepTrade,
} from "./economy/engine";
import { initEconomy, initPolitics } from "./economy/init";
import {
  chooseEvent,
  eventGrowth,
  EventsEnv,
  EventsEvent,
  initEvents,
  stepEventsMonth,
} from "./events/events";
import { nationFromData, statusFromTerritory } from "./nation";
import {
  initNaval,
  landingControl,
  maritimeFactor,
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
import { PoliticsEvent, stepPolitics } from "./politics/politics";
import { Rng } from "./rng";
import {
  ClockContext,
  DomainSystem,
  NULL_PROBE,
  PerfProbe,
  Scheduler,
} from "./scheduler";
import {
  cancelResearch,
  effectiveCost,
  initTech,
  researchRefusal,
  startResearch,
  stepTechMonth,
  syncTech,
  TechEnv,
  TechEvent,
} from "./tech/tech";
import {
  BlocView,
  FrontGeometry,
  FrontView,
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
  stepWarMonth,
} from "./war/fronts";
import {
  assignDivision,
  disbandDivision,
  initMilitary,
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
  // Arms flows of the month, for the military step and the budget.
  private armsAid: {
    points: Record<NationId, number>;
    cost: Record<NationId, number>;
  } = {
    points: {},
    cost: {},
  };
  private scenario!: Scenario;
  private ctx!: EconomyContext;
  private sheets = new Map<NationId, NationData>();
  private initialized = false;

  // Left by the monthly flows for the budget of the same month.
  private trade: MonthlyTrade | null = null;
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

  // The domains, plugged on the central scheduler.
  private systems(): DomainSystem[] {
    return [
      {
        domain: "economy",
        onDay: () => stepPrices(this.ctx, this.economy),
        onMonth: (c) => {
          this.trade = stepTrade(this.ctx, this.economy, (e, i) =>
            maritimeFactor(this.ctx, this.naval, e, i),
          );
          stepGrowth(
            this.ctx,
            this.economy,
            this.politics,
            this.rng,
            (id) => this.lostTradeShare(id),
            (id) =>
              (this.ctx.techModifiers.get(id)?.growth ?? 0) +
              eventGrowth(this.events, id),
          );
          this.techMonth(c);
        },
      },
      { domain: "events", onMonth: (c) => this.eventsMonth(c) },
      {
        domain: "diplomacy",
        onDay: () => this.navalDay(),
        onMonth: (c) => this.diplomacyMonth(c),
      },
      {
        domain: "politics",
        onWeek: (c) => this.politicsWeek(c),
        onMonth: (c) => {
          this.politicsMonth(c);
          this.budgetMonth(c);
        },
      },
      { domain: "blocs", onMonth: (c) => this.blocsMonth(c) },
      { domain: "save" },
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
    this.syncSuspensions();
    this.diplomacy = initDiplomacy(this.ctx, scenario);
    this.military = initMilitary(this.ctx, sheets);
    this.naval = initNaval();
    this.nuclear = initNuclear(sheets);
    this.ai = initAi(scenario.nations, scenario.startDate);
    this.blocs = initBlocs(this.ctx);
    syncBlocs(this.ctx, this.blocs);
    this.tech = initTech(this.ctx, sheets);
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
    this.trade = null;
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
      constructionCost: {},
    };
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
    this.trade = null;
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
  }

  // Months since the start of the campaign (the clock of the contest).
  private currentMonth(): number {
    return monthIndex(this.calendar.startDate, this.calendar.date);
  }

  snapshot(): SaveFile {
    this.assertInitialized();
    this.refreshTileCounts();
    const { world, grid } = this.deps.world.capture(this.nationIds());
    return structuredClone({
      schemaVersion: SAVE_SCHEMA_VERSION,
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
      journal: this.journal,
      metrics: this.metrics,
      tilesInfo: { width: grid.width, height: grid.height },
      tiles: grid.tiles,
      contest: grid.contest ?? new Uint16Array(grid.tiles.length),
    });
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
        if (event !== null) this.record(date, event);
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
          this.sheets.get(me)!.population.value,
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

    const before = this.calendar.elapsedGameMinutes;
    this.calendar.elapsedGameMinutes += gameMinutes;
    this.calendar.date = dateAfter(
      this.calendar.startDate,
      this.calendar.elapsedGameMinutes,
    );
    this.deps.world.setMonth(this.currentMonth());
    // Domain systems push what happened into `pending` while the clocks run;
    // events of the commands applied since the last advance are already there.
    for (const tick of this.scheduler.run(
      this.calendar.startDate,
      before,
      this.calendar.elapsedGameMinutes,
    )) {
      events.push({ type: "day-started", date: tick.context.date });
      if (tick.monthStarted) {
        events.push({ type: "month-started", date: tick.context.date });
      }
    }
    (this.deps.perf ?? NULL_PROBE).measure("war", "tick", () =>
      this.resolveFronts(gameMinutes),
    );
    // The nation AI: a tenth of the nations come up every tick (J5).
    (this.deps.perf ?? NULL_PROBE).measure("diplomacy", "tick", () =>
      this.aiTick(this.calendar.date),
    );
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
      this.journal.push({
        date: event.date,
        kind: "nation-status",
        nation: nation.id,
        params: { from: event.from, to: event.to },
      });
    }
    return events;
  }

  read(): ReadonlyWorldView {
    this.assertInitialized();
    const player = this.playerNationId();
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
        player === null
          ? {}
          : Object.fromEntries(
              this.ctx.tech.map((n) => [
                n.id,
                effectiveCost(this.techEnv(this.calendar.date), n),
              ]),
            ),
      techRefusals:
        player === null
          ? {}
          : Object.fromEntries(
              this.ctx.tech.map((n) => [
                n.id,
                researchRefusal(this.techEnv(this.calendar.date), player, n.id),
              ]),
            ),
      events: this.events,
    };
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

  // Research of the month (J5), after growth.
  private techMonth(clock: ClockContext): void {
    const player = this.playerNationId();
    for (const event of stepTechMonth(this.techEnv(clock.date))) {
      // The journal keeps the player's nodes and the firsts of the world.
      if (event.nation === player || event.params.first === "true") {
        this.record(clock.date, event);
      }
    }
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
    };
  }

  // Events of the month (J5). The player's pop-ups reach the client (it
  // pauses on those that ask it); the journal keeps the events of the
  // player, of the world, and the scripted ones of the AI nations.
  private eventsMonth(clock: ClockContext): void {
    const env = this.eventsEnv(clock.date);
    for (const event of stepEventsMonth(env)) {
      if (event.type === "event-popup") {
        const data = this.ctx.events.find((e) => e.id === event.instance.event);
        this.pending.push({
          type: "event-popup",
          date: clock.date,
          nation: event.nation,
          id: event.instance.id,
          event: event.instance.event,
          pause: data?.pause ?? true,
        });
        continue;
      }
      const data = this.ctx.events.find((e) => e.id === event.params.event);
      if (
        event.nation === env.player ||
        data?.scope === "world" ||
        (data?.kind === "scripted" && data.journal)
      ) {
        this.record(clock.date, event);
      }
    }
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
  // (or, with `sanctionsOnly`, that sanction it).
  private lostTradeShare(id: NationId, sanctionsOnly = false): number {
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
    if (day !== this.geometryDay) {
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

  private politicsWeek(clock: ClockContext): void {
    for (const id of this.ctx.nationIds) {
      const events = stepPolitics(
        this.ctx,
        id,
        this.sheets.get(id),
        this.economy.nations[id],
        this.politics.nations[id],
        this.military.nations[id]?.exhaustion ?? 0,
        this.lostTradeShare(id, true),
        lawModifiers(this.ctx, this.politics.nations[id]).groups,
      );
      for (const event of events) this.record(clock.date, event);
    }
  }

  // --- the political engine (J4), once a month before the budget ------------

  // Cost of the levers this month, taken from the budget (US$).
  private leverCosts: Record<NationId, number> = {};

  private politicsMonth(clock: ClockContext): void {
    const cfg = this.deps.config.politics;
    const player = this.playerNationId();
    const date = clock.date;
    this.leverCosts = {};
    for (const id of this.ctx.nationIds) {
      const politics = this.politics.nations[id];
      const economy = this.economy.nations[id];
      const sheet = this.sheets.get(id);
      const regime = this.ctx.regime(politics.regime);
      const modifiers = lawModifiers(this.ctx, politics);
      const isAi = id !== player || this.politics.autopilot;

      // Sliders move towards their targets.
      stepSliders(this.ctx, economy);

      // Political capital and legitimacy.
      politics.capital = Math.min(
        cfg.capital.max,
        politics.capital +
          cfg.capital.regenBase *
            (0.5 + politics.leader.traits.charisma) *
            (0.5 + politics.opinion),
      );
      const legitimacyBase = clamp01(
        regime.legitimacyBase + modifiers.legitimacyBase,
      );
      politics.legitimacy = clamp01(
        politics.legitimacy +
          Math.sign(legitimacyBase - politics.legitimacy) *
            Math.min(
              cfg.legitimacy.recoveryPerMonth,
              Math.abs(legitimacyBase - politics.legitimacy),
            ),
      );

      // Laws: announced repeals fall due.
      for (const event of stepLawsMonth(this.ctx, id, politics, date)) {
        this.record(date, event);
      }

      // Levers of the player: propaganda and clientelism cost money every
      // month; clientelism pleases its group and feeds corruption.
      if (!isAi) {
        let cost = (politics.levers.propagandaPctGdp * economy.gdp) / 12;
        if (politics.levers.clientelism !== null && politics.groups !== null) {
          const group = politics.levers.clientelism;
          politics.groups[group] = clamp01(
            politics.groups[group] + cfg.elections.clientelismSatisfaction,
          );
          politics.corruption = clamp01(
            politics.corruption + cfg.elections.clientelismCorruption,
          );
          cost += (cfg.elections.clientelismCostPctGdp * economy.gdp) / 12;
        }
        this.leverCosts[id] = cost;
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

      // The leader ages; the regime names a successor.
      for (const event of stepLeaderAgeing(
        this.ctx,
        this.rng,
        id,
        politics,
        date,
      )) {
        this.record(date, event);
      }

      // A junta hands power back, coups, revolutions.
      for (const event of stepJuntaTransition(
        this.ctx,
        this.rng,
        id,
        politics,
        date,
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
      )) {
        this.record(date, event);
      }
      this.reinstateIfDemocratic(id);

      // AI nations: random shocks in proportion to the fragility of the
      // regime, so that they know unrest too.
      if (politics.groups === null) {
        const sd =
          cfg.aiShock.sd *
          (1 - politics.legitimacy) *
          (1 + cfg.aiShock.coupScale * regime.coupBase);
        politics.opinion = clamp01(
          politics.opinion + sd * this.rng.nextGaussian(),
        );
      }
    }

    // The player's objectives.
    if (player !== null) {
      for (const event of stepObjectivesMonth(
        this.ctx,
        player,
        this.politics,
        this.objectiveWorld(player),
      )) {
        this.record(date, event);
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

  private budgetMonth(clock: ClockContext): void {
    const trade = this.trade;
    if (trade === null) return; // the monthly flows always run first
    const player = this.playerNationId();
    // Reparations: a share of the payer's GDP, every month until the date.
    const transfers: Record<NationId, number> = {};
    this.diplomacy.reparations = this.diplomacy.reparations.filter(
      (r) => clock.date < r.until,
    );
    for (const r of this.diplomacy.reparations) {
      const payer = this.economy.nations[r.from];
      if (payer === undefined) continue;
      const amount = (r.pctGdp * payer.gdp) / 12;
      transfers[r.from] = (transfers[r.from] ?? 0) - amount;
      transfers[r.to] = (transfers[r.to] ?? 0) + amount;
    }
    // Arms sent abroad are paid by the donor's budget (J5).
    for (const [id, cost] of Object.entries(this.armsAid.cost)) {
      transfers[id] = (transfers[id] ?? 0) - cost;
    }
    // What was built on the map since last month (J5).
    for (const [id, cost] of Object.entries(this.constructionMonth())) {
      transfers[id] = (transfers[id] ?? 0) - cost;
    }
    // Bloc budgets of last month: contributions and transfers (J5).
    for (const [id, net] of Object.entries(this.blocs.net)) {
      if (this.economy.nations[id] !== undefined) {
        transfers[id] = (transfers[id] ?? 0) + net;
      }
    }
    for (const id of this.ctx.nationIds) {
      const economy = this.economy.nations[id];
      const politics = this.politics.nations[id];
      // War aid fades at peace (J5).
      if (enemiesOf(this.diplomacy, id).length === 0) {
        economy.grantsPctGdp *=
          1 - this.deps.config.budget.grantsPeaceDecayPerMonth;
      }
      const corruption = clamp01(
        politics.corruption + lawModifiers(this.ctx, politics).corruption,
      );
      const events = stepBudget(
        this.ctx,
        id,
        economy,
        politics,
        trade,
        clock.date,
        (transfers[id] ?? 0) - (this.leverCosts[id] ?? 0),
        this.deps.config.politics.corruptionLeakScale * corruption,
      );
      for (const event of events) this.record(clock.date, event);
      if (id !== player || this.politics.autopilot) {
        stepFiscalRule(this.ctx, economy, {
          defense: this.ai.nations[id]?.defenseGoal,
          atWar: enemiesOf(this.diplomacy, id).length > 0,
        });
      }
    }
  }

  // Structures built since the last count, at their cost: the legacy gold is
  // no resource in a campaign, the national budget pays (J5).
  private constructionMonth(): Record<NationId, number> {
    const prices = this.deps.config.budget.structureCostUsd;
    const counts = this.deps.world.structureCounts();
    const costs: Record<NationId, number> = {};
    for (const [id, count] of counts) {
      const before = this.territory.structures[id] ?? {};
      let cost = 0;
      for (const [type, n] of Object.entries(count)) {
        cost += Math.max(0, n - (before[type] ?? 0)) * (prices[type] ?? 0);
      }
      costs[id] = cost;
    }
    this.territory.structures = Object.fromEntries(counts);
    this.territory.constructionCost = costs;
    return costs;
  }

  private blocsMonth(clock: ClockContext): void {
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
    // Layers 2 and 3 (J5): leaders, votes, budgets, accessions, exits,
    // collective defence.
    let joined = false;
    for (const event of stepBlocsMonth(this.blocEnv(clock.date))) {
      this.record(clock.date, event);
      if (event.type === "war-joined") joined = true;
    }
    if (joined) this.invalidateFronts();
  }

  private diplomacyMonth(clock: ClockContext): void {
    // Contests old enough end (J5): 5 years after a cession, 10 after the
    // last capture.
    const contest = this.deps.config.war.contest;
    this.deps.world.settleContested(contest.warMonths, contest.cessionMonths);
    // Arms sent to belligerents this month (J5).
    const flows = stepArmsFlows(this.aiEnv(clock.date));
    this.armsAid = { points: flows.points, cost: flows.cost };
    for (const event of flows.events) this.record(clock.date, event);
    for (const id of this.ctx.nationIds) {
      stepMilitaryMonth(
        this.ctx,
        this.military.nations[id],
        this.sheets.get(id)!,
        this.economy.nations[id],
        this.politics.nations[id],
        enemiesOf(this.diplomacy, id).length > 0,
        (1 + lawModifiers(this.ctx, this.politics.nations[id]).manpowerBonus) *
          (this.nuclear.fallout[id] ?? 1),
        this.armsAid.points[id] ?? 0,
      );
    }
    const before = this.diplomacy.wars.length;
    const events = stepDiplomacyMonth(
      this.ctx,
      this.diplomacy,
      this.economy,
      this.military,
      this.politics,
      this.rng,
      clock.date,
      this.aiNations(),
      (by, against) => blocSanction(this.ctx, this.blocs, by, against),
    );
    for (const event of events) this.record(clock.date, event);
    if (events.some((e) => e.type === "war-joined")) this.invalidateFronts();
    stepWarMonth(this.diplomacy);
    stepAirMonth(this.ctx, this.diplomacy, this.military, this.economy);

    // The war AI of the nations nobody plays: orders, then peace offers.
    for (const id of this.aiNations()) {
      const orders = stepWarAi(
        this.ctx,
        this.diplomacy,
        this.military,
        this.sheets.get(id)!,
        this.geometry,
        id,
      );
      for (const to of orders.ceasefireTo) {
        const war = this.diplomacy.wars.find(
          (w) => warSide(w, id) !== null && warSide(w, to) !== null,
        );
        if (war === undefined) continue;
        if (war.offers.some((o) => o.from === id && o.to === to)) continue;
        this.offerPeace(war, id, to, CEASEFIRE, clock.date);
      }
    }
    if (this.diplomacy.wars.length !== before) this.invalidateFronts();
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
  private record(date: string, event: DomainEvent, terms?: string): void {
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
      case "sanctions-lifted":
        params = { by: event.by };
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
    this.journal.push({ date, kind: event.type, nation: event.nation, params });
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
    this.ctx.claimHolders = (region) => this.deps.world.claimHolders(region);
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

  // The staggered review of the nation AI (J5).
  private aiTick(date: string): void {
    const env = this.aiEnv(date);
    let changed = false;
    for (const id of dueThisTick(env)) {
      for (const event of review(env, id)) {
        this.record(date, event);
        if (event.type === "war-declared" || event.type === "ai-landing") {
          changed = true;
        }
      }
    }
    if (changed) this.invalidateFronts();
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
