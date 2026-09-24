import { Playtest } from "./harness";

// The test guide of the J4 played (J6c): the French presidential election of
// April 2027 lost, stolen, then won, from one save of the first day.
// Captures and observations: docs/veritable/reports/J6/playtest/j4-*.

const OUT = process.argv[2] ?? "docs/veritable/reports/J6/playtest";

interface Facts {
  date: string;
  legitimacy: number;
  capital: number;
  coupRisk: number;
  press: number;
  media: number;
  next: string | null;
  corruption: number;
  groups: Record<string, number> | null;
  projection: Record<string, number> | null;
  government: string;
}

const FACTS = `vt.view().then((v) => {
  const p = v.politics.FRA;
  return {
    date: v.date,
    legitimacy: p.legitimacy,
    capital: p.capital,
    coupRisk: p.coupRisk,
    press: p.pressFreedom,
    media: p.mediaControl,
    next: p.nextElection,
    corruption: p.leader.traits.corruption,
    groups: p.groups,
    projection: v.electionProjection,
    government: p.government.parties.join("+"),
  };
})`;

const pct = (x: number) => `${(100 * x).toFixed(1)} %`;
const shares = (r: Record<string, number> | null) =>
  r === null
    ? "—"
    : Object.entries(r)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${pct(v)}`)
        .join(", ");

async function main(): Promise<void> {
  const t = await Playtest.open(OUT, "j4");
  const facts = () => t.eval<Facts>(FACTS);
  const screen = (n = 400) =>
    t.eval<string>(`vt.text(vt.screens()).slice(0, ${n})`);
  const journal = (kinds: string) =>
    t.eval<string[]>(
      `vt.view().then((v) => v.journal.filter((j) => ${JSON.stringify(kinds.split(","))}.includes(j.kind) && j.nation === "FRA").map((j) => j.date + " " + j.kind + " " + JSON.stringify(j.params ?? {})))`,
    );

  // --- Setting up -------------------------------------------------------
  const start = await t.eval<string>(`vt.start("europe-10", "FRA")`);
  await t.eval(`vt.speed("⏸")`);
  await t.step("Mise en place : France, europe-10", [
    `date ${start}, jeu en pause`,
  ]);

  // --- 1. The state of the first day --------------------------------------
  await t.eval(`vt.open("Dirigeants")`);
  await t.step("1. Dirigeants", [await screen(600)]);
  await t.eval(`vt.open("Politique")`);
  const f0 = await facts();
  await t.step("1. Politique au départ", [
    `légitimité ${pct(f0.legitimacy)} (guide : 80 %)`,
    `capital ${f0.capital.toFixed(0)} (guide : 30)`,
    `liberté de la presse ${pct(f0.press)} (guide : 85 %), contrôle des médias ${pct(f0.media)}`,
    `risque de coup ${pct(f0.coupRisk)} par mois (guide J4 : 0 par la période de grâce ; supprimée au J5)`,
    `prochaine élection ${f0.next} (guide : 24 avril 2027)`,
    `gouvernement ${f0.government}`,
    `projection ${shares(f0.projection)}`,
  ]);
  const pinned = await t.eval<boolean>(`(async () => {
    await vt.open("Objectifs et journal");
    await vt.apply({ type: "pin-objective", objective: "win-election" });
    await vt.apply({ type: "pin-objective", objective: "stable-five-years" });
    await vt.apply({ type: "add-note", text: "Test joué du guide J4 : l'élection d'avril 2027." });
    await vt.sleep(1500);
    vt.close(); await vt.open("Objectifs et journal");
    return vt.text(vt.screens()).includes("Gagner une élection");
  })()`);
  await t.step("1. Objectifs épinglés et note", [
    `« Gagner une élection » affiché : ${pinned}`,
  ]);
  await t.eval(`vt.keep("start")`);

  // --- 2. Losing it -----------------------------------------------------------
  await t.eval(`(async () => {
    const v = await vt.view();
    const e = v.economies.FRA;
    await vt.apply({ type: "set-tax", tax: "vat", rate: e.taxTargets.vat + 0.08 });
    await vt.apply({ type: "set-spending", post: "social", share: Math.max(0, e.spendingTargets.social - 0.05) });
  })()`);
  const lose1 = await t.eval<{ date: string }>(`vt.until("2026-04-01")`);
  await t.eval(`vt.open("Opinion")`);
  const f1 = await facts();
  await t.step("2. Perdre : trois mois après TVA +8 et social −5", [
    `date ${lose1.date}`,
    `groupes ${shares(f1.groups)} (guide : salariés et retraités 50 % → 30-35 %)`,
    `projection ${shares(f1.projection)}`,
  ]);
  // The pension law once the capital allows it.
  let enacted = false;
  for (const until of ["2026-07-01", "2026-10-01", "2027-01-01"]) {
    const f = await facts();
    if (f.capital >= 35) {
      await t.eval(`vt.open("Politique")`);
      enacted = await t.eval<boolean>(
        `vt.rowButton(vt.screens(), "Recul de l'âge de la retraite", "Voter")`,
      );
      await t.eval(`vt.sleep(1500)`);
      break;
    }
    await t.eval(`vt.until(${JSON.stringify(until)})`);
  }
  const f2 = await facts();
  await t.eval(`vt.open("Politique")`);
  await t.step("2. Perdre : la loi sur les retraites", [
    `bouton « Voter » cliqué : ${enacted}, capital après ${f2.capital.toFixed(0)}`,
    `date ${f2.date}`,
  ]);
  await t.eval(`vt.until("2027-04-01")`);
  await t.eval(`vt.open("Élection")`);
  const f3 = await facts();
  await t.step("2. Perdre : un mois avant le scrutin", [
    `projection ${shares(f3.projection)}`,
    `groupes ${shares(f3.groups)}`,
  ]);
  await t.eval(`vt.until("2027-05-15")`);
  await t.eval(`vt.open("Objectifs et journal")`);
  const f4 = await facts();
  await t.step("2. Perdre : après le scrutin", [
    ...(await journal("election-held,government-formed,fraud-detected")),
    `gouvernement ${f3.government} → ${f4.government}, capital ${f4.capital.toFixed(0)}`,
  ]);
  await t.eval(`vt.open("Dirigeants")`);
  await t.step("2. Perdre : les dirigeants après l'alternance", [
    await screen(500),
  ]);

  // --- 3. Stealing it ---------------------------------------------------------
  await t.eval(`vt.reload("start")`);
  await t.eval(`vt.speed("⏸")`);
  await t.eval(`vt.until("2027-03-01")`);
  await t.eval(`vt.open("Élection")`);
  await t.eval(`(async () => {
    await vt.apply({ type: "set-lever", fraud: 0.2, propagandaPctGdp: 0.02 });
    await vt.sleep(1500);
    vt.close(); await vt.open("Élection");
  })()`);
  const f5 = await facts();
  const detection = await t.eval<string>(
    `(vt.text(vt.screens()).match(/détection [^ ]+ ?%?/) ?? [""])[0]`,
  );
  await t.step("3. Voler : fraude 20 %, propagande 2 % du PIB", [
    `projection ${shares(f5.projection)} (guide : le sortant vers 45 %, en tête)`,
    `${detection} (guide : 68 %)`,
  ]);
  await t.eval(`vt.until("2027-05-15")`);
  await t.eval(`vt.open("Objectifs et journal")`);
  const f6 = await facts();
  await t.step("3. Voler : après le scrutin", [
    ...(await journal("election-held,government-formed,fraud-detected")),
    `légitimité ${pct(f5.legitimacy)} → ${pct(f6.legitimacy)} (guide : 50 % si la fraude est révélée)`,
    `risque de coup ${pct(f6.coupRisk)} par mois`,
  ]);
  await t.eval(`vt.open("Diplomatie et sanctions")`);
  await t.step("3. Voler : relations avec les démocraties", [
    await t.eval<string>(
      `vt.view().then((v) => ["DEU","GBR","ITA","ESP","POL","NOR"].map((n) => n + " " + Math.round(v.diplomacy.relations["FRA"]?.[n] ?? v.diplomacy.relations[n]?.["FRA"] ?? 0)).join(", "))`,
    ),
  ]);

  // --- 4. Winning it honestly -------------------------------------------------
  await t.eval(`vt.reload("start")`);
  await t.eval(`vt.speed("⏸")`);
  await t.eval(`(async () => {
    const v = await vt.view();
    const e = v.economies.FRA;
    await vt.apply({ type: "set-lever", clientelism: "retirees" });
    await vt.apply({ type: "set-spending", post: "healthEducation", share: e.spendingTargets.healthEducation + 0.02 });
    await vt.apply({ type: "set-tax", tax: "vat", rate: Math.max(0, e.taxTargets.vat - 0.02) });
  })()`);
  let housing = false;
  for (const until of ["2026-03-01", "2026-06-01", "2026-09-01"]) {
    const f = await facts();
    if (f.capital >= 20) {
      await t.eval(`vt.open("Politique")`);
      housing = await t.eval<boolean>(
        `vt.rowButton(vt.screens(), "Programme de logement", "Voter")`,
      );
      await t.eval(`vt.sleep(1500)`);
      break;
    }
    await t.eval(`vt.until(${JSON.stringify(until)})`);
  }
  await t.eval(`vt.until("2027-04-01")`);
  await t.eval(`vt.open("Élection")`);
  const f7 = await facts();
  await t.step("4. Gagner : un mois avant le scrutin", [
    `« Programme de logement » voté par le bouton : ${housing}`,
    `groupes ${shares(f7.groups)} (guide : retraités 65-70 %)`,
    `projection ${shares(f7.projection)}`,
    `corruption du dirigeant ${pct(f7.corruption)}`,
  ]);
  await t.eval(`vt.until("2027-05-15")`);
  await t.eval(`vt.open("Objectifs et journal")`);
  const f8 = await facts();
  await t.step("4. Gagner : après le scrutin", [
    ...(await journal(
      "election-held,government-formed,objective-completed,fraud-detected",
    )),
    `gouvernement ${f7.government} → ${f8.government}, capital ${f8.capital.toFixed(0)}`,
  ]);

  // --- 5. Elsewhere -----------------------------------------------------------
  await t.eval(`vt.open("Dirigeants")`);
  await t.step("5. Ailleurs dans le monde", [await screen(800)]);
  await t.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
