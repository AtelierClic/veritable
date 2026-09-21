import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadScenarioPackFrom } from "../../../src/veritable/adapters/scenarioPackFrom";
import { createDataSource } from "../../../src/veritable/data/DataSource";
import { fsDataFiles } from "../../../src/veritable/data/files.fs";
import { CampaignResult, parseShock, runCampaign, seriesCsv } from "./campaign";

// Shock against control, as files one can read without the game:
//
//   npx tsx tools/veritable/headless/report.ts --scenario europe-10 --years 20 \
//       --seed 42 --shock cut-gas-exports:RUS@2028-01 --focus DEU \
//       --out docs/veritable/reports/J2
//
// Writes control.csv, shock.csv and shock-vs-control.svg (four panels).

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
  shock: CampaignResult,
  subtitle: string,
): string {
  const W = 560;
  const H = 190;
  const pad = { left: 56, right: 12, top: 30, bottom: 26 };
  const dates = control.series.map((r) => r.date);
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * 2 + 44}" font-family="sans-serif" font-size="11">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<text x="12" y="18" font-size="14" font-weight="bold">Véritable J2 — ${subtitle}</text>`,
    `<text x="12" y="34" fill="#555">gris : témoin · rouge : choc · même graine</text>`,
  );
  panels.forEach((panel, index) => {
    const ox = (index % 2) * W;
    const oy = 44 + Math.floor(index / 2) * H;
    const a = panel.pick(control);
    const b = panel.pick(shock);
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
    for (let i = 0; i < dates.length; i += 48) {
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scenarioId = option(args, "scenario", "europe-10");
  const years = Number(option(args, "years", "20"));
  const seed = Number(option(args, "seed", "42"));
  const shock = parseShock(
    option(args, "shock", "cut-gas-exports:RUS@2028-01"),
  );
  const focus = option(args, "focus", "DEU");
  const out = path.resolve(option(args, "out", path.join(HERE, "out/report")));

  const source = createDataSource(fsDataFiles());
  const pack = await loadScenarioPackFrom(source, scenarioId);
  const config = source.config();
  const control = runCampaign({ pack, config, seed, years });
  const cut = runCampaign({ pack, config, seed, years, shock });

  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "control.csv"), seriesCsv(control));
  fs.writeFileSync(path.join(out, "shock.csv"), seriesCsv(cut));
  const percent = (v: number) => `${(v * 100).toFixed(0)} %`;
  fs.writeFileSync(
    path.join(out, "shock-vs-control.svg"),
    chart(
      [
        {
          title: "Prix mondial du gaz (× prix de base)",
          pick: (r) => r.series.map((row) => row.prices.gas),
          format: (v) => v.toFixed(2),
        },
        {
          title: `Couverture en gaz, ${focus}`,
          pick: (r) => r.series.map((row) => row.gasCoverage[focus]),
          format: percent,
        },
        {
          title: `PIB, ${focus} (Md$)`,
          pick: (r) => r.series.map((row) => row.gdp[focus] / 1e9),
          format: (v) => v.toFixed(0),
        },
        {
          title: `Stabilité, ${focus}`,
          pick: (r) => r.series.map((row) => row.stability[focus]),
          format: (v) => v.toFixed(2),
        },
      ],
      control,
      cut,
      `${shock.kind}:${shock.nation}@${shock.month}, ${scenarioId}, graine ${seed}`,
    ),
  );
  console.log(
    `wrote control.csv, shock.csv and shock-vs-control.svg in ${out}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
