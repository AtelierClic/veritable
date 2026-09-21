import { BordersWorld } from "../../../src/veritable/adapters/BordersWorld";
import { ScenarioPack } from "../../../src/veritable/adapters/scenarioWorld";
import { VeritableConfig } from "../../../src/veritable/data/schemas/config";
import { GOOD_IDS } from "../../../src/veritable/data/schemas/goods";
import { MINUTES_PER_GAME_DAY } from "../../../src/veritable/sim/calendar";
import {
  ClockKind,
  Domain,
  PerfProbe,
} from "../../../src/veritable/sim/scheduler";
import { SimEvent } from "../../../src/veritable/sim/VeritableSim";
import { VeritableSimImpl } from "../../../src/veritable/sim/VeritableSimImpl";

// One headless campaign: the simulation alone, AI against AI, no rendering and
// (at J2) no OpenFront core. Same VeritableSim interface as the client.

// --shock cut-gas-exports:RUS@2028-01
export interface Shock {
  kind: "cut-gas-exports";
  nation: string;
  month: string; // YYYY-MM
}

export function parseShock(text: string): Shock {
  const match = /^(cut-gas-exports):([A-Za-z0-9-]+)@(\d{4}-\d{2})$/.exec(text);
  if (match === null) {
    throw new Error(
      `unknown shock "${text}" (cut-gas-exports:<NATION>@YYYY-MM)`,
    );
  }
  return { kind: "cut-gas-exports", nation: match[2], month: match[3] };
}

export interface CampaignOptions {
  pack: ScenarioPack;
  config: VeritableConfig;
  seed: number;
  years: number;
  player?: string;
  shock?: Shock;
}

export interface MonthRow {
  date: string;
  prices: Record<string, number>; // relative to the base price
  gdp: Record<string, number>; // US$
  debtToGdp: Record<string, number>;
  stability: Record<string, number>;
  shortage: Record<string, number>;
  gasCoverage: Record<string, number>;
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

class TimingProbe implements PerfProbe {
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

export function runCampaign(options: CampaignOptions): CampaignResult {
  const { pack, config, seed, years, shock } = options;
  const player = options.player ?? pack.scenario.playerDefault;
  const probe = new TimingProbe();
  const sim = new VeritableSimImpl({
    config,
    world: new BordersWorld(pack.borders),
    data: pack.data,
    nationData: (id) => pack.nations.find((n) => n.id === id),
    perf: probe,
    autopilot: true,
  });
  const started = performance.now();
  sim.init({ ...pack.scenario, playerDefault: player }, seed);

  const basePrice = Object.fromEntries(
    pack.data.goods.map((g) => [g.id, g.basePrice]),
  );
  const startYear = Number(pack.scenario.startDate.slice(0, 4));
  const endDate = `${startYear + years}${pack.scenario.startDate.slice(4)}`;
  const series: MonthRow[] = [];
  const counts: Record<string, number> = {};
  const defaults: string[] = [];
  const unrest: string[] = [];
  const priceRange: Record<string, [number, number]> = Object.fromEntries(
    GOOD_IDS.map((g) => [g, [1, 1]]),
  );
  const maxDebt: Record<string, number> = {};
  let shockApplied = false;

  const sample = (date: string) => {
    const view = sim.read();
    const pick = (f: (id: string) => number) =>
      Object.fromEntries(pack.scenario.nations.map((id) => [id, f(id)]));
    const row: MonthRow = {
      date,
      prices: Object.fromEntries(
        GOOD_IDS.map((g) => [g, view.market.prices[g] / basePrice[g]]),
      ),
      gdp: pick((id) => view.economies[id].gdp),
      debtToGdp: pick((id) => view.economies[id].debt / view.economies[id].gdp),
      stability: pick((id) => view.politics[id].stability),
      shortage: pick((id) => view.economies[id].shortage),
      gasCoverage: pick((id) => view.economies[id].coverage.gas),
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
    if (event.type === "month-started") sample(event.date);
  };

  while (sim.read().date < endDate) {
    if (
      shock !== undefined &&
      !shockApplied &&
      sim.read().date.slice(0, 7) >= shock.month
    ) {
      // Embargo on the gas exports of one nation towards every other nation
      // of the scenario (the rest of the world keeps buying).
      for (const to of pack.scenario.nations) {
        if (to === shock.nation) continue;
        sim.apply({
          type: "set-embargo",
          from: shock.nation,
          to,
          good: "gas",
          active: true,
        });
      }
      shockApplied = true;
    }
    for (const event of sim.advance(MINUTES_PER_GAME_DAY)) onEvent(event);
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
    endDate: sim.read().date,
    wallMs: Math.round(performance.now() - started),
    cpuMsByDomain: Object.fromEntries(
      Object.entries(probe.byDomain).map(([k, v]) => [
        k,
        { calls: v.calls, totalMs: Number(v.totalMs.toFixed(1)) },
      ]),
    ),
    events: counts,
    defaults,
    unrest,
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
    ...nations.map((n) => `gdp_${n}`),
    ...nations.map((n) => `debt_${n}`),
    ...nations.map((n) => `stability_${n}`),
    ...nations.map((n) => `shortage_${n}`),
    ...nations.map((n) => `gas_coverage_${n}`),
  ];
  const lines = [header.join(",")];
  for (const row of result.series) {
    lines.push(
      [
        row.date,
        ...GOOD_IDS.map((g) => row.prices[g].toFixed(4)),
        ...nations.map((n) => (row.gdp[n] / 1e9).toFixed(2)),
        ...nations.map((n) => row.debtToGdp[n].toFixed(4)),
        ...nations.map((n) => row.stability[n].toFixed(4)),
        ...nations.map((n) => row.shortage[n].toFixed(4)),
        ...nations.map((n) => row.gasCoverage[n].toFixed(4)),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}
