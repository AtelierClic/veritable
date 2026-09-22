import { stepFiscalRule } from "../ai/fiscal";
import { NationId } from "../data/schemas/common";
import { VeritableConfig } from "../data/schemas/config";
import { NationData } from "../data/schemas/nation";
import { ROW_ID } from "../data/schemas/row";
import {
  Calendar,
  DiplomacyState,
  EconomyState,
  JournalEntry,
  MilitaryState,
  NationState,
  PoliticsState,
  SAVE_SCHEMA_VERSION,
  SaveFile,
} from "../data/schemas/save";
import { Scenario } from "../data/schemas/scenario";
import { BlocEvent, stepFiscalRules } from "./blocs/fiscalRule";
import { dateAfter } from "./calendar";
import {
  availableCasusBelli,
  declareWar,
  DiplomacyEvent,
  enemiesOf,
  imposeSanctions,
  initDiplomacy,
  liftSanctions,
  stepDiplomacyMonth,
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
import { nationFromData, statusFromTerritory } from "./nation";
import { PoliticsEvent, stepPolitics } from "./politics/politics";
import { Rng } from "./rng";
import { ClockContext, DomainSystem, PerfProbe, Scheduler } from "./scheduler";
import {
  FrontView,
  PlayerCommand,
  PlayerCommandSchema,
  ReadonlyWorldView,
  SimEvent,
  VeritableSim,
  WorldPort,
} from "./VeritableSim";
import {
  assignDivision,
  disbandDivision,
  initMilitary,
  raiseDivision,
  setConscription,
  setPosture,
  stepMilitaryMonth,
} from "./war/military";

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
type DomainEvent = BudgetEvent | PoliticsEvent | BlocEvent | DiplomacyEvent;

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
  private scenario!: Scenario;
  private ctx!: EconomyContext;
  private sheets = new Map<NationId, NationData>();
  private initialized = false;

  // Left by the monthly flows for the budget of the same month.
  private trade: MonthlyTrade | null = null;
  private pending: SimEvent[] = [];
  private readonly scheduler: Scheduler;

  constructor(private readonly deps: SimDeps) {
    this.scheduler = new Scheduler(this.systems(), deps.perf);
  }

  // The domains, plugged on the central scheduler.
  private systems(): DomainSystem[] {
    return [
      {
        domain: "economy",
        onDay: () => stepPrices(this.ctx, this.economy),
        onMonth: () => {
          this.trade = stepTrade(this.ctx, this.economy);
          stepGrowth(this.ctx, this.economy, this.politics, this.rng);
        },
      },
      { domain: "events" },
      { domain: "diplomacy", onMonth: (c) => this.diplomacyMonth(c) },
      {
        domain: "politics",
        onWeek: (c) => this.politicsWeek(c),
        onMonth: (c) => this.budgetMonth(c),
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
    );
    this.diplomacy = initDiplomacy(this.ctx, scenario);
    this.military = initMilitary(this.ctx, sheets);
    this.journal = [
      { date: this.calendar.date, kind: "campaign-started", params: {} },
    ];
    this.metrics = { [METRIC_ADVANCE_CALLS]: 0 };
    this.trade = null;
    this.initialized = true;
    this.refreshTileCounts();
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
    this.trade = null;
    this.initialized = true;
    this.deps.world.restore(this.nationIds(), state.world, {
      width: state.tilesInfo.width,
      height: state.tilesInfo.height,
      tiles: state.tiles,
    });
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
      blocs: [],
      world,
      economy: this.economy,
      politics: this.politics,
      diplomacy: this.diplomacy,
      military: this.military,
      journal: this.journal,
      metrics: this.metrics,
      tilesInfo: { width: grid.width, height: grid.height },
      tiles: grid.tiles,
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
        const economy = this.playerEconomy();
        economy.taxes[cmd.tax] = Math.min(
          cmd.rate,
          this.deps.config.budget.maxTaxRate[cmd.tax],
        );
        return;
      }
      case "set-spending": {
        const economy = this.playerEconomy();
        economy.spending[cmd.post] = Math.min(
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
        setConscription(
          this.ctx,
          this.military.nations[me],
          this.sheets.get(me)!.population.value,
          cmd.level,
        );
        return;
      }
      case "propose-peace":
      case "answer-peace":
        throw new Error(
          `${cmd.type}: peace arrives with the fronts (J3 step 6)`,
        );
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
      fronts: this.frontViews(),
      casusBelli,
    };
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
      );
      for (const event of events) this.record(clock.date, event);
    }
  }

  private budgetMonth(clock: ClockContext): void {
    const trade = this.trade;
    if (trade === null) return; // the monthly flows always run first
    const player = this.playerNationId();
    for (const id of this.ctx.nationIds) {
      const economy = this.economy.nations[id];
      const events = stepBudget(
        this.ctx,
        id,
        economy,
        this.politics.nations[id],
        trade,
        clock.date,
      );
      for (const event of events) this.record(clock.date, event);
      if (id !== player || this.politics.autopilot) {
        stepFiscalRule(this.ctx, economy);
      }
    }
  }

  private blocsMonth(clock: ClockContext): void {
    for (const id of this.ctx.nationIds) {
      const events = stepFiscalRules(
        this.ctx.blocs,
        id,
        this.economy.nations[id],
        this.politics.nations[id],
      );
      for (const event of events) this.record(clock.date, event);
    }
  }

  private diplomacyMonth(clock: ClockContext): void {
    for (const id of this.ctx.nationIds) {
      stepMilitaryMonth(
        this.ctx,
        this.military.nations[id],
        this.sheets.get(id)!,
        this.economy.nations[id],
        this.politics.nations[id],
        enemiesOf(this.diplomacy, id).length > 0,
      );
    }
    const events = stepDiplomacyMonth(
      this.ctx,
      this.diplomacy,
      this.economy,
      this.military,
      this.rng,
      clock.date,
      this.aiNations(),
    );
    for (const event of events) this.record(clock.date, event);
  }

  // An event of a domain: returned by advance(), and written in the journal.
  private record(date: string, event: DomainEvent): void {
    this.pending.push({ ...event, date } as SimEvent);
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
      default:
        break;
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

  // Fronts arrive with step 6 of the J3 (war/fronts.ts).
  private frontViews(): FrontView[] {
    return [];
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
