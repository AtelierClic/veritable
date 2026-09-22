import fs from "fs";
import path from "path";
import { build } from "./build";
import {
  fetchAll,
  fetchImf,
  fetchWorldBank,
  REPO_ROOT,
  WORLD_BANK_INDICATORS,
  WorldBankKey,
} from "./sources";

// Open sources -> data/veritable/. Replayable:
//
//   npm run veritable:ingest -- fetch --scenario europe-10
//       downloads World Bank and OWID data, rewrites the committed snapshots
//       and sources.lock.json (sha256).
//   npm run veritable:ingest -- fetch-imf --scenario europe-10
//       downloads the IMF WEO debt series into the cache (outside git) and
//       records its sha256 in sources.lock.json.
//   npm run veritable:ingest -- build --scenario europe-10
//       rebuilds the nation sheets, row.json and the index-good prices from
//       the snapshots, offline, after checking every sha256.

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
    case "fetch-wb": {
      // One World Bank indicator, the others untouched.
      const key = option(args, "key") as WorldBankKey;
      if (!(key in WORLD_BANK_INDICATORS))
        throw new Error(`unknown key ${key}`);
      return fetchWorldBank(key, scenario.nations);
    }
    case "build":
      return build(scenarioId);
    default:
      throw new Error(
        "usage: veritable:ingest -- fetch|fetch-imf|fetch-wb --key <k>|build --scenario <id>",
      );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
