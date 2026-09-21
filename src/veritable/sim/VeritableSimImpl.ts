import { NationId } from "../data/schemas/common";
import { VeritableConfig } from "../data/schemas/config";
import { NationData } from "../data/schemas/nation";
import {
  Calendar,
  JournalEntry,
  NationState,
  SAVE_SCHEMA_VERSION,
  SaveFile,
} from "../data/schemas/save";
import { Scenario } from "../data/schemas/scenario";
import { dateAfter } from "./calendar";
import { nationFromData, statusFromTerritory } from "./nation";
import { Rng } from "./rng";
import { DomainSystem, PerfProbe, Scheduler } from "./scheduler";
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
  // Nation sheets of data/veritable/nations/, looked up by scenario.nations.
  nationData: (id: NationId) => NationData | undefined;
  // Domain systems plugged on the scheduler (all empty at J1) and the probe
  // that times them.
  systems?: readonly DomainSystem[];
  perf?: PerfProbe;
}

const METRIC_ADVANCE_CALLS = "sim.advanceCalls";

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
  private initialized = false;

  private readonly scheduler: Scheduler;

  constructor(private readonly deps: SimDeps) {
    this.scheduler = new Scheduler(deps.systems, deps.perf);
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
    this.nations = scenario.nations.map((id) => {
      const data = this.deps.nationData(id);
      if (data === undefined) {
        throw new Error(`scenario ${scenario.id}: no nation sheet for ${id}`);
      }
      return nationFromData(data, id === scenario.playerDefault);
    });
    this.journal = [
      { date: this.calendar.date, kind: "campaign-started", params: {} },
    ];
    this.metrics = { [METRIC_ADVANCE_CALLS]: 0 };
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
    this.seed = state.seed;
    this.rng = Rng.fromState(state.rngState);
    this.calendar = state.calendar;
    this.nations = state.nations;
    this.journal = state.journal;
    this.metrics = state.metrics;
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
        break;
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
      playerNation: this.nations.find((n) => n.isPlayer)?.id ?? null,
      nations: this.nations,
      journal: this.journal,
    };
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
