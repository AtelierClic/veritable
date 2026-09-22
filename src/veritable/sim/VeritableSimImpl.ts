import { stepFiscalRule } from "../ai/fiscal";
import { NationId } from "../data/schemas/common";
import { VeritableConfig } from "../data/schemas/config";
import { NationData } from "../data/schemas/nation";
import { ROW_ID } from "../data/schemas/row";
import {
  Calendar,
  EconomyState,
  JournalEntry,
  NationState,
  PoliticsState,
  SAVE_SCHEMA_VERSION,
  SaveFile,
} from "../data/schemas/save";
import { Scenario } from "../data/schemas/scenario";
import { BlocEvent, stepFiscalRules } from "./blocs/fiscalRule";
import { dateAfter } from "./calendar";
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
  PlayerCommand,
  PlayerCommandSchema,
  ReadonlyWorldView,
  SimEvent,
  VeritableSim,
  WorldPort,
} from "./VeritableSim";

export interface SimDeps {
  config: VeritableConfig;
  world: WorldPort;
  // Static data of the campaign: goods, rest of the world, blocs, geography.
  data: SimData;
  // Nation sheets of data/veritable/nations/, looked up by scenario.nations.
  nationData: (id: NationId) => NationData | undefined;
  perf?: PerfProbe;
  // True when nobody plays: the AI fiscal rule also runs the player's nation
  // (headless runner).
  autopilot?: boolean;
}

const METRIC_ADVANCE_CALLS = "sim.advanceCalls";

// What the domain systems report; the simulation dates it.
type DomainEvent = BudgetEvent | PoliticsEvent | BlocEvent;

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

  // The domains of the J2, plugged on the central scheduler.
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
      { domain: "diplomacy" },
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
    this.loadSheets(
      state.nations.map((n) => n.id),
      "save",
    );
    this.seed = state.seed;
    this.rng = Rng.fromState(state.rngState);
    this.calendar = state.calendar;
    this.nations = state.nations;
    this.journal = state.journal;
    this.metrics = state.metrics;
    this.economy = state.economy;
    this.politics = state.politics;
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
      journal: this.journal,
      metrics: this.metrics,
      tilesInfo: { width: grid.width, height: grid.height },
      tiles: grid.tiles,
    });
  }

  apply(command: PlayerCommand): void {
    this.assertInitialized();
    const cmd = PlayerCommandSchema.parse(command);
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
    // Domain systems push what happened into `pending` while the clocks run.
    this.pending = [];
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
    return {
      seed: this.seed,
      date: this.calendar.date,
      elapsedGameMinutes: this.calendar.elapsedGameMinutes,
      speed: this.calendar.speed,
      playerNation: this.playerNationId(),
      nations: this.nations,
      journal: this.journal,
      market: this.economy.market,
      economies: this.economy.nations,
      politics: this.politics.nations,
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

  // An event of a domain: returned by advance(), and written in the journal.
  private record(date: string, event: DomainEvent): void {
    this.pending.push({ ...event, date } as SimEvent);
    const params: Record<string, string> =
      event.type === "bloc-reprimand"
        ? {
            bloc: event.bloc,
            deficit: (event.deficitToGdp * 100).toFixed(1),
            debt: (event.debtToGdp * 100).toFixed(0),
          }
        : {};
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

  private playerEconomy() {
    const id = this.playerNationId();
    if (id === null) throw new Error("no player nation");
    return this.economy.nations[id];
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
