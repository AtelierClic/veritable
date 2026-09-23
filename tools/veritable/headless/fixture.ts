import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadScenarioPackFrom } from "../../../src/veritable/adapters/scenarioPackFrom";
import { createDataSource } from "../../../src/veritable/data/DataSource";
import { fsDataFiles } from "../../../src/veritable/data/files.fs";
import { parseScript, ScriptEntry } from "./campaign";
import { coreDriver } from "./coreDriver";

// Writes a REAL save of the current build, on the core and the real map, for
// the migration tests of the next save version:
//
//   npx tsx tools/veritable/headless/fixture.ts --scenario europe-10 \
//     --player FRA --script war-fra-esp --from 2027-01-01 --days 100 \
//     --out src/veritable/save/fixtures/j3-europe-10.vsave
//
// The script's commands are replayed at their dates; the campaign stops
// `days` days after `from` (or after the first day) and the file is written.

const HERE = path.dirname(fileURLToPath(import.meta.url));

function option(args: string[], name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scenarioId = option(args, "scenario", "europe-10");
  const player = option(args, "player", "FRA");
  const scriptName = option(args, "script", "");
  const from = option(args, "from", "");
  const days = Number(option(args, "days", "60"));
  const seed = Number(option(args, "seed", "42"));
  const out = option(args, "out", "");
  if (out === "") throw new Error("--out is required");

  const source = createDataSource(fsDataFiles());
  const pack = await loadScenarioPackFrom(source, scenarioId);
  const config = source.config();
  const script: ScriptEntry[] =
    scriptName === ""
      ? []
      : parseScript(
          JSON.parse(
            fs.readFileSync(
              path.join(HERE, "scripts", `${scriptName}.json`),
              "utf8",
            ),
          ),
        );
  const driver = await coreDriver(pack, config, seed, player, false);
  let remaining = from === "" ? days : Number.POSITIVE_INFINITY;
  for (;;) {
    const date = driver.read().date;
    for (const entry of script) {
      if (entry.date !== date) continue;
      if (entry.command !== undefined) driver.apply(entry.command);
      if (entry.macro !== undefined) {
        const view = driver.read();
        for (const division of view.military.nations[player].divisions) {
          driver.apply({
            type: "assign-division",
            division: division.id,
            front: entry.macro.front,
            segment: null,
          });
          driver.apply({
            type: "set-posture",
            division: division.id,
            posture: entry.macro.posture,
          });
        }
      }
    }
    if (from !== "" && date >= from && remaining === Number.POSITIVE_INFINITY) {
      remaining = days;
    }
    if (remaining <= 0) break;
    driver.advanceDay();
    remaining -= 1;
  }
  const bytes = driver.snapshot();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, bytes);
  const view = driver.read();
  console.log(
    `${out}: ${bytes.length} bytes, ${view.date}, wars ${view.diplomacy.wars.map((w) => w.id).join(",")}, sanctions ${view.diplomacy.sanctions.length}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
