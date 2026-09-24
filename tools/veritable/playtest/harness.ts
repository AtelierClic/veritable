import fs from "fs";
import os from "os";
import path from "path";
import { HeadlessBrowser, sleep } from "./browser";

// A played test (J6c): a guide replayed in a real browser, one capture per
// step, the observations of each step in a log next to the captures.
//
// The page helpers below drive the game the way a player does: the start
// panel, the speed buttons, the screens of the top bar; commands go through
// the same RemoteVeritableSim the screens use. Pop-ups that pause the game
// are answered with their first choice unless a step says otherwise.

const PAGE_HELPERS = String.raw`
window.vt = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  panel: () => document.querySelector("veritable-panel"),
  screens: () => document.querySelector("veritable-screens"),
  bar: () => document.querySelector("veritable-topbar"),
  text: (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : ""),
  button(root, label) {
    const b = [...root.querySelectorAll("button")].find(
      (x) => x.textContent.replace(/\s+/g, " ").trim() === label,
    );
    if (!b) throw new Error("no button " + label);
    return b;
  },
  // Clicks the button "label" in the row (tr, li or div) whose text holds
  // "rowText".
  rowButton(root, rowText, label) {
    const rows = [...root.querySelectorAll("tr, li, div")].filter(
      (r) => r.textContent.includes(rowText),
    );
    for (const row of rows.reverse()) {
      const b = [...row.querySelectorAll("button")].find(
        (x) => x.textContent.replace(/\s+/g, " ").trim() === label,
      );
      if (b) { b.click(); return true; }
    }
    return false;
  },
  // Saves of the test, kept in the page: a snapshot now, a reload later.
  saves: {},
  async keep(name) {
    const snap = await this.sim().snapshot();
    this.saves[name] = snap.bytes;
    return snap.gameDate;
  },
  async reload(name) {
    const bytes = this.saves[name];
    const before = this.sim();
    this.panel().load(bytes, name);
    for (let i = 0; i < 240; i++) {
      await this.sleep(500);
      const s = this.screens();
      if (s && s.sim && s.sim !== before && this.bar()) {
        try { const v = await s.sim.read(); if (v && v.date) return v.date; } catch (e) {}
      }
    }
    throw new Error("the save did not load");
  },
  sim() {
    const s = this.screens();
    const sim = (s && s.sim) || this.panel().sim;
    if (!sim) {
      // The campaign was detached (the worker failed): what the page shows.
      throw new Error("campaign detached: " + document.body.innerText.slice(0, 800));
    }
    return sim;
  },
  async view() { return await this.sim().read(); },
  async apply(command) { return await this.sim().apply(command); },
  async start(scenario, nation) {
    const p = this.panel();
    p.show();
    p.scenarioId = scenario;
    p.nationId = nation;
    await p.updateComplete;
    await this.sleep(500);
    this.button(p, "Commencer").click();
    return await this.waitGame();
  },
  async waitGame() {
    for (let i = 0; i < 240; i++) {
      await this.sleep(500);
      const s = this.screens();
      if (this.bar() && s && s.sim) {
        try { const v = await s.sim.read(); if (v && v.date) return v.date; } catch (e) {}
      }
    }
    throw new Error("the game did not start");
  },
  paused() { return this.text(this.bar()).includes("En pause"); },
  async speed(label) { this.button(this.bar(), label).click(); await this.sleep(300); },
  async open(title) {
    const s = this.screens();
    if (s.screen !== null && this.text(s).startsWith(title)) return;
    this.button(this.bar(), title).click();
    await this.sleep(1200);
  },
  close() { const s = this.screens(); if (s.screen !== null) s.toggle(s.screen); },
  // Answers the player's pending pop-ups with their first choice (or the
  // given one), records what was answered.
  async answerAll(choice) {
    const v = await this.view();
    const answered = [];
    for (const p of v.events.pending) {
      const data = this.screens().eventCatalogue.find((e) => e.id === p.event);
      const id = choice ?? data.choices[0].id;
      await this.apply({ type: "event-choose", id: p.id, choice: id });
      answered.push(p.event + ":" + id);
    }
    return answered;
  },
  // Runs at x5 until the date, answering the pop-ups that pause the game.
  async until(date, timeoutMs = 900000) {
    const started = Date.now();
    const answered = [];
    await this.speed("×5");
    for (;;) {
      await this.sleep(400);
      const v = await this.view();
      if (v.date >= date) { await this.speed("⏸"); return { date: v.date, answered }; }
      if (this.paused()) {
        answered.push(...(await this.answerAll()));
        this.close();
        await this.speed("×5");
      }
      if (Date.now() - started > timeoutMs) throw new Error("timeout before " + date + " at " + v.date);
    }
  },
};
"ok";
`;

export interface StepLog {
  step: string;
  title: string;
  date: string | null;
  capture: string;
  notes: string[];
}

export class Playtest {
  readonly log: StepLog[] = [];
  private index = 0;
  // Captures and log are written outside the repository while the test
  // runs, and copied to outDir at the end: a file written under the project
  // makes Tailwind rebuild the stylesheet, and the dev server reloads the
  // page in the middle of the test.
  private readonly work = fs.mkdtempSync(
    path.join(os.tmpdir(), "veritable-playtest-"),
  );

  constructor(
    readonly browser: HeadlessBrowser,
    readonly outDir: string,
    readonly prefix: string,
  ) {}

  static async open(
    outDir: string,
    prefix: string,
    url = "http://localhost:9000/",
  ): Promise<Playtest> {
    const browser = await HeadlessBrowser.launch();
    await browser.goto(url);
    await sleep(3000);
    const test = new Playtest(browser, outDir, prefix);
    await test.install();
    return test;
  }

  async install(): Promise<void> {
    await this.browser.eval(PAGE_HELPERS);
  }

  eval<T = unknown>(expression: string): Promise<T> {
    return this.browser.eval<T>(expression);
  }

  async date(): Promise<string | null> {
    try {
      return await this.eval<string>("vt.view().then((v) => v.date)");
    } catch {
      return null;
    }
  }

  // A capture of the page as it stands, with what the step observed.
  async step(title: string, notes: string[] = []): Promise<void> {
    this.index++;
    const slug = title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    const file = path.join(
      this.work,
      `${this.prefix}-${String(this.index).padStart(2, "0")}-${slug}.png`,
    );
    await this.browser.screenshot(file);
    const entry: StepLog = {
      step: String(this.index).padStart(2, "0"),
      title,
      date: await this.date(),
      capture: path.basename(file),
      notes,
    };
    this.log.push(entry);
    process.stdout.write(
      `${entry.step} ${entry.date ?? ""} ${title}\n${notes.map((n) => `   ${n}`).join("\n")}\n`,
    );
    this.writeLog();
  }

  writeLog(): void {
    fs.writeFileSync(
      path.join(this.work, `${this.prefix}-log.json`),
      `${JSON.stringify(this.log, null, 2)}\n`,
    );
  }

  async close(): Promise<void> {
    const errors = this.browser.errors.filter(
      (e) => !/cosmetics|ramp\.|Refresh failed|Failed to fetch/.test(e),
    );
    if (errors.length > 0) {
      this.log.push({
        step: "errors",
        title: "Erreurs de la page",
        date: null,
        capture: "",
        notes: errors,
      });
    }
    this.writeLog();
    await this.browser.close();
    fs.mkdirSync(this.outDir, { recursive: true });
    for (const file of fs.readdirSync(this.work)) {
      fs.copyFileSync(path.join(this.work, file), path.join(this.outDir, file));
    }
    fs.rmSync(this.work, { recursive: true, force: true });
  }
}
