import fs from "fs";
import path from "path";
import { build } from "./build";
import { buildLeaders, writeLeaders } from "./leaders";
import { buildRelations, fetchVoeten } from "./relations";
import {
  fetchAll,
  fetchImf,
  fetchWorldBank,
  REPO_ROOT,
  WORLD_BANK_INDICATORS,
  WorldBankKey,
} from "./sources";
import { fetchWikidata, relockWikidata } from "./wikidata";
import { fetchWikidataWorld } from "./wikidataWorld";
import { fetchImfFiscal, fetchWorld } from "./world";

// Open sources -> data/veritable/. Replayable:
//
//   npm run veritable:ingest -- fetch --scenario europe-10
//       downloads World Bank and OWID data, rewrites the committed snapshots
//       and sources.lock.json (sha256).
//   npm run veritable:ingest -- fetch-world --scenario world-2026
//       every nation of the world (J6): World Bank CSV snapshots, IMF cache,
//       V-Dem regimes (OWID), Natural Earth capitals; see world.ts
//
//   npm run veritable:ingest -- fetch-imf-fiscal --scenario world-2026
//       interest paid and inflation (J6b, the debt of the first day), IMF
//       DataMapper, cache outside git; see world.ts
//
//   npm run veritable:ingest -- fetch-imf --scenario europe-10
//       downloads the IMF WEO debt series into the cache (outside git) and
//       records its sha256 in sources.lock.json.
//   npm run veritable:ingest -- fetch-wikidata --scenario europe-10 [--only NOR]
//       heads of state and government, main parties (parties.json), their
//       leaders and ideologies, at the start date of the scenario; committed
//       snapshots, sha256 in the lock (written after every nation).
//   npm run veritable:ingest -- relock-wikidata --scenario europe-10 --only FRA,DEU
//       the sha256 of snapshots a cut-off run wrote without its lock.
//   npm run veritable:ingest -- build --scenario europe-10
//       rebuilds the nation sheets, row.json and the index-good prices from
//       the snapshots, offline, after checking every sha256.
//   npm run veritable:ingest -- fetch-voeten --scenario world-2026
//   npm run veritable:ingest -- build-relations --scenario world-2026
//       relations of the first day (J6b), see relations.ts.
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
    case "fetch-world":
      return fetchWorld(scenario.nations);
    case "fetch-imf-fiscal":
      return fetchImfFiscal(scenario.nations);
    case "fetch-wikidata-world": {
      const only = args.includes("--only")
        ? option(args, "only").split(",")
        : scenario.nations;
      return fetchWikidataWorld(only, scenario.startDate);
    }
    case "fetch-wikidata": {
      // --only FRA,DEU: those nations only, the others' snapshots untouched.
      const only = option(args, "only")?.split(",");
      return fetchWikidata(
        only === undefined
          ? scenario.nations
          : scenario.nations.filter((n: string) => only.includes(n)),
        scenario.startDate,
      );
    }
    case "relock-wikidata":
      return relockWikidata(
        option(args, "only")?.split(",") ?? scenario.nations,
      );
    case "fetch-wb": {
      // One World Bank indicator, the others untouched.
      const key = option(args, "key") as WorldBankKey;
      if (!(key in WORLD_BANK_INDICATORS))
        throw new Error(`unknown key ${key}`);
      return fetchWorldBank(key, scenario.nations);
    }
    case "build":
      return build(scenarioId);
    case "fetch-voeten":
      return fetchVoeten();
    case "build-relations":
      return buildRelations(scenarioId);
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
          parodyNations: estimates.parodyNations,
          headOverrides: estimates.headOverrides,
          partyLeaderOverrides: estimates.partyLeaderOverrides,
        },
        i18n,
      );
      writeLeaders(files);
      // Names of people and parties no longer in the data of the nations
      // built (J6: a rebuild after a correction of Wikidata).
      const actorIds = new Set(
        Object.values(files).flatMap((f) => f.actors.map((a) => a.id)),
      );
      const partyIds = new Set(
        Object.values(files).flatMap((f) => f.parties.map((p) => p.id)),
      );
      const built = new Set(Object.keys(files).map((n) => n.toLowerCase()));
      for (const key of Object.keys(i18n)) {
        const actor = /^leader\.([a-z0-9]{3})-(.+)\.(parody|fictional)$/.exec(
          key,
        );
        if (actor !== null && built.has(actor[1])) {
          if (!actorIds.has(`${actor[1]}-${actor[2]}`)) delete i18n[key];
        }
        const party = /^party\.([a-z0-9]{3})-(.+)$/.exec(key);
        if (party !== null && built.has(party[1])) {
          if (!partyIds.has(`${party[1]}-${party[2]}`)) delete i18n[key];
        }
      }
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
