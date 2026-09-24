import { fork } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { CampaignResult } from "./campaign";

// Delivery of the J5: many campaigns headless, spread over child processes
// (node's child_process, no dependency), then the criteria and the
// distributions of wars and nuclear shots.
//   npx tsx tools/veritable/headless/delivery.ts --runs 100 --years 50
//       --parallel 5 --seed 1 --core --out docs/veritable/reports/J5
//   --aggregate: only read the campaign files already in --out.

const HERE = path.dirname(fileURLToPath(import.meta.url));

function option(args: string[], name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}

type Campaign = Omit<CampaignResult, "series"> & {
  yearlyPrices: { date: string; prices: Record<string, number> }[];
};

// The nation sheets, for the region of the world and the arsenal of the
// first day (J6c: the criteria of the world).
const NATIONS_DIR = path.resolve(HERE, "../../../data/veritable/nations");
const sheets = new Map<
  string,
  { region: string | null; nuclear: boolean } | null
>();
function sheetOf(id: string): { region: string | null; nuclear: boolean } {
  if (!sheets.has(id)) {
    const file = path.join(NATIONS_DIR, `${id.toLowerCase()}.json`);
    if (!fs.existsSync(file)) {
      sheets.set(id, null);
    } else {
      const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
        geography?: { region: string };
        nuclear: { warheads: number } | null;
      };
      sheets.set(id, {
        region: data.geography?.region ?? null,
        nuclear: (data.nuclear?.warheads ?? 0) > 0,
      });
    }
  }
  return sheets.get(id) ?? { region: null, nuclear: false };
}

// Regimes the world criteria call fragile (J6c).
const FRAGILE = ["electoral-authoritarian", "junta", "failed-state"];

async function runAll(
  seeds: number[],
  parallel: number,
  years: number,
  out: string,
  core: boolean,
  scenario: string,
): Promise<void> {
  const groups: number[][] = Array.from({ length: parallel }, () => []);
  seeds.forEach((seed, i) => groups[i % parallel].push(seed));
  await Promise.all(
    groups
      .filter((g) => g.length > 0)
      .map(
        (group, index) =>
          new Promise<void>((resolve, reject) => {
            const child = fork(
              path.join(HERE, "deliveryWorker.ts"),
              [
                "--seeds",
                group.join(","),
                "--years",
                String(years),
                "--out",
                out,
                "--scenario",
                scenario,
                ...(core ? ["--core"] : []),
              ],
              {
                execArgv: ["--import", "tsx"],
                stdio: ["ignore", "pipe", "pipe", "ipc"],
              },
            );
            child.stdout?.on("data", (chunk: Buffer) => {
              for (const line of chunk.toString().split("\n")) {
                if (line.startsWith("done")) {
                  process.stdout.write(`[${index}] ${line}\n`);
                }
              }
            });
            child.stderr?.on("data", (chunk: Buffer) => {
              const text = chunk.toString();
              if (/error|Error/.test(text))
                process.stderr.write(`[${index}] ${text}`);
            });
            child.on("exit", (code) =>
              code === 0
                ? resolve()
                : reject(new Error(`worker ${index}: ${code}`)),
            );
          }),
      ),
  );
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function histogram(values: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[String(v)] = (out[String(v)] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(out).sort((a, b) => Number(a[0]) - Number(b[0])),
  );
}

// The RUS-UKR loop (J6): relaunches of the war by Russia, and whether the
// end of the war of the scenario was followed by fifteen years without a
// new war between the two (either way).
export function rusUkrLoop(campaigns: Campaign[]) {
  const relaunches = campaigns.map(
    (c) =>
      c.delivery.newWars.filter((w) => w.by === "RUS" && w.target === "UKR")
        .length,
  );
  const window = (date: string) =>
    `${Number(date.slice(0, 4)) + 15}${date.slice(4)}`;
  let ended = 0;
  let calm = 0;
  const reprises: number[] = [];
  for (const c of campaigns) {
    const peace = (c.delivery.peaces ?? []).find(
      (p) => p.war === "rus-ukr-2022",
    );
    if (peace === undefined) continue;
    ended++;
    const next = c.delivery.newWars.find(
      (w) =>
        ((w.by === "RUS" && w.target === "UKR") ||
          (w.by === "UKR" && w.target === "RUS")) &&
        w.date > peace.date,
    );
    if (next === undefined || next.date > window(peace.date)) calm++;
    if (next !== undefined) {
      reprises.push(
        Number(next.date.slice(0, 4)) - Number(peace.date.slice(0, 4)),
      );
    }
  }
  return {
    relaunchMedian: median(relaunches),
    relaunchMax: Math.max(0, ...relaunches),
    relaunchesPerCampaign: histogram(relaunches),
    scenarioWarEnded: ended,
    calm15Years: calm,
    calmShare: campaigns.length === 0 ? 0 : calm / campaigns.length,
    yearsToReprise: histogram(reprises),
  };
}

export function aggregate(campaigns: Campaign[]) {
  const n = campaigns.length;
  const loop = rusUkrLoop(campaigns);
  const start = campaigns[0]?.startDate ?? "2026-01-01";
  const yearOne = `${Number(start.slice(0, 4)) + 1}${start.slice(4)}`;
  const wars = campaigns.map((c) => c.delivery.newWars.length);
  const allWars = campaigns.flatMap((c) => c.delivery.newWars);
  const withoutCasus = allWars.filter((w) => w.casusBelli === "none").length;
  const shots = campaigns.flatMap((c) =>
    c.delivery.nuclearShots.map((s) => ({ ...s, seed: c.seed })),
  );
  const campaignsWithShots = campaigns.filter(
    (c) => c.delivery.nuclearShots.length > 0,
  );
  const threeWay = campaigns.filter(
    (c) =>
      new Set(
        c.delivery.nuclearShots
          .map((s) => s.by)
          .filter((b) => sheetOf(b).nuclear),
      ).size >= 3,
  );
  const revolutions = campaigns.flatMap((c) => c.delivery.revolutions);
  const crisis = campaigns.filter((c) => c.delivery.crisisBy10Years).length;
  const junta = (id: string) =>
    campaigns.filter((c) => c.delivery.regimeAt10Years[id] === "junta").length;
  let low = Infinity;
  let high = -Infinity;
  for (const c of campaigns) {
    for (const [lo, hi] of Object.values(c.final.priceRange)) {
      low = Math.min(low, lo);
      high = Math.max(high, hi);
    }
  }
  const unstableDefaults = campaigns.flatMap((c) =>
    c.defaults
      .filter((d) => {
        const nation = d.split("@")[0];
        const p = c.politics[nation];
        return p === undefined || (p.coups === 0 && p.revolutions === 0);
      })
      .map((d) => `${d} (seed ${c.seed})`),
  );
  const tierDates = (id: string) =>
    campaigns
      .map((c) => c.delivery.tier1CompleteAt[id])
      .filter((d): d is string => d !== null)
      .sort();
  const tier1 = Object.fromEntries(
    (campaigns[0]
      ? Object.keys(campaigns[0].delivery.tier1CompleteAt)
      : []
    ).map((id) => {
      const dates = tierDates(id);
      return [
        id,
        {
          completed: dates.length,
          median: dates.length > 0 ? dates[Math.floor(dates.length / 2)] : null,
          shareIn2035: median(
            campaigns.map((c) => c.delivery.tier1ShareIn2035[id] ?? 0),
          ),
        },
      ];
    }),
  );
  const world = worldMetrics(campaigns);
  const europe = {
    noShotInYearOne: shots.every((s) => s.date >= yearOne),
    shotsInAtMost5pct: campaignsWithShots.length <= 0.05 * n,
    neverBelowLevel2: shots.every((s) => s.threat >= 2),
    noThreeWayExchange: threeWay.length === 0,
    warsMedian1to4: median(wars) >= 1 && median(wars) <= 4,
    warsMax10: Math.max(0, ...wars) <= 10,
    under30pctWithoutCasusBelli:
      allWars.length === 0 || withoutCasus / allWars.length < 0.3,
    atLeastOneRevolution: revolutions.length > 0,
    crisisInHalfAt10Years: crisis >= 0.5 * n,
    rusJuntaAtMost20pct: junta("RUS") <= 0.2 * n,
    turJuntaAtMost20pct: junta("TUR") <= 0.2 * n,
    pricesBounded: low >= 0.5 && high <= 2,
    noDefaultInStableNation: unstableDefaults.length === 0,
    // J6: the RUS-UKR loop.
    rusUkrRelaunchMedianAtMost1: loop.relaunchMedian <= 1,
    calm15YearsInAtLeast40pct: loop.calmShare >= 0.4,
  };
  // J6c: the campaigns of the world have their own criteria.
  const criteria =
    campaigns[0]?.scenario === "world-2026"
      ? {
          warsMedian10to30: median(wars) >= 10 && median(wars) <= 30,
          noPairAbove40pct: world.pairAbove40pct.length === 0,
          warsInAtLeast3Regions: world.regionsMin >= 3,
          under30pctWithoutCasusBelli:
            allWars.length === 0 || withoutCasus / allWars.length < 0.3,
          noShotInYearOne: shots.every((s) => s.date >= yearOne),
          shotsInAtMost10pct: campaignsWithShots.length <= 0.1 * n,
          neverBelowLevel2: shots.every((s) => s.threat >= 2),
          noThreeWayExchange: threeWay.length === 0,
          atLeast70pctCoupsInFragileRegimes: world.fragileCoupShare >= 0.7,
          pricesBounded: low >= 0.5 && high <= 2,
          defaultsOnlyInIndebtedOrUnstable: world.otherDefaults.length === 0,
        }
      : europe;
  return {
    campaigns: n,
    criteria,
    world,
    loop,
    wars: {
      median: median(wars),
      max: Math.max(0, ...wars),
      total: allWars.length,
      withoutCasusBelli: withoutCasus,
      byCasusBelli: histogramOf(allWars.map((w) => w.casusBelli)),
      byAggressor: histogramOf(allWars.map((w) => w.by)),
      perCampaign: histogram(wars),
    },
    nuclear: {
      campaignsWithShots: campaignsWithShots.length,
      shots: shots.length,
      byShooter: histogramOf(shots.map((s) => s.by)),
      byThreat: histogramOf(shots.map((s) => String(s.threat))),
      list: shots.map(
        (s) =>
          `${s.by}>${s.target}@${s.date} (level ${s.threat}, seed ${s.seed})`,
      ),
      threeWayCampaigns: threeWay.map((c) => c.seed),
    },
    politics: {
      revolutions,
      crisisBy10Years: crisis,
      juntaAt10Years: { RUS: junta("RUS"), TUR: junta("TUR") },
      coups: campaigns.reduce(
        (s, c) =>
          s + Object.values(c.politics).reduce((t, p) => t + p.coups, 0),
        0,
      ),
    },
    prices: { low, high },
    defaults: {
      total: campaigns.reduce((s, c) => s + c.defaults.length, 0),
      inStableNations: unstableDefaults,
    },
    technology: tier1,
    events: {
      mean:
        campaigns.reduce((s, c) => s + c.delivery.eventsOccurred, 0) /
        Math.max(1, n),
    },
    blocs: {
      decisionsMean:
        campaigns.reduce((s, c) => s + c.delivery.blocDecisions, 0) /
        Math.max(1, n),
    },
    wallMsMean: campaigns.reduce((s, c) => s + c.wallMs, 0) / Math.max(1, n),
  };
}

// The measures behind the criteria of the world (J6c): the share of the
// most frequent pair of belligerents in each campaign, the regions of the
// world its aggressors come from, the regimes the coups overthrew, the
// debt and stability of the nations that defaulted.
function worldMetrics(campaigns: Campaign[]) {
  const pairShares: number[] = [];
  const pairAbove40pct: string[] = [];
  const regionCounts: number[] = [];
  const pairs: Record<string, number> = {};
  const regions: Record<string, number> = {};
  for (const c of campaigns) {
    const wars = c.delivery.newWars;
    const count: Record<string, number> = {};
    const seen = new Set<string>();
    for (const w of wars) {
      const pair = [w.by, w.target].sort().join("-");
      count[pair] = (count[pair] ?? 0) + 1;
      pairs[pair] = (pairs[pair] ?? 0) + 1;
      const region = sheetOf(w.by).region ?? "?";
      seen.add(region);
      regions[region] = (regions[region] ?? 0) + 1;
    }
    const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
    const share = top === undefined ? 0 : top[1] / wars.length;
    pairShares.push(share);
    if (share > 0.4) {
      pairAbove40pct.push(`seed ${c.seed}: ${top[0]} ${top[1]}/${wars.length}`);
    }
    regionCounts.push(seen.size);
  }
  const coups = campaigns.flatMap((c) => c.delivery.coups ?? []);
  const fragile = coups.filter((k) => FRAGILE.includes(k.regime)).length;
  const defaults = campaigns.flatMap((c) =>
    (c.delivery.defaults ?? []).map((d) => ({ ...d, seed: c.seed })),
  );
  const otherDefaults = defaults
    .filter((d) => !(d.debtToGdp > 1 || d.stability < 0.4))
    .map(
      (d) =>
        `${d.nation}@${d.date} debt ${d.debtToGdp.toFixed(2)} stability ${d.stability.toFixed(2)} (seed ${d.seed})`,
    );
  return {
    pairShareMax: Math.max(0, ...pairShares),
    pairShareMedian: median(pairShares),
    pairAbove40pct,
    regionsMin: campaigns.length === 0 ? 0 : Math.min(...regionCounts),
    regionsPerCampaign: histogram(regionCounts),
    warsByRegion: Object.fromEntries(
      Object.entries(regions).sort((a, b) => b[1] - a[1]),
    ),
    pairs: Object.fromEntries(
      Object.entries(pairs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30),
    ),
    coups: coups.length,
    coupsByRegime: histogramOf(coups.map((k) => k.regime)),
    fragileCoupShare: coups.length === 0 ? 1 : fragile / coups.length,
    defaults: defaults.length,
    otherDefaults,
  };
}

// One line per campaign: wars, shots, politics, prices, technology.
function campaignsCsv(campaigns: Campaign[]): string {
  const header = [
    "seed",
    "new_wars",
    "wars_without_casus_belli",
    "wars",
    "nuclear_shots",
    "shots",
    "revolutions",
    "crisis_by_10_years",
    "rus_regime_10y",
    "tur_regime_10y",
    "coups",
    "unrest_starts",
    "defaults",
    "price_low",
    "price_high",
    "tier1_gbr",
    "tier1_deu",
    "tier1_fra",
    "events_journaled",
    "bloc_decisions",
    "wall_s",
  ];
  const rows = campaigns.map((c) => {
    const [low, high] = Object.values(c.final.priceRange).reduce(
      ([lo, hi], [a, b]) => [Math.min(lo, a), Math.max(hi, b)],
      [Infinity, -Infinity],
    );
    const politics = Object.values(c.politics);
    return [
      c.seed,
      c.delivery.newWars.length,
      c.delivery.newWars.filter((w) => w.casusBelli === "none").length,
      c.delivery.newWars
        .map((w) => `${w.by}>${w.target}@${w.date.slice(0, 7)}:${w.casusBelli}`)
        .join(" "),
      c.delivery.nuclearShots.length,
      c.delivery.nuclearShots
        .map((s) => `${s.by}>${s.target}@${s.date.slice(0, 7)}:${s.threat}`)
        .join(" "),
      c.delivery.revolutions.join(" "),
      c.delivery.crisisBy10Years ? 1 : 0,
      c.delivery.regimeAt10Years.RUS ?? "",
      c.delivery.regimeAt10Years.TUR ?? "",
      politics.reduce((s, p) => s + p.coups, 0),
      politics.reduce((s, p) => s + p.unrestStarts, 0),
      c.defaults.join(" "),
      low.toFixed(3),
      high.toFixed(3),
      c.delivery.tier1CompleteAt.GBR ?? "",
      c.delivery.tier1CompleteAt.DEU ?? "",
      c.delivery.tier1CompleteAt.FRA ?? "",
      c.delivery.eventsOccurred,
      c.delivery.blocDecisions,
      Math.round(c.wallMs / 1000),
    ].join(",");
  });
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

function histogramOf(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runs = Number(option(args, "runs", "100"));
  const years = Number(option(args, "years", "50"));
  const parallel = Number(option(args, "parallel", "5"));
  const seed = Number(option(args, "seed", "1"));
  const scenario = option(args, "scenario", "europe-10");
  const out = path.resolve(
    option(args, "out", path.join(HERE, "out", "delivery")),
  );
  const core = args.includes("--core");
  fs.mkdirSync(out, { recursive: true });
  const seeds = Array.from({ length: runs }, (_, i) => seed + i);
  if (!args.includes("--aggregate")) {
    const started = Date.now();
    await runAll(seeds, parallel, years, out, core, scenario);
    process.stdout.write(
      `all done in ${Math.round((Date.now() - started) / 1000)} s\n`,
    );
  }
  const campaigns: Campaign[] = seeds
    .map((s) => path.join(out, `campaign-${s}.json`))
    .filter((f) => fs.existsSync(f))
    .map((f) => JSON.parse(fs.readFileSync(f, "utf8")) as Campaign);
  const summary = aggregate(campaigns);
  fs.writeFileSync(
    path.join(out, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  // --report dir: the summary and one line per campaign, for the reports.
  const report = option(args, "report", "");
  if (report !== "") {
    fs.mkdirSync(report, { recursive: true });
    fs.writeFileSync(
      path.join(report, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(report, "campaigns.csv"),
      campaignsCsv(campaigns),
    );
  }
  process.stdout.write(
    `${JSON.stringify({ criteria: summary.criteria, world: summary.world, loop: summary.loop, wars: summary.wars, nuclear: { campaignsWithShots: summary.nuclear.campaignsWithShots, shots: summary.nuclear.shots, byThreat: summary.nuclear.byThreat }, politics: summary.politics, prices: summary.prices, technology: summary.technology }, null, 1)}\n`,
  );
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("delivery.ts")) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
    process.exit(1);
  });
}
