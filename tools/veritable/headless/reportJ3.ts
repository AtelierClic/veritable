import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadScenarioPackFrom } from "../../../src/veritable/adapters/scenarioPackFrom";
import { createDataSource } from "../../../src/veritable/data/DataSource";
import { fsDataFiles } from "../../../src/veritable/data/files.fs";
import {
  CampaignResult,
  parseScript,
  parseShock,
  runCampaign,
  seriesCsv,
} from "./campaign";
import { coreDriver } from "./coreDriver";

// The four delivery tests of the J3 as files one can read without the game:
//
//   npx tsx tools/veritable/headless/reportJ3.ts --out docs/veritable/reports/J3
//
// 1. EU embargo on Russian gas and oil (simulation alone, like the J2 report)
// 2. France attacks Spain without casus belli (core)
// 3. The United Kingdom blockades Norway (core)
// 4. Italy is refused a landing in Spain (core)
// Each writes <name>-control.csv, <name>.csv and <name>.svg; summary.json
// holds the figures of the criteria.

const HERE = path.dirname(fileURLToPath(import.meta.url));

function option(args: string[], name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}

interface Panel {
  title: string;
  pick: (result: CampaignResult) => number[];
  format: (v: number) => string;
}

function chart(
  panels: Panel[],
  control: CampaignResult,
  run: CampaignResult,
  title: string,
): string {
  const W = 560;
  const H = 190;
  const pad = { left: 56, right: 12, top: 30, bottom: 26 };
  const dates = control.series.map((r) => r.date);
  const rows = Math.ceil(panels.length / 2);
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * rows + 44}" font-family="sans-serif" font-size="11">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<text x="12" y="18" font-size="14" font-weight="bold">Véritable J3 — ${title}</text>`,
    `<text x="12" y="34" fill="#555">gris : témoin · rouge : scénario · même graine</text>`,
  );
  panels.forEach((panel, index) => {
    const ox = (index % 2) * W;
    const oy = 44 + Math.floor(index / 2) * H;
    const a = panel.pick(control);
    const b = panel.pick(run);
    const min = Math.min(...a, ...b);
    const max = Math.max(...a, ...b);
    const span = max - min || 1;
    const x = (i: number) =>
      ox + pad.left + (i / (dates.length - 1)) * (W - pad.left - pad.right);
    const y = (v: number) =>
      oy + pad.top + (1 - (v - min) / span) * (H - pad.top - pad.bottom);
    const line = (values: number[]) =>
      values
        .map(
          (v, i) =>
            `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`,
        )
        .join("");
    out.push(
      `<text x="${ox + pad.left}" y="${oy + 18}" font-weight="bold">${panel.title}</text>`,
      `<rect x="${ox + pad.left}" y="${oy + pad.top}" width="${W - pad.left - pad.right}" height="${H - pad.top - pad.bottom}" fill="none" stroke="#ccc"/>`,
      `<text x="${ox + pad.left - 4}" y="${y(max) + 4}" text-anchor="end">${panel.format(max)}</text>`,
      `<text x="${ox + pad.left - 4}" y="${y(min) + 4}" text-anchor="end">${panel.format(min)}</text>`,
    );
    for (let i = 0; i < dates.length; i += 12) {
      out.push(
        `<text x="${x(i)}" y="${oy + H - 8}" text-anchor="middle" fill="#555">${dates[i].slice(0, 4)}</text>`,
      );
    }
    out.push(
      `<path d="${line(a)}" fill="none" stroke="#888" stroke-width="1.5"/>`,
      `<path d="${line(b)}" fill="none" stroke="#c0392b" stroke-width="1.5"/>`,
    );
  });
  out.push("</svg>");
  return out.join("\n") + "\n";
}

const percent = (v: number) => `${(v * 100).toFixed(0)} %`;
const at = (r: CampaignResult, date: string) =>
  r.series.find((row) => row.date === date)!;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const out = path.resolve(
    option(args, "out", path.join(HERE, "out/reportJ3")),
  );
  const seed = Number(option(args, "seed", "42"));
  // --only eu-embargo,war-fra-esp: the tests to (re)play; all by default.
  const only = option(args, "only", "");
  const wanted = (name: string) =>
    only === "" || only.split(",").includes(name);
  fs.mkdirSync(out, { recursive: true });
  const source = createDataSource(fsDataFiles());
  const pack = await loadScenarioPackFrom(source, "europe-10");
  const config = structuredClone(source.config());
  config.economy.growth.noiseMonthlySd = 0;
  config.economy.rowSupplyNoise.monthlySd = 0;
  const script = (name: string) =>
    parseScript(
      JSON.parse(
        fs.readFileSync(path.join(HERE, "scripts", `${name}.json`), "utf8"),
      ),
    );
  const write = (
    name: string,
    control: CampaignResult,
    run: CampaignResult,
    panels: Panel[],
    title: string,
  ) => {
    fs.writeFileSync(path.join(out, `${name}-control.csv`), seriesCsv(control));
    fs.writeFileSync(path.join(out, `${name}.csv`), seriesCsv(run));
    fs.writeFileSync(
      path.join(out, `${name}.svg`),
      chart(panels, control, run, title),
    );
    console.log(`wrote ${name}`);
  };
  const summary: Record<string, unknown> = {};

  // 1. EU embargo (simulation alone).
  if (wanted("eu-embargo")) {
    const shock = parseShock("eu-embargo:RUS@2027-01");
    const control = runCampaign({ pack, config, seed, years: 4 });
    const run = runCampaign({ pack, config, seed, years: 4, shock });
    const year1 = run.series.filter(
      (r) => r.date > "2027-01-01" && r.date <= "2028-01-01",
    );
    summary["eu-embargo"] = {
      gasImportPricePeakYear1:
        Math.max(...year1.map((r) => r.importPrices.gas)) /
        at(run, "2027-01-01").importPrices.gas,
      gasWorldPricePeakYear1:
        Math.max(...year1.map((r) => r.prices.gas)) /
        at(run, "2027-01-01").prices.gas,
      russianGdpAt2Years:
        at(run, "2029-01-01").gdp.RUS / at(control, "2029-01-01").gdp.RUS,
    };
    write(
      "eu-embargo",
      control,
      run,
      [
        {
          title: "Prix du gaz à l'importation (× base)",
          pick: (r) => r.series.map((row) => row.importPrices.gas),
          format: (v) => v.toFixed(2),
        },
        {
          title: "Prix mondial du gaz (× base)",
          pick: (r) => r.series.map((row) => row.prices.gas),
          format: (v) => v.toFixed(2),
        },
        {
          title: "PIB de la Russie (Md$)",
          pick: (r) => r.series.map((row) => row.gdp.RUS / 1e9),
          format: (v) => v.toFixed(0),
        },
        {
          title: "Couverture en gaz, Allemagne",
          pick: (r) => r.series.map((row) => row.gasCoverage.DEU),
          format: percent,
        },
      ],
      "embargo de l'UE sur le gaz et le pétrole russes, janvier 2027",
    );
  }

  // 2. France attacks Spain (core).
  if (wanted("war-fra-esp")) {
    const control = runCampaign({
      pack,
      config,
      seed,
      years: 3,
      player: "FRA",
      driver: await coreDriver(pack, config, seed, "FRA", false),
    });
    const run = runCampaign({
      pack,
      config,
      seed,
      years: 3,
      player: "FRA",
      script: script("war-fra-esp"),
      driver: await coreDriver(pack, config, seed, "FRA", false),
    });
    const start = at(run, "2027-01-01");
    const end = run.series[run.series.length - 1];
    const netTiles = end.tiles.FRA - start.tiles.FRA;
    summary["war-fra-esp"] = {
      sanctionersAt6Months: at(run, "2027-07-01").sanctionsAgainst.FRA,
      warsAndJoins: run.wars,
      netTilesAt3Years: netTiles,
      tileValueUsd: (start.gdp.ESP / start.tiles.ESP) * Math.max(0, netTiles),
      gdpLossUsd:
        control.series[control.series.length - 1].gdp.FRA - end.gdp.FRA,
      frenchGdpRatio:
        end.gdp.FRA / control.series[control.series.length - 1].gdp.FRA,
      // The aggressor's stability must not recover while sanctioned:
      // at three years, at most the control's minus 0.08.
      frenchStabilityAt3Years: end.stability.FRA,
      controlStabilityAt3Years:
        control.series[control.series.length - 1].stability.FRA,
    };
    write(
      "war-fra-esp",
      control,
      run,
      [
        {
          title: "PIB de la France (Md$)",
          pick: (r) => r.series.map((row) => row.gdp.FRA / 1e9),
          format: (v) => v.toFixed(0),
        },
        {
          title: "Tuiles de la France",
          pick: (r) => r.series.map((row) => row.tiles.FRA),
          format: (v) => v.toFixed(0),
        },
        {
          title: "Nations qui sanctionnent la France",
          pick: (r) => r.series.map((row) => row.sanctionsAgainst.FRA),
          format: (v) => v.toFixed(0),
        },
        {
          title: "Stabilité de la France",
          pick: (r) => r.series.map((row) => row.stability.FRA),
          format: (v) => v.toFixed(2),
        },
      ],
      "la France attaque l'Espagne sans casus belli, janvier 2027",
    );
  }

  // 3. The United Kingdom blockades Norway (core).
  if (wanted("blockade-gbr-nor")) {
    const control = runCampaign({
      pack,
      config,
      seed,
      years: 2,
      player: "GBR",
      driver: await coreDriver(pack, config, seed, "GBR", false),
    });
    const run = runCampaign({
      pack,
      config,
      seed,
      years: 2,
      player: "GBR",
      script: script("blockade-gbr-nor"),
      driver: await coreDriver(pack, config, seed, "GBR", false),
    });
    summary["blockade-gbr-nor"] = {
      norwegianBlockadeAt6Months: at(run, "2027-07-01").blockade.NOR,
      norwegianMaritimeTradeRatioAt6Months:
        at(run, "2027-07-01").maritimeTrade.NOR /
        at(control, "2027-07-01").maritimeTrade.NOR,
    };
    write(
      "blockade-gbr-nor",
      control,
      run,
      [
        {
          title: "Commerce maritime de la Norvège (Md$/an)",
          pick: (r) => r.series.map((row) => row.maritimeTrade.NOR / 1e9),
          format: (v) => v.toFixed(0),
        },
        {
          title: "Blocus subi par la Norvège",
          pick: (r) => r.series.map((row) => row.blockade.NOR),
          format: percent,
        },
        {
          title: "Indice de pénurie, Norvège",
          pick: (r) => r.series.map((row) => row.shortage.NOR),
          format: (v) => v.toFixed(3),
        },
        {
          title: "PIB de la Norvège (Md$)",
          pick: (r) => r.series.map((row) => row.gdp.NOR / 1e9),
          format: (v) => v.toFixed(0),
        },
      ],
      "blocus de la Norvège par le Royaume-Uni, janvier 2027",
    );
  }

  // 4. Italy is refused a landing in Spain (core).
  if (wanted("landing-ita-esp")) {
    const run = runCampaign({
      pack,
      config,
      seed,
      years: 1,
      player: "ITA",
      script: script("landing-ita-esp"),
      driver: await coreDriver(pack, config, seed, "ITA", false),
    });
    summary["landing-ita-esp"] = {
      landingsRefused: run.events["landing-refused"] ?? 0,
      landings: run.events.landing ?? 0,
    };
    fs.writeFileSync(path.join(out, "landing-ita-esp.csv"), seriesCsv(run));
    console.log("wrote landing-ita-esp");
  }

  fs.writeFileSync(
    path.join(out, "summary.json"),
    JSON.stringify({ seed, ...summary }, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
