import fs from "fs";
import path from "path";
import { Playtest } from "./harness";

// The test guide of the J6 played (J6c): the world of 2026 — the choice of
// the nation by the map and the list, the screens at the scale of the world
// (filters, sort, embargoes of a nation), the blocs, the wars of 2026, a year
// at x5, a save reloaded. Captures and observations:
// docs/veritable/reports/J6/playtest/j6-*.

const OUT = process.argv[2] ?? "docs/veritable/reports/J6/playtest";
const META = JSON.parse(
  fs.readFileSync(
    path.resolve("data/veritable/borders/world-2026.meta.json"),
    "utf8",
  ),
) as { width: number; height: number; capitals: Record<string, number[]> };

async function main(): Promise<void> {
  const t = await Playtest.open(OUT, "j6");
  const screen = (n = 600) =>
    t.eval<string>(`vt.text(vt.screens()).slice(0, ${n})`);

  // --- 1. The choice of the nation ------------------------------------------
  await t.eval(`(async () => {
    const p = vt.panel();
    p.show();
    await vt.sleep(500);
    const select = [...p.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "world-2026"));
    select.value = "world-2026";
    select.dispatchEvent(new Event("change"));
    await vt.sleep(2500);
  })()`);
  await t.step("1. Le panneau de départ, monde de 2026");
  // A click on the small map, on New Delhi.
  const [ix, iy] = META.capitals.IND;
  const rect = await t.eval<{
    x: number;
    y: number;
    w: number;
    h: number;
  }>(`(() => {
    const c = document.querySelector("veritable-nation-picker canvas");
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  })()`);
  await t.browser.click(
    rect.x + (ix / META.width) * rect.w,
    rect.y + (iy / META.height) * rect.h,
  );
  await t.eval(`vt.sleep(800)`);
  const picked = await t.eval<string>(
    `vt.text(document.querySelector("veritable-nation-picker")).slice(0, 80)`,
  );
  await t.step("1. Clic sur la petite carte (New Delhi)", [
    `choisi : ${picked}`,
  ]);
  // The search: "fra" then France in the list.
  await t.eval(`(async () => {
    const picker = document.querySelector("veritable-nation-picker");
    const input = picker.querySelector("input");
    input.value = "fra";
    input.dispatchEvent(new Event("input"));
    await vt.sleep(600);
  })()`);
  const found = await t.eval<string[]>(
    `[...document.querySelectorAll("veritable-nation-picker button")].map((b) => b.textContent.trim())`,
  );
  await t.eval(`(async () => {
    vt.button(document.querySelector("veritable-nation-picker"), "France").click();
    await vt.sleep(600);
  })()`);
  await t.step("1. Recherche « fra » dans la liste", [
    `résultats : ${found.join(", ")}`,
  ]);
  const started = await t.eval<string>(`(async () => {
    vt.button(vt.panel(), "Commencer").click();
    return await vt.waitGame();
  })()`);
  await t.eval(`vt.speed("⏸")`);
  const count = await t.eval<number>(`vt.view().then((v) => v.nations.length)`);
  await t.step("1. Campagne mondiale lancée", [
    `date ${started}, ${count} nations`,
  ]);

  // --- 2. Diplomacy at the scale of the world --------------------------------
  await t.eval(`vt.open("Diplomatie et sanctions")`);
  await t.step("2. Diplomatie : les 207 autres nations", [await screen(500)]);
  const filtered = await t.eval<string>(`(async () => {
    const s = vt.screens();
    s.filter = { search: "", region: "", bloc: "nato", sort: "relations" };
    await s.updateComplete; await vt.sleep(600);
    return (vt.text(s).match(/\\d+ \\/ \\d+[^.]{0,20}/) ?? [""])[0];
  })()`);
  await t.step("2. Filtre OTAN, tri par relations", [filtered]);
  const russia = await t.eval<string>(`(async () => {
    const s = vt.screens();
    s.filter = { search: "russ", region: "", bloc: "", sort: "name" };
    await s.updateComplete; await vt.sleep(600);
    const b = [...s.querySelectorAll("button, td, span")].find((x) => x.textContent.trim() === "Russie");
    if (b) b.click();
    await vt.sleep(800);
    return vt.text(s).slice(0, 900);
  })()`);
  await t.step("2. Russie choisie : ses embargos dans les deux sens", [russia]);

  // --- 3. Opinion and leaders, filtered ------------------------------------
  await t.eval(`vt.open("Dirigeants")`);
  const leaders = await t.eval<string>(`(async () => {
    const s = vt.screens();
    s.filter = { search: "", region: "r:asia", bloc: "", sort: "gdp" };
    await s.updateComplete; await vt.sleep(600);
    return vt.text(s).slice(0, 700);
  })()`);
  await t.step("3. Dirigeants d'Asie par PIB", [leaders]);

  // --- 4. Blocs ---------------------------------------------------------------
  await t.eval(`vt.open("Blocs")`);
  const blocs = await t.eval<string>(
    `vt.view().then((v) => v.blocs.filter((b) => ["eu", "nato", "brics", "au"].includes(b.id)).map((b) => b.id + " : " + (b.leader ?? "—") + " jusqu'au " + (b.termEnds ?? "—") + ", " + b.members.filter((m) => m.status === "full").length + " membres").join(" ; "))`,
  );
  await t.step("4. Blocs : têtes et membres", [blocs]);

  // --- 5. The wars of 2026 --------------------------------------------------
  await t.eval(`vt.open("Fronts et divisions")`);
  const wars = await t.eval<string>(
    `vt.view().then((v) => v.diplomacy.wars.map((w) => w.aggressors.join("+") + " > " + w.defenders.join("+")).join(" ; "))`,
  );
  await t.step("5. Fronts : les guerres du 1er janvier 2026", [wars]);
  await t.eval(`vt.close()`);
  await t.step("5. La carte du monde, fronts et tuiles contestées");

  // --- 6. A year at x5 --------------------------------------------------------
  const year = await t.eval<{ date: string; answered: string[] }>(
    `vt.until("2027-01-02", 3600000)`,
  );
  await t.eval(`vt.open("Objectifs et journal")`);
  const journal = await t.eval<string[]>(
    `vt.view().then((v) => v.journal.slice(-15).map((j) => j.date + " " + j.kind + " " + (j.nation ?? "")))`,
  );
  await t.step("6. Un an à ×5 : le journal", [
    `fenêtres répondues : ${year.answered.join(", ")}`,
    ...journal,
  ]);
  await t.eval(`vt.open("Blocs")`);
  const eu = await t.eval<string>(
    `vt.view().then((v) => { const b = v.blocs.find((x) => x.id === "eu"); return (b?.leader ?? "—") + " jusqu'au " + (b?.termEnds ?? "—"); })`,
  );
  await t.step("6. Présidence de l'UE au 1er janvier 2027", [
    eu,
    "(guide : Irlande au second semestre 2026, Lituanie au premier de 2027)",
  ]);

  // --- 7. Save and reload -----------------------------------------------------
  const before = await t.eval<string>(
    `vt.view().then((v) => JSON.stringify({ date: v.date, nations: v.nations.length, wars: v.diplomacy.wars.length, sanctions: v.diplomacy.sanctions.length }))`,
  );
  const size = await t.eval<number>(
    `vt.sim().snapshot().then((s) => s.bytes.length)`,
  );
  await t.eval(`vt.keep("year")`);
  await t.eval(`vt.reload("year")`);
  await t.eval(`vt.speed("⏸")`);
  const after = await t.eval<string>(
    `vt.view().then((v) => JSON.stringify({ date: v.date, nations: v.nations.length, wars: v.diplomacy.wars.length, sanctions: v.diplomacy.sanctions.length }))`,
  );
  await t.step("7. Sauvegarde et rechargement", [
    `taille ${(size / 1e6).toFixed(2)} Mo`,
    `avant ${before}`,
    `après ${after}`,
  ]);
  await t.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
