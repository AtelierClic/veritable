import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadScenarioPackFrom } from "../../../src/veritable/adapters/scenarioPackFrom";
import { createDataSource } from "../../../src/veritable/data/DataSource";
import { fsDataFiles } from "../../../src/veritable/data/files.fs";
import { CampaignResult, runCampaign, seriesCsv } from "./campaign";

// The delivery test of the J4 as files one can read without the game:
//
//   npx tsx tools/veritable/headless/reportJ4.ts --out docs/veritable/reports/J4
//
// Ten years x ten seeds on the simulation alone (the fronts do not change
// the politics, except the suspension of elections at war at home, which
// the Ukrainian war of the scenario exercises). Criteria:
//   - at least one alternation in seven nations out of ten (a nation counts
//     when it saw one in at least one campaign; the strict per-campaign
//     count is reported next to it);
//   - at least one political crisis (unrest, coup, detected fraud,
//     revolution) in half of the campaigns;
//   - no nation in a permanent junta without cause: a junta either returns
//     to elections within the ten years or is explained by a coup or a war.
// Writes one CSV per seed, politics.json (the counters of every nation of
// every seed) and summary.json.

const HERE = path.dirname(fileURLToPath(import.meta.url));

function option(args: string[], name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const out = path.resolve(
    option(args, "out", path.join(HERE, "out/reportJ4")),
  );
  const seed0 = Number(option(args, "seed", "42"));
  const runs = Number(option(args, "runs", "10"));
  const years = Number(option(args, "years", "10"));
  fs.mkdirSync(out, { recursive: true });
  const source = createDataSource(fsDataFiles());
  const pack = await loadScenarioPackFrom(source, "europe-10");
  const config = source.config();

  const results: CampaignResult[] = [];
  for (let i = 0; i < runs; i++) {
    const seed = seed0 + i;
    const result = runCampaign({ pack, config, seed, years });
    results.push(result);
    fs.writeFileSync(path.join(out, `seed-${seed}.csv`), seriesCsv(result));
    const crises = Object.values(result.politics).map(
      (p) => p.unrestStarts + p.coupAttempts + p.fraudDetected + p.revolutions,
    );
    console.log(
      `seed ${seed}: ${result.wallMs} ms; alternations ${Object.values(result.politics).reduce((s, p) => s + p.alternations, 0)}; crises ${crises.reduce((a, b) => a + b, 0)}; regimes ${Object.entries(
        result.politics,
      )
        .filter(([, p]) => p.regimes.length > 1)
        .map(([id, p]) => `${id}:${p.regimes.join(">")}`)
        .join(" ")}`,
    );
  }

  const nations = pack.scenario.nations;
  const alternationNations = nations.filter((id) =>
    results.some((r) => r.politics[id].alternations > 0),
  );
  const perCampaignAlternationNations = results.map(
    (r) => nations.filter((id) => r.politics[id].alternations > 0).length,
  );
  const crisisCampaigns = results.filter((r) =>
    Object.values(r.politics).some(
      (p) =>
        p.unrestStarts + p.coupAttempts + p.fraudDetected + p.revolutions > 0,
    ),
  ).length;
  // A junta at the end of a campaign is explained by a coup in that campaign
  // (there is no junta in the scenario's data) or by a war it is in.
  const unexplainedJuntas = results.flatMap((r) =>
    nations
      .filter(
        (id) =>
          r.politics[id].finalRegime === "junta" &&
          r.politics[id].coups === 0 &&
          !r.series[r.series.length - 1].atWar[id],
      )
      .map((id) => `${id}@seed${r.seed}`),
  );
  const juntaMonths = results.flatMap((r) =>
    nations
      .filter((id) => r.politics[id].juntaMonths > 0)
      .map((id) => ({
        nation: id,
        seed: r.seed,
        months: r.politics[id].juntaMonths,
      })),
  );
  // J5 targets of the coup formula: juntas in Russia and Turkey in at most
  // two seeds each, no coup in a democracy that stayed stable.
  const juntaSeeds = Object.fromEntries(
    nations.map((id) => [
      id,
      {
        ever: results.filter((r) => r.politics[id].juntaMonths > 0).length,
        atEnd: results.filter((r) => r.politics[id].finalRegime === "junta")
          .length,
      },
    ]),
  );
  const coupsInStableDemocracies = results.flatMap((r) =>
    nations.flatMap((id) =>
      r.politics[id].coupsInStableDemocracy.map(
        (date) => `${id}@${date}@seed${r.seed}`,
      ),
    ),
  );
  const summary = {
    seeds: results.map((r) => r.seed),
    years,
    alternationNations,
    alternationNationsCount: alternationNations.length,
    perCampaignAlternationNations,
    crisisCampaigns,
    campaigns: results.length,
    unexplainedJuntas,
    juntaMonths,
    juntaSeeds,
    coupsInStableDemocracies,
    coups: {
      successful: results.reduce(
        (s, r) => s + nations.reduce((t, id) => t + r.politics[id].coups, 0),
        0,
      ),
      attempts: results.reduce(
        (s, r) =>
          s + nations.reduce((t, id) => t + r.politics[id].coupAttempts, 0),
        0,
      ),
    },
    criteria: {
      russiaTurkeyJuntaInAtMostTwoSeeds:
        juntaSeeds.RUS.ever <= 2 && juntaSeeds.TUR.ever <= 2,
      noCoupInAStableDemocracy: coupsInStableDemocracies.length === 0,
      alternationInSevenNations: alternationNations.length >= 7,
      crisisInHalfOfCampaigns: crisisCampaigns * 2 >= results.length,
      noUnexplainedJunta: unexplainedJuntas.length === 0,
    },
    events: results.map((r) => r.events),
    meanWallMs: Math.round(
      results.reduce((s, r) => s + r.wallMs, 0) / results.length,
    ),
  };
  fs.writeFileSync(
    path.join(out, "politics.json"),
    JSON.stringify(
      results.map((r) => ({
        seed: r.seed,
        politics: r.politics,
        wars: r.wars,
      })),
      null,
      2,
    ) + "\n",
  );
  fs.writeFileSync(
    path.join(out, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(summary.criteria),
    `alternation nations: ${alternationNations.join(",")}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
