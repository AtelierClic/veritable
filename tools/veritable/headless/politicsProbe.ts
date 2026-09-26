import { loadScenarioPackFrom } from "../../../src/veritable/adapters/scenarioPackFrom";
import { createDataSource } from "../../../src/veritable/data/DataSource";
import { fsDataFiles } from "../../../src/veritable/data/files.fs";
import { simDriver } from "./campaign";

// The J4 guide in numbers, without a browser (J7a): the French campaign of
// europe-10 read on the first day, three months after the "losing" budget
// (VAT +8 points, social spending -5), and at the presidential election of
// April 2027 after the "honest" campaign (clientelism on the retirees,
// health and education +2, VAT -2, the housing programme). Only the
// simulation and its world view: the probe runs unchanged on the commits of
// the J5 and the J6 (bisection of the political regression).
//
//   npx tsx tools/veritable/headless/politicsProbe.ts [--seed 42]

const seedArg = process.argv.indexOf("--seed");
const SEED = seedArg >= 0 ? Number(process.argv[seedArg + 1]) : 42;
const PLAYER = "FRA";

const pct = (x: number) => `${(100 * x).toFixed(1)}`;

async function main(): Promise<void> {
  const source = createDataSource(fsDataFiles());
  const pack = await loadScenarioPackFrom(source, "europe-10");
  const config = source.config();
  const laws = source.laws();
  const pension = laws.find((l) => l.id === "pension-age-raise")!;
  const fresh = () => simDriver(pack, config, SEED, PLAYER, false);
  const out: Record<string, unknown> = { seed: SEED };

  // --- The first day ------------------------------------------------------
  {
    const d = fresh();
    const v = d.read();
    const p = v.politics[PLAYER];
    out.government = p.government.parties;
    out.governmentIdeology = p.government.ideology;
    out.parties = Object.fromEntries(
      p.parties.map((party) => [
        party.id,
        {
          support: pct(party.support),
          ideology: party.ideology,
          charisma: party.leader.traits.charisma,
        },
      ]),
    );
    out.groupIdeologies = p.groupIdeologies;
    out.projection = Object.fromEntries(
      Object.entries(v.electionProjection ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([k, s]) => [k, pct(s)]),
    );
    const g = p.government.ideology;
    out.pensionWindow = Object.fromEntries(
      (["economic", "authority", "sovereignty"] as const).map((axis) => [
        axis,
        `${g[axis].toFixed(2)} in [${pension.window[axis].join(", ")}]: ${
          g[axis] >= pension.window[axis][0] &&
          g[axis] <= pension.window[axis][1]
        }`,
      ]),
    );
    out.taxes0 = v.economies[PLAYER].taxes;
    out.spending0 = v.economies[PLAYER].spending;
  }

  // --- Losing: VAT +8, social -5, three months ---------------------------------
  {
    const d = fresh();
    const e = d.read().economies[PLAYER];
    d.apply({ type: "set-tax", tax: "vat", rate: e.taxTargets.vat + 0.08 });
    d.apply({
      type: "set-spending",
      post: "social",
      share: Math.max(0, e.spendingTargets.social - 0.05),
    });
    const samples: Record<string, unknown> = {};
    for (let day = 1; day <= 500; day++) {
      d.advanceDay();
      const v = d.read();
      const held = v.journal.find(
        (j) => j.kind === "election-held" && j.nation === PLAYER,
      );
      if (held !== undefined && samples.election === undefined) {
        samples.election = { date: held.date, ...held.params };
      }
      if (["2026-04-01", "2026-07-01", "2027-04-01"].includes(v.date)) {
        const groups = v.politics[PLAYER].groups!;
        samples[v.date] = {
          workers: pct(groups.workers),
          retirees: pct(groups.retirees),
          opinion: pct(v.politics[PLAYER].opinion),
          vat: v.economies[PLAYER].taxes.vat.toFixed(3),
          vatTarget: v.economies[PLAYER].taxTargets.vat.toFixed(3),
          social: v.economies[PLAYER].spending.social.toFixed(3),
        };
      }
    }
    out.losing = samples;
  }

  // --- Doing nothing ------------------------------------------------------------
  {
    const d = fresh();
    let result: unknown = null;
    let groups: Record<string, string> = {};
    for (let day = 1; day <= 500 && result === null; day++) {
      d.advanceDay();
      const v = d.read();
      const held = v.journal.find(
        (j) => j.kind === "election-held" && j.nation === PLAYER,
      );
      if (held !== undefined)
        result = { date: held.date, ...held.params, groups };
      else {
        groups = Object.fromEntries(
          Object.entries(v.politics[PLAYER].groups!).map(([k, x]) => [
            k,
            pct(x),
          ]),
        );
        const r = v.electionRunoff;
        if (r !== null) groups.runoff = `${r.a} ${pct(r.shareA)} - ${r.b}`;
      }
    }
    out.nothing = result;
  }

  // --- Winning honestly ----------------------------------------------------------
  {
    const d = fresh();
    const e = d.read().economies[PLAYER];
    d.apply({ type: "set-lever", clientelism: "retirees" });
    d.apply({
      type: "set-spending",
      post: "healthEducation",
      share: e.spendingTargets.healthEducation + 0.02,
    });
    d.apply({ type: "set-tax", tax: "vat", rate: e.taxTargets.vat - 0.02 });
    let housing = false;
    let before: Record<string, string> = {};
    let result: unknown = null;
    for (let day = 1; day <= 500 && result === null; day++) {
      d.advanceDay();
      const v = d.read();
      const p = v.politics[PLAYER];
      if (!housing && p.capital >= 20) {
        d.apply({ type: "enact-law", law: "housing-programme" });
        housing = true;
      }
      const held = v.journal.find(
        (j) => j.kind === "election-held" && j.nation === PLAYER,
      );
      if (held !== undefined) {
        result = { date: held.date, ...held.params, before };
      } else {
        before = Object.fromEntries(
          Object.entries(v.electionProjection ?? {})
            .sort((a, b) => b[1] - a[1])
            .map(([k, s]) => [k, pct(s)]),
        );
        before.retirees = pct(p.groups!.retirees);
        before.date = v.date;
        const r = v.electionRunoff;
        if (r !== null) before.runoff = `${r.a} ${pct(r.shareA)} - ${r.b}`;
      }
    }
    out.honest = result;
  }
  console.log(JSON.stringify(out, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
