import fs from "fs";
import path from "path";
import { loadScenarioPackFrom } from "../../../src/veritable/adapters/scenarioPackFrom";
import { createDataSource } from "../../../src/veritable/data/DataSource";
import { fsDataFiles } from "../../../src/veritable/data/files.fs";
import { runCampaign, simDriver } from "./campaign";
import { coreDriver } from "./coreDriver";

// One child process of the delivery (delivery.ts): runs its seeds one after
// the other and writes one JSON per campaign (without the monthly series),
// as soon as it ends, whole: a temporary file renamed (J7c: a series cut
// short by a power cut goes on with --resume).
//   node --import tsx deliveryWorker.ts --seeds 1,6,11 --years 50 --out dir [--core]

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seeds = (option(args, "seeds") ?? "")
    .split(",")
    .filter((s) => s !== "")
    .map(Number);
  const years = Number(option(args, "years") ?? 50);
  const out = path.resolve(option(args, "out") ?? ".");
  const scenarioId = option(args, "scenario") ?? "europe-10";
  const core = args.includes("--core");
  const source = createDataSource(fsDataFiles());
  const pack = await loadScenarioPackFrom(source, scenarioId);
  const config = source.config();
  const player = pack.scenario.playerDefault;
  for (const seed of seeds) {
    const driver = core
      ? await coreDriver(pack, config, seed, player, true)
      : simDriver(pack, config, seed, player, true);
    const result = runCampaign({ pack, config, seed, years, driver });
    const { series, ...slim } = result;
    const file = path.join(out, `campaign-${seed}.json`);
    const text = JSON.stringify(
      {
        ...slim,
        // Prices by year (the bounds of the delivery), and debt at the end.
        yearlyPrices: series
          .filter((row) => row.date.endsWith("-01-01"))
          .map((row) => ({ date: row.date, prices: row.prices })),
      },
      null,
      1,
    );
    // On disk before the rename: a power cut leaves the old name or the
    // whole file, never half of it.
    const fd = fs.openSync(`${file}.tmp`, "w");
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(`${file}.tmp`, file);
    process.stdout.write(`done ${seed} ${result.wallMs} ms\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
