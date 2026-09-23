import fs from "fs";
import path from "path";
import { build } from "./build";
import { buildLeaders, writeLeaders } from "./leaders";
import {
  fetchAll,
  fetchImf,
  fetchWorldBank,
  REPO_ROOT,
  WORLD_BANK_INDICATORS,
  WorldBankKey,
} from "./sources";
import { fetchWikidata } from "./wikidata";

// Open sources -> data/veritable/. Replayable:
//
//   npm run veritable:ingest -- fetch --scenario europe-10
//       downloads World Bank and OWID data, rewrites the committed snapshots
//       and sources.lock.json (sha256).
//   npm run veritable:ingest -- fetch-imf --scenario europe-10
//       downloads the IMF WEO debt series into the cache (outside git) and
//       records its sha256 in sources.lock.json.
//   npm run veritable:ingest -- fetch-wikidata --scenario europe-10
//       heads of state and government, main parties (parties.json), their
//       leaders and ideologies; committed snapshots, sha256 in the lock.
//   npm run veritable:ingest -- build --scenario europe-10
//       rebuilds the nation sheets, row.json and the index-good prices from
//       the snapshots, offline, after checking every sha256.
//   npm run veritable:ingest -- build-leaders --scenario europe-10
//       rebuilds data/veritable/leaders/<iso3>.json from the Wikidata
//       snapshots, the ideology table, parties.json and the hand-written
//       traits of estimates.json; adds the party names and the fictional
//       leader names to i18n/fr.json and lists the missing parody names.

function option(args: string[], name: string): string {
  const i = args.indexOf(`--${name}`);
  if (i < 0 || args[i + 1] === undefined) throw new Error(`missing --${name}`);
  return args[i + 1];
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const scenarioId = option(args, "scenario");
  const scenario = JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "data/veritable/scenarios", `${scenarioId}.json`),
      "utf8",
    ),
  );
  switch (command) {
    case "fetch":
      return fetchAll(scenario.nations);
    case "fetch-imf":
      return fetchImf(scenario.nations);
    case "fetch-wikidata":
      return fetchWikidata(scenario.nations);
    case "fetch-wb": {
      // One World Bank indicator, the others untouched.
      const key = option(args, "key") as WorldBankKey;
      if (!(key in WORLD_BANK_INDICATORS))
        throw new Error(`unknown key ${key}`);
      return fetchWorldBank(key, scenario.nations);
    }
    case "build":
      return build(scenarioId);
    case "build-leaders": {
      const estimates = JSON.parse(
        fs.readFileSync(
          path.join(REPO_ROOT, "tools/veritable/ingest/estimates.json"),
          "utf8",
        ),
      );
      const i18nFile = path.join(REPO_ROOT, "data/veritable/i18n/fr.json");
      const i18n = JSON.parse(fs.readFileSync(i18nFile, "utf8")) as Record<
        string,
        string
      >;
      const lock = JSON.parse(
        fs.readFileSync(
          path.join(REPO_ROOT, "tools/veritable/ingest/sources.lock.json"),
          "utf8",
        ),
      );
      const { files, missingParody, warnings } = buildLeaders(
        scenario.nations,
        lock,
        {
          asOf: estimates.asOf,
          leaderTraits: estimates.leaderTraits ?? {},
          partyIdeologies: estimates.partyIdeologies ?? {},
        },
        i18n,
      );
      writeLeaders(files);
      fs.writeFileSync(i18nFile, JSON.stringify(i18n, null, 2) + "\n");
      for (const w of warnings) console.log(`warning: ${w}`);
      for (const m of missingParody) console.log(`missing parody name: ${m}`);
      console.log(`leaders written for ${Object.keys(files).join(", ")}`);
      return;
    }
    default:
      throw new Error(
        "usage: veritable:ingest -- fetch|fetch-imf|fetch-wikidata|fetch-wb --key <k>|build|build-leaders --scenario <id>",
      );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
