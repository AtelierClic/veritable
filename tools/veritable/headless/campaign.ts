import { BordersWorld } from "../../../src/veritable/adapters/BordersWorld";
import { ScenarioPack } from "../../../src/veritable/adapters/scenarioWorld";
import { VeritableConfig } from "../../../src/veritable/data/schemas/config";
import { GOOD_IDS, GoodId } from "../../../src/veritable/data/schemas/goods";
import { MINUTES_PER_GAME_DAY } from "../../../src/veritable/sim/calendar";
import {
  ClockKind,
  Domain,
  PerfProbe,
} from "../../../src/veritable/sim/scheduler";
import {
  PlayerCommand,
  PlayerCommandSchema,
  ReadonlyWorldView,
  SimEvent,
} from "../../../src/veritable/sim/VeritableSim";
import { VeritableSimImpl } from "../../../src/veritable/sim/VeritableSimImpl";

// One headless campaign: AI against AI, no rendering, the same VeritableSim
// interface as the client. Two drivers:
//   - the simulation alone on the static borders (fast, no fronts);
//   - the simulation next to the OpenFront core on the real map (J3: fronts,
//     captures, landings), see coreDriver.ts.

// --shock cut-gas-exports:RUS@2028-01   every other nation stops buying its gas
// --shock eu-embargo:RUS@2027-01        the full EU members stop buying its
//                                       gas and oil (delivery test 1 of J3)
export const SHOCK_KINDS = ["cut-gas-exports", "eu-embargo"] as const;
export interface Shock {
  kind: (typeof SHOCK_KINDS)[number];
  nation: string;
  month: string; // YYYY-MM
}

export function parseShock(text: string): Shock {
  const match = /^([a-z-]+):([A-Za-z0-9-]+)@(\d{4}-\d{2})$/.exec(text);
  const kind = SHOCK_KINDS.find((k) => k === match?.[1]);
  if (match === null || kind === undefined) {
    throw new Error(
      `unknown shock "${text}" (${SHOCK_KINDS.join(" | ")}:<NATION>@YYYY-MM)`,
    );
  }
  return { kind, nation: match[2], month: match[3] };
}

// The embargoes a shock puts in place: exporter, importer, good.
export function shockEmbargoes(
  shock: Shock,
  pack: ScenarioPack,
): { from: string; to: string; good: GoodId }[] {
  const others = pack.scenario.nations.filter((id) => id !== shock.nation);
  if (shock.kind === "cut-gas-exports") {
    return others.map((to) => ({ from: shock.nation, to, good: "gas" }));
  }
  const eu = pack.data.blocs.find((b) => b.id === "eu");
  if (eu === undefined) throw new Error("eu-embargo: no EU bloc in the data");
  const members = eu.members
    .filter((m) => m.status === "full" && others.includes(m.nation))
    .map((m) => m.nation);
  return (["gas", "oil"] as GoodId[]).flatMap((good) =>
    members.map((to) => ({ from: shock.nation, to, good })),
  );
}

// --script commands.json: dated player commands, replayed when the campaign
// reaches their date (the scripted nation is the player, run by nobody
// else). A macro "send-all" assigns every division of the player to a front
// with a posture.
export interface ScriptEntry {
  date: string; // YYYY-MM-DD
  command?: PlayerCommand;
  macro?: {
    kind: "send-all";
    front: string;
    posture: "defend" | "attack" | "breakthrough";
  };
}

export function parseScript(raw: unknown): ScriptEntry[] {
  if (!Array.isArray(raw)) throw new Error("script: expected an array");
  return raw.map((entry, i) => {
    const e = entry as Record<string, unknown>;
    if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
      throw new Error(`script entry ${i}: bad date`);
    }
    if (e.macro !== undefined) {
      const m = e.macro as Record<string, unknown>;
      if (m.kind !== "send-all" || typeof m.front !== "string") {
        throw new Error(`script entry ${i}: unknown macro`);
      }
      return {
        date: e.date,
        macro: {
          kind: "send-all",
          front: m.front,
          posture:
            (m.posture as "defend" | "attack" | "breakthrough") ?? "attack",
        },
      };
    }
    return { date: e.date, command: PlayerCommandSchema.parse(e.command) };
  });
}

// What a campaign runs on: the simulation alone, or the simulation with the
// core. advanceDay() returns the events of the day.
export interface Driver {
  read(): ReadonlyWorldView;
  apply(command: PlayerCommand): void;
  advanceDay(): SimEvent[];
  perf(): Record<string, { calls: number; totalMs: number }>;
}

export class TimingProbe implements PerfProbe {
  readonly byDomain: Record<string, { calls: number; totalMs: number }> = {};
  measure(domain: Domain, clock: ClockKind, run: () => void): void {
    const key = `${domain}:${clock}`;
    const started = performance.now();
    run();
    const entry = (this.byDomain[key] ??= { calls: 0, totalMs: 0 });
    entry.calls++;
    entry.totalMs += performance.now() - started;
  }
}

export function simDriver(
  pack: ScenarioPack,
  config: VeritableConfig,
  seed: number,
  player: string,
  autopilot: boolean,
): Driver {
  const probe = new TimingProbe();
  const sim = new VeritableSimImpl({
    config,
    world: new BordersWorld(pack.borders, pack.zones),
    data: pack.data,
    nationData: (id) => pack.nations.find((n) => n.id === id),
    scenario: pack.scenario,
    perf: probe,
    autopilot,
  });
  sim.init({ ...pack.scenario, playerDefault: player }, seed);
  return {
    read: () => sim.read(),
    apply: (command) => sim.apply(command),
    advanceDay: () => sim.advance(MINUTES_PER_GAME_DAY),
    perf: () => probe.byDomain,
  };
}

export interface CampaignOptions {
  pack: ScenarioPack;
  config: VeritableConfig;
  seed: number;
  years: number;
  player?: string;
  shock?: Shock;
  script?: ScriptEntry[];
  // Prepared driver; the simulation alone when absent.
  driver?: Driver;
}

export interface MonthRow {
  date: string;
  prices: Record<string, number>; // world price, relative to the base price
  importPrices: Record<string, number>; // paid by the scenario's importers
  gdp: Record<string, number>; // US$
  debtToGdp: Record<string, number>;
  stability: Record<string, number>;
  shortage: Record<string, number>;
  gasCoverage: Record<string, number>;
  maritimeTrade: Record<string, number>; // US$ per year
  blockade: Record<string, number>;
  tiles: Record<string, number>;
  exhaustion: Record<string, number>;
  sanctionsAgainst: Record<string, number>; // nations sanctioning it
  atWar: Record<string, number>; // 1 when at war
  exportShare: Record<string, number>; // exports really sold / GDP
  circumvention: Record<string, number>;
}

export interface CampaignResult {
  scenario: string;
  seed: number;
  years: number;
  player: string;
  shock: Shock | null;
  startDate: string;
  endDate: string;
  wallMs: number;
  cpuMsByDomain: Record<string, { calls: number; totalMs: number }>;
  events: Record<string, number>;
  defaults: string[];
  unrest: string[];
  wars: string[]; // declarations and joins, "nation>target@date"
  final: {
    worldGdp: number;
    prices: Record<string, number>;
    priceRange: Record<string, [number, number]>;
    debtToGdp: Record<string, number>;
    maxDebtToGdp: Record<string, number>;
    stability: Record<string, number>;
    meanStability: number;
  };
  series: MonthRow[];
}

export function runCampaign(options: CampaignOptions): CampaignResult {
  const { pack, config, seed, years, shock, script } = options;
  const player = options.player ?? pack.scenario.playerDefault;
  const driver =
    options.driver ??
    simDriver(pack, config, seed, player, script === undefined);
  const started = performance.now();

  const basePrice = Object.fromEntries(
    pack.data.goods.map((g) => [g.id, g.basePrice]),
  );
  const startYear = Number(pack.scenario.startDate.slice(0, 4));
  const endDate = `${startYear + years}${pack.scenario.startDate.slice(4)}`;
  const series: MonthRow[] = [];
  const counts: Record<string, number> = {};
  const defaults: string[] = [];
  const unrest: string[] = [];
  const wars: string[] = [];
  const priceRange: Record<string, [number, number]> = Object.fromEntries(
    GOOD_IDS.map((g) => [g, [1, 1]]),
  );
  const maxDebt: Record<string, number> = {};
  let shockApplied = false;
  const pending = [...(script ?? [])].sort((a, b) =>
    a.date < b.date ? -1 : 1,
  );

  const sample = (date: string) => {
    const view = driver.read();
    const pick = (f: (id: string) => number) =>
      Object.fromEntries(pack.scenario.nations.map((id) => [id, f(id)]));
    const row: MonthRow = {
      date,
      prices: Object.fromEntries(
        GOOD_IDS.map((g) => [g, view.market.prices[g] / basePrice[g]]),
      ),
      importPrices: Object.fromEntries(
        GOOD_IDS.map((g) => [g, view.market.importPrices[g] / basePrice[g]]),
      ),
      gdp: pick((id) => view.economies[id].gdp),
      debtToGdp: pick((id) => view.economies[id].debt / view.economies[id].gdp),
      stability: pick((id) => view.politics[id].stability),
      shortage: pick((id) => view.economies[id].shortage),
      gasCoverage: pick((id) => view.economies[id].coverage.gas),
      maritimeTrade: pick((id) => view.economies[id].maritimeTradeValue),
      blockade: pick((id) => view.naval.blockade[id] ?? 0),
      tiles: pick(
        (id) => view.nations.find((n) => n.id === id)?.tileCount ?? 0,
      ),
      exhaustion: pick((id) => view.military.nations[id]?.exhaustion ?? 0),
      sanctionsAgainst: pick(
        (id) => view.diplomacy.sanctions.filter((s) => s.against === id).length,
      ),
      atWar: pick((id) =>
        view.diplomacy.wars.some(
          (w) => w.aggressors.includes(id) || w.defenders.includes(id),
        )
          ? 1
          : 0,
      ),
      exportShare: pick(
        (id) => view.economies[id].exportsValue / view.economies[id].gdp,
      ),
      circumvention: pick((id) => view.economies[id].circumvention),
    };
    for (const g of GOOD_IDS) {
      priceRange[g][0] = Math.min(priceRange[g][0], row.prices[g]);
      priceRange[g][1] = Math.max(priceRange[g][1], row.prices[g]);
    }
    for (const id of pack.scenario.nations) {
      maxDebt[id] = Math.max(maxDebt[id] ?? -Infinity, row.debtToGdp[id]);
    }
    series.push(row);
  };
  sample(pack.scenario.startDate);

  const onEvent = (event: SimEvent) => {
    if (event.type === "day-started") return;
    counts[event.type] = (counts[event.type] ?? 0) + 1;
    if (event.type === "sovereign-default") {
      defaults.push(`${event.nation}@${event.date}`);
    }
    if (event.type === "unrest-started") {
      unrest.push(`${event.nation}@${event.date}`);
    }
    if (event.type === "war-declared") {
      wars.push(`${event.nation}>${event.target}@${event.date}`);
    }
    if (event.type === "war-joined") {
      wars.push(`${event.nation}>${event.against}@${event.date}`);
    }
    if (event.type === "month-started") sample(event.date);
  };

  while (driver.read().date < endDate) {
    const date = driver.read().date;
    if (
      shock !== undefined &&
      !shockApplied &&
      date.slice(0, 7) >= shock.month
    ) {
      // The rest of the world keeps buying.
      for (const embargo of shockEmbargoes(shock, pack)) {
        driver.apply({ type: "set-embargo", ...embargo, active: true });
      }
      shockApplied = true;
    }
    while (pending.length > 0 && pending[0].date <= date) {
      const entry = pending.shift()!;
      if (entry.command !== undefined) driver.apply(entry.command);
      else if (entry.macro !== undefined) {
        const view = driver.read();
        for (const d of view.military.nations[player]?.divisions ?? []) {
          driver.apply({
            type: "assign-division",
            division: d.id,
            front: entry.macro.front,
            segment: null,
          });
          driver.apply({
            type: "set-posture",
            division: d.id,
            posture: entry.macro.posture,
          });
        }
      }
    }
    for (const event of driver.advanceDay()) onEvent(event);
  }

  const last = series[series.length - 1];
  const stabilities = Object.values(last.stability);
  return {
    scenario: pack.scenario.id,
    seed,
    years,
    player,
    shock: shock ?? null,
    startDate: pack.scenario.startDate,
    endDate: driver.read().date,
    wallMs: Math.round(performance.now() - started),
    cpuMsByDomain: Object.fromEntries(
      Object.entries(driver.perf()).map(([k, v]) => [
        k,
        { calls: v.calls, totalMs: Number(v.totalMs.toFixed(1)) },
      ]),
    ),
    events: counts,
    defaults,
    unrest,
    wars,
    final: {
      worldGdp: Object.values(last.gdp).reduce((a, b) => a + b, 0),
      prices: last.prices,
      priceRange,
      debtToGdp: last.debtToGdp,
      maxDebtToGdp: maxDebt,
      stability: last.stability,
      meanStability:
        stabilities.reduce((a, b) => a + b, 0) / stabilities.length,
    },
    series,
  };
}

// One CSV per campaign: a row per game month, a column per series.
export function seriesCsv(result: CampaignResult): string {
  const nations = Object.keys(result.series[0].gdp);
  const header = [
    "date",
    ...GOOD_IDS.map((g) => `price_${g}`),
    ...GOOD_IDS.map((g) => `import_price_${g}`),
    ...nations.map((n) => `gdp_${n}`),
    ...nations.map((n) => `debt_${n}`),
    ...nations.map((n) => `stability_${n}`),
    ...nations.map((n) => `shortage_${n}`),
    ...nations.map((n) => `gas_coverage_${n}`),
    ...nations.map((n) => `maritime_trade_${n}`),
    ...nations.map((n) => `blockade_${n}`),
    ...nations.map((n) => `tiles_${n}`),
    ...nations.map((n) => `exhaustion_${n}`),
    ...nations.map((n) => `sanctions_against_${n}`),
    ...nations.map((n) => `at_war_${n}`),
    ...nations.map((n) => `export_share_${n}`),
    ...nations.map((n) => `circumvention_${n}`),
  ];
  const lines = [header.join(",")];
  for (const row of result.series) {
    lines.push(
      [
        row.date,
        ...GOOD_IDS.map((g) => row.prices[g].toFixed(4)),
        ...GOOD_IDS.map((g) => row.importPrices[g].toFixed(4)),
        ...nations.map((n) => (row.gdp[n] / 1e9).toFixed(2)),
        ...nations.map((n) => row.debtToGdp[n].toFixed(4)),
        ...nations.map((n) => row.stability[n].toFixed(4)),
        ...nations.map((n) => row.shortage[n].toFixed(4)),
        ...nations.map((n) => row.gasCoverage[n].toFixed(4)),
        ...nations.map((n) => (row.maritimeTrade[n] / 1e9).toFixed(2)),
        ...nations.map((n) => row.blockade[n].toFixed(4)),
        ...nations.map((n) => String(row.tiles[n])),
        ...nations.map((n) => row.exhaustion[n].toFixed(4)),
        ...nations.map((n) => String(row.sanctionsAgainst[n])),
        ...nations.map((n) => String(row.atWar[n])),
        ...nations.map((n) => row.exportShare[n].toFixed(4)),
        ...nations.map((n) => row.circumvention[n].toFixed(3)),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}
