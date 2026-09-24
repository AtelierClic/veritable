import { Playtest } from "./harness";

// The test guide of the J5 played (J6c): technology, events, the French
// presidency of the EU, the dead hand before an annexation, sanctions put to
// a vote, a save reloaded. Captures and observations:
// docs/veritable/reports/J6/playtest/j5-*.

const OUT = process.argv[2] ?? "docs/veritable/reports/J6/playtest";

const TECH = `vt.view().then((v) => {
  const t = v.tech.nations.FRA;
  return { points: t.pointsLastMonth, projects: t.projects.map((p) => p.node), done: t.done.length };
})`;

async function main(): Promise<void> {
  const t = await Playtest.open(OUT, "j5");
  const screen = (n = 500) =>
    t.eval<string>(`vt.text(vt.screens()).slice(0, ${n})`);

  // --- 1. The top bar -------------------------------------------------------
  const start = await t.eval<string>(`vt.start("europe-10", "FRA")`);
  await t.eval(`vt.speed("⏸")`);
  const bar = await t.eval<string>(`vt.text(vt.bar())`);
  await t.step("1. La barre du haut", [
    `date ${start}`,
    `Blocs : ${bar.includes("Blocs")}, Technologie : ${bar.includes("Technologie")}, Événements : ${bar.includes("Événements")}`,
  ]);

  // --- 2. Technology --------------------------------------------------------
  await t.eval(`vt.open("Technologie")`);
  const clicked = await t.eval<number>(`(async () => {
    let n = 0;
    for (let i = 0; i < 3; i++) {
      const b = [...vt.screens().querySelectorAll("button")].find(
        (x) => x.textContent.trim() === "Rechercher" && !x.disabled);
      if (!b) break;
      b.click(); n++;
      await vt.sleep(800);
    }
    return n;
  })()`);
  const tech0 = await t.eval<{
    points: number;
    projects: string[];
    done: number;
  }>(TECH);
  const summary = await t.eval<string>(
    `(vt.text(vt.screens()).match(/Recherche : [^;]+; palier 1 du tronc commun : [^.]+/) ?? [""])[0]`,
  );
  await t.step("2. Technologie : trois projets lancés", [
    summary,
    `boutons « Rechercher » cliqués : ${clicked}, projets ${tech0.projects.join(", ")} (guide : 3)`,
    `nœuds acquis ${tech0.done} (guide : 27 sur 61 au palier 1)`,
  ]);
  const branches = await t.eval<string>(`(async () => {
    const tab = [...vt.screens().querySelectorAll("button")].find((x) => x.textContent.trim().startsWith("BRICS"));
    if (!tab) return "pas d'onglet BRICS";
    tab.click(); await vt.sleep(800);
    return (vt.text(vt.screens()).match(/réservé[^.]{0,40}/) ?? ["aucun refus affiché"])[0];
  })()`);
  await t.step("2. Technologie : onglet BRICS", [branches]);
  await t.eval(`vt.until("2026-02-03")`);
  const tech1 = await t.eval<{ points: number }>(TECH);
  await t.step("2. Technologie : points au 1er février", [
    `${tech1.points.toFixed(1)} points par mois (guide : environ 35)`,
  ]);

  // --- 3. Events -------------------------------------------------------------
  const firstPopup = await t.eval<string>(`(async () => {
    await vt.speed("×5");
    for (let i = 0; i < 1500; i++) {
      await vt.sleep(400);
      if (vt.paused()) return (await vt.view()).date;
    }
    return "none";
  })()`);
  await t.step("3. Événements : une fenêtre met le jeu en pause", [
    `pause au ${firstPopup}`,
    await screen(600),
  ]);
  const answered = await t.eval<string[]>(`vt.answerAll()`);
  await t.eval(`vt.close()`);
  // The next pop-up is left to the government.
  const second = await t.eval<string>(`(async () => {
    await vt.speed("×5");
    for (let i = 0; i < 1500; i++) {
      await vt.sleep(400);
      if (vt.paused()) {
        const v = await vt.view();
        return v.date + " " + v.events.pending.map((p) => p.event).join(",");
      }
    }
    return "none";
  })()`);
  await t.eval(`vt.close()`);
  const leftAlone = await t.eval<string>(`(async () => {
    const v0 = await vt.view();
    const ids = v0.events.pending.map((p) => p.id);
    const end = v0.date.slice(0, 5) + String(Number(v0.date.slice(5, 7)) + 2).padStart(2, "0") + "-02";
    await vt.speed("×5");
    for (let i = 0; i < 3000; i++) {
      await vt.sleep(400);
      const v = await vt.view();
      if (vt.paused()) {
        // Others are answered; those of the step are left alone.
        for (const p of v.events.pending) {
          if (ids.includes(p.id)) continue;
          const data = vt.screens().eventCatalogue.find((e) => e.id === p.event);
          await vt.apply({ type: "event-choose", id: p.id, choice: data.choices[0].id });
        }
        vt.close(); await vt.speed("×5");
      }
      if (v.date >= end || !v.events.pending.some((p) => ids.includes(p.id))) {
        await vt.speed("⏸");
        return v.date + " : " + (v.events.pending.some((p) => ids.includes(p.id)) ? "toujours en attente" : "tranché par le gouvernement");
      }
    }
    return "délai dépassé";
  })()`);
  await t.eval(`vt.open("Événements")`);
  await t.step("3. Événements : une réponse, une décision laissée", [
    `répondu : ${answered.join(", ")}`,
    `seconde fenêtre : ${second}`,
    `laissée sans réponse : ${leftAlone}`,
  ]);

  // --- 4. The presidency of the EU --------------------------------------------
  await t.eval(`vt.until("2026-07-02")`);
  await t.eval(`vt.open("Blocs")`);
  const leader = await t.eval<string>(
    `vt.view().then((v) => { const b = v.blocs.find((x) => x.id === "eu"); return (b?.leader ?? "—") + " jusqu'au " + (b?.termEnds ?? "—"); })`,
  );
  const proposed = await t.eval<string>(`(async () => {
    try {
      await vt.apply({ type: "bloc-propose", bloc: "eu", kind: "tech-program", target: null, direction: null });
      return "soumis";
    } catch (e) { return "refusé : " + e.message; }
  })()`);
  await t.eval(`vt.sleep(1500)`);
  await t.step("4. Présidence française de l'UE : programme technologique", [
    `tête de l'UE ${leader} (guide : France)`,
    `programme commun : ${proposed}`,
    await screen(700),
  ]);
  await t.eval(`vt.until("2026-08-03")`);
  const tech2 = await t.eval<{ points: number }>(TECH);
  const programs = await t.eval<string>(
    `vt.view().then((v) => JSON.stringify(v.blocs.find((b) => b.id === "eu")?.state.programs ?? null))`,
  );
  await t.step("4. Présidence : le programme au mois suivant", [
    `programmes de l'UE ${programs}`,
    `points ${tech1.points.toFixed(1)} → ${tech2.points.toFixed(1)} (guide : +25 %)`,
  ]);

  // --- 5. The dead hand -------------------------------------------------------
  await t.eval(
    `vt.apply({ type: "declare-war", target: "RUS", casusBelli: "none" })`,
  );
  await t.eval(`vt.sleep(1500)`);
  await t.eval(`vt.open("Fronts et divisions")`);
  const deadHand = await t.eval<string>(
    `vt.view().then((v) => Object.entries(v.deadHand).map(([k, p]) => k + " " + Math.round(100 * p) + " %").join(", "))`,
  );
  const warning = await t.eval<string>(`(async () => {
    const s = vt.screens();
    const select = [...s.querySelectorAll("select")].find((x) => [...x.options].some((o) => o.value === "annexation"));
    if (!select) return "pas de formulaire de paix";
    select.value = "annexation";
    select.dispatchEvent(new Event("change"));
    await vt.sleep(800);
    return (vt.text(s).match(/[^.]*main morte[^.]*/i) ?? ["aucun avertissement"])[0];
  })()`);
  await t.step("5. Guerre à la Russie sans casus belli : la main morte", [
    `main morte ${deadHand} (guide : Russie 70 %)`,
    `avertissement du formulaire (annexion) : ${warning}`,
  ]);

  // --- 6. Sanctions put to a vote ---------------------------------------------
  await t.eval(`vt.until("2026-09-02")`);
  await t.eval(`vt.open("Blocs")`);
  const sanctions = await t.eval<string>(`(async () => {
    try {
      await vt.apply({ type: "bloc-propose", bloc: "eu", kind: "sanctions", target: "RUS", direction: null });
      return "soumises";
    } catch (e) { return "refusées : " + e.message; }
  })()`);
  await t.eval(`vt.sleep(1500)`);
  await t.step("6. Sanctions de l'UE contre la Russie soumises", [
    sanctions,
    await screen(900),
  ]);
  await t.eval(`vt.until("2027-03-02")`);
  await t.eval(`vt.open("Objectifs et journal")`);
  const decisions = await t.eval<string[]>(
    `vt.view().then((v) => v.journal.filter((j) => j.kind === "bloc-decision" || j.kind === "sanctions-imposed").slice(-12).map((j) => j.date + " " + j.kind + " " + (j.nation ?? "") + " " + JSON.stringify(j.params)))`,
  );
  await t.step("6. Les votes et les sanctions au journal", decisions);

  // --- 7. Save and reload -----------------------------------------------------
  const before = await t.eval<string>(
    `vt.view().then((v) => JSON.stringify({ date: v.date, projects: v.tech.nations.FRA.projects.map((p) => p.node), pending: v.events.pending.length, blocs: v.blocs.map((b) => b.id + ":" + b.members.length) }))`,
  );
  await t.eval(`vt.keep("end")`);
  await t.eval(`vt.reload("end")`);
  await t.eval(`vt.speed("⏸")`);
  const after = await t.eval<string>(
    `vt.view().then((v) => JSON.stringify({ date: v.date, projects: v.tech.nations.FRA.projects.map((p) => p.node), pending: v.events.pending.length, blocs: v.blocs.map((b) => b.id + ":" + b.members.length) }))`,
  );
  await t.eval(`vt.open("Blocs")`);
  await t.step("7. Sauvegarde et rechargement", [
    `avant ${before}`,
    `après ${after}`,
    `identiques : ${before === after}`,
  ]);
  await t.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
