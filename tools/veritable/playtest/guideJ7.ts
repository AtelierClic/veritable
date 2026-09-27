import fs from "fs";
import path from "path";
import { sleep } from "./browser";
import { Playtest } from "./harness";

// The test guide of the J7 played (J7c), on the world map: the card of a
// nation by a right click (an ally, a far country, an adversary), the modes
// of the map, the event cards with their 3-second pause and the decision of
// the government, the journal and its markers, the cities and the density,
// the action menu at peace and at war (Ukraine), then a nuclear strike, the
// exile and the last stand from the prepared saves
// (tools/veritable/headless/prepareJ7Saves.ts). Captures and observations:
// docs/veritable/reports/J7/playtest/j7-*.
//   npx tsx tools/veritable/playtest/guideJ7.ts [out] [saves]

const OUT = process.argv[2] ?? "docs/veritable/reports/J7/playtest";
const SAVES = path.resolve(process.argv[3] ?? "docs/veritable/guides/J7-saves");
const META = JSON.parse(
  fs.readFileSync(
    path.resolve("data/veritable/borders/world-2026.meta.json"),
    "utf8",
  ),
) as { width: number; height: number; capitals: Record<string, number[]> };

async function main(): Promise<void> {
  const t = await Playtest.open(OUT, "j7");
  const W = t.browser.width;
  const H = t.browser.height;
  const text = (selector: string, n = 700) =>
    t.eval<string>(
      `vt.text(document.querySelector(${JSON.stringify(selector)})).slice(0, ${n})`,
    );
  // The camera to a point of the map: a click on the mini-map.
  const goTo = async (x: number, y: number) => {
    const r = await t.eval<{ x: number; y: number; w: number; h: number }>(
      `(() => { const c = document.getElementById("veritable-minimap"); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`,
    );
    await t.browser.click(
      r.x + ((x + 0.5) / META.width) * r.w,
      r.y + ((y + 0.5) / META.height) * r.h,
    );
    await sleep(1800);
  };
  const goToCapital = (iso: string) => {
    const [x, y] = META.capitals[iso];
    return goTo(x, y);
  };
  const escape = () => t.browser.key("Escape", "Escape");
  const importSave = async (file: string) => {
    await t.eval(`(async () => { vt.panel().show(); await vt.sleep(500); })()`);
    const before = await t.eval<string>(
      `vt.view().then((v) => v.date).catch(() => "")`,
    );
    await t.browser.setFile(
      "veritable-panel input[type=file]",
      path.join(SAVES, file),
    );
    for (let i = 0; i < 120; i++) {
      await sleep(1000);
      const date = await t.eval<string>(
        `(async () => { try { const s = vt.screens(); if (!s || !s.sim) return ""; const v = await s.sim.read(); return v.date; } catch (e) { return ""; } })()`,
      );
      if (date !== "" && date !== before) break;
    }
    await sleep(3000);
    await t.eval(`vt.speed("⏸")`);
  };

  // --- 1. The campaign ------------------------------------------------------------
  const started = await t.eval<string>(`vt.start("world-2026", "FRA")`);
  await t.eval(`vt.speed("⏸")`);
  await sleep(6000);
  await t.step("1. Campagne France, carte du monde : la caméra sur Paris", [
    `départ ${started}`,
  ]);

  // --- 2. Cards by a right click --------------------------------------------------
  for (const [iso, label] of [
    ["DEU", "une alliée"],
    ["BRA", "un pays lointain"],
    ["RUS", "un adversaire"],
  ]) {
    await goToCapital(iso);
    await t.browser.rightClick(W / 2, H / 2);
    await sleep(1500);
    await t.step(`2. Clic droit : la fiche de ${iso} (${label})`, [
      await text("veritable-nation-card", 900),
    ]);
    await escape();
    await sleep(400);
  }

  // --- 3. The modes of the map ----------------------------------------------------
  await t.browser.key("KeyC", "c");
  await sleep(1500);
  for (const [code, key, name] of [
    ["KeyN", "n", "relations"],
    ["KeyO", "o", "blocs"],
    ["KeyX", "x", "guerres"],
    ["KeyH", "h", "population"],
    ["KeyI", "i", "renseignement"],
    ["KeyV", "v", "politique"],
  ]) {
    await t.browser.key(code, key);
    await sleep(2500);
    const ms = await t.eval<string>(
      `document.getElementById("veritable-map-modes")?.dataset.switchMs ?? "?"`,
    );
    await t.step(`3. Mode ${name} (touche ${key.toUpperCase()})`, [
      `changement en ${ms} ms`,
      await text("#veritable-map-modes", 300),
    ]);
  }

  // --- 4. Event cards, the pause, the government's decision -----------------------
  await t.eval(`vt.speed("×5")`);
  let card = "";
  let countdown = "";
  let pending: string[] = [];
  for (let i = 0; i < 600 && pending.length === 0; i++) {
    await sleep(400);
    pending = await t.eval<string[]>(
      `vt.view().then((v) => v.events.pending.map((p) => p.event + "#" + p.id))`,
    );
    if (pending.length > 0) {
      countdown = await text("veritable-topbar", 200);
      card = await text("veritable-event-cards", 600);
    }
  }
  await t.step("4. Une carte d'événement de la France, la pause de 3 s", [
    `en attente : ${pending.join(", ")}`,
    `barre : ${countdown}`,
    `carte : ${card}`,
  ]);
  // Unanswered, the government decides after 30 days.
  const id = pending[0]?.split("#")[1] ?? "";
  let decided = "";
  for (let i = 0; i < 900 && decided === "" && id !== ""; i++) {
    await sleep(400);
    decided = await t.eval<string>(
      `vt.view().then((v) => v.events.pending.some((p) => String(p.id) === ${JSON.stringify(id)}) ? "" : "yes")`,
    );
    if (await t.eval<boolean>(`vt.paused()`)) await t.eval(`vt.speed("×5")`);
  }
  await t.eval(`vt.speed("⏸")`);
  await t.eval(`vt.open("Journal")`);
  const decisions = await t.eval<string>(
    `(async () => { await vt.sleep(800); const s = vt.screens(); const lines = [...s.querySelectorAll("div, tr")].map((x) => vt.text(x)).filter((x) => x.includes("Décidé par")); return lines.slice(-3).join(" | "); })()`,
  );
  await t.step("4. Sans réponse : le gouvernement tranche", [decisions]);

  // --- 5. The journal and its markers ------------------------------------------------
  const clicked = await t.eval<string>(
    `(async () => { const s = vt.screens(); const rows = [...s.querySelectorAll("[data-entry], tr, li")].filter((r) => r.onclick || r.getAttribute("role") === "button" || r.querySelector("button")); const row = [...s.querySelectorAll("tr, li, div")].find((r) => r.textContent.includes("guerre") && r.textContent.length < 400); if (row) row.click(); await vt.sleep(1500); return row ? vt.text(row).slice(0, 160) : "aucune entrée cliquée (" + rows.length + ")"; })()`,
  );
  await t.step("5. Journal : un clic sur une entrée (caméra et fiche)", [
    clicked,
  ]);
  await t.eval(`vt.close()`);
  await escape();

  // --- 6. Cities and density --------------------------------------------------------
  await t.browser.key("KeyC", "c");
  await sleep(1500);
  await t.step("6. Villes : Paris et ses voisines au zoom régional");
  await t.browser.key("KeyH", "h");
  await sleep(2500);
  await t.step("6. Densité de population (mode H)");
  await t.browser.key("KeyV", "v");
  await sleep(1000);

  // --- 7. The action menu at peace -------------------------------------------------
  await goToCapital("ESP");
  await t.browser.click(W / 2, H / 2);
  await sleep(1500);
  await t.step("7. Clic gauche sur l'Espagne (en paix) : le menu", [
    await text("veritable-action-menu", 700),
  ]);
  await escape();

  // --- 8. At war: Ukraine against Russia ------------------------------------------
  // A new campaign starts from the menu: the page is loaded again.
  await t.reopen();
  await t.eval(`vt.start("world-2026", "UKR")`);
  await t.eval(`vt.speed("⏸")`);
  await sleep(6000);
  const point = await t.eval<number[] | null>(
    `(async () => { const r = await vt.sim().mapOverlay(-1); const f = r.overlay.fronts.find((x) => x.id === "RUS|UKR"); if (!f || f.segments.length === 0) return null; const s = f.segments[Math.floor(f.segments.length / 2)]; return s.mid; })()`,
  );
  const menus: string[] = [];
  if (point !== null) {
    await goTo(point[0], point[1]);
    for (const dx of [0, 40]) {
      await t.browser.click(W / 2 + dx, H / 2);
      await sleep(1500);
      menus.push(await text("veritable-action-menu", 600));
      await escape();
      await sleep(300);
    }
    await t.browser.click(W / 2 + 40, H / 2);
    await sleep(1500);
  }
  await t.step("8. Ukraine : clic gauche sur le front russo-ukrainien", menus);
  await escape();

  // --- 9. A nuclear strike (save: France at war with Russia) -------------------------
  await importSave("j7-guerre-nucleaire.vsave");
  const war = await t.eval<string>(
    `vt.view().then((v) => v.date + " : " + v.diplomacy.wars.map((w) => w.aggressors.join("+") + " > " + w.defenders.join("+")).filter((x) => x.includes("FRA")).join(" ; "))`,
  );
  await t.step("9. Sauvegarde « guerre nucléaire » chargée", [war]);
  await t.eval(
    `vt.apply({ type: "nuclear-launch", target: "RUS", aim: "capital", confirmed: true })`,
  );
  await t.eval(`vt.speed("×1")`);
  let burst = "";
  for (let i = 0; i < 60 && burst === ""; i++) {
    await sleep(1000);
    burst = await t.eval<string>(
      `vt.view().then((v) => { const s = v.nuclear.strikes.find((x) => x.by === "FRA"); return s && s.status !== "in-flight" ? s.status + " ; morts " + Math.round(s.deaths.RUS ?? 0) + " ; tuiles " + (s.hits.RUS ?? 0) : ""; })`,
    );
    if (await t.eval<boolean>(`vt.paused()`)) await t.eval(`vt.speed("×1")`);
  }
  await t.eval(`vt.speed("⏸")`);
  await goToCapital("RUS");
  await t.step("9. Frappe sur Moscou : hachures et icône", [burst]);
  await t.eval(`vt.open("Journal")`);
  await sleep(800);
  await t.step("9. Le journal : les morts au point zéro", [
    await t.eval<string>(
      `vt.view().then((v) => v.journal.filter((j) => j.kind.startsWith("nuclear")).map((j) => j.date + " " + j.kind + " " + JSON.stringify(j.params)).join(" | "))`,
    ),
  ]);
  await t.eval(`vt.close()`);

  // --- 10. The exile (save: Ukraine annexed) -----------------------------------------
  await importSave("j7-exil.vsave");
  await t.eval(`vt.open("Exil")`);
  await sleep(800);
  await t.step("10. Ukraine en exil : l'écran Exil", [
    await text("veritable-screens", 900),
  ]);
  await t.eval(
    `(async () => { vt.button(vt.screens(), "Demander le retour").click(); await vt.sleep(1500); })()`,
  );
  await t.step("10. Demande de retour à l'occupant", [
    await t.eval<string>(
      `vt.view().then((v) => v.journal.slice(-3).map((j) => j.kind + " " + JSON.stringify(j.params)).join(" | "))`,
    ),
  ]);
  await t.eval(`vt.close()`);

  // --- 11. The last stand (save: Ukraine dissolved) ---------------------------------
  await importSave("j7-baroud.vsave");
  await t.eval(`vt.open("Exil")`);
  await sleep(800);
  await t.step("11. Ukraine dissoute : le baroud d'honneur", [
    await text("veritable-screens", 700),
  ]);
  const chosen = await t.eval<string>(`(async () => {
    const s = vt.screens();
    const b = [...s.querySelectorAll("button")].find((x) => x.textContent.trim() === "Moldavie");
    if (!b) return "pas de bouton Moldavie";
    b.click(); await vt.sleep(500);
    const again = [...s.querySelectorAll("button")].find((x) => x.textContent.includes("Moldavie"));
    again.click(); await vt.sleep(2000);
    const v = await vt.view();
    return "joueur : " + v.playerNation + " ; " + v.journal.slice(-1).map((j) => j.kind).join("");
  })()`);
  await t.step("11. Baroud : la Moldavie", [chosen]);
  await t.eval(`vt.close()`);
  // Saved and loaded again: Moldova played, the journal intact.
  const before = await t.eval<string>(
    `vt.view().then((v) => v.playerNation + " ; " + v.journal.length + " entrées ; " + v.journal.filter((j) => j.kind === "last-stand").length + " baroud")`,
  );
  await t.eval(`vt.keep("baroud")`);
  await t.eval(`vt.reload("baroud")`);
  await t.eval(`vt.speed("⏸")`);
  const after = await t.eval<string>(
    `vt.view().then((v) => v.playerNation + " ; " + v.journal.length + " entrées ; " + v.journal.filter((j) => j.kind === "last-stand").length + " baroud")`,
  );
  await t.step("11. Baroud : sauvegarde et rechargement", [
    `avant : ${before}`,
    `après : ${after}`,
  ]);
  await t.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
