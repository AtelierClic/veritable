import { ReplaySpeedChangeEvent } from "../../client/InputHandler";
import { GoToPositionEvent } from "../../client/TransformHandler";
import { PauseGameIntentEvent } from "../../client/Transport";
import { ReplaySpeedMultiplier } from "../../client/utilities/ReplaySpeedMultiplier";
import { EventBus } from "../../core/EventBus";
import { RemoteVeritableSim } from "../adapters/RemoteVeritableSim";
import { vt } from "../data/i18n";
import { loadVeritableConfig } from "../data/loadConfig";
import { JournalEntry } from "../data/schemas/save";
import { autosaveMeta, writeAutosave } from "../save/autosave";
import { IndexedDbSaveStore } from "../save/IndexedDbSaveStore";
import { SaveStore } from "../save/SaveStore";
import { peekSchemaVersion } from "../save/serialize";
import { keptForEver } from "../sim/journal";
import { addDays } from "../sim/time";
import { HudView } from "../sim/VeritableSim";
import { eventCards } from "./EventCards";
import {
  classify,
  loadPauseSettings,
  NoticeLevel,
  PauseCategory,
  PauseSettings,
  savePauseSettings,
  shouldPause,
} from "./notices";
import { veritablePanel } from "./VeritablePanel";
import { ScreenId, SCREENS, veritableScreens } from "./VeritableScreens";
import { Speed, veritableTopBar } from "./VeritableTopBar";

// Glue between a running campaign (the simulation in the game worker) and the
// Véritable screens: top bar, event cards, campaign panel, monthly automatic
// save.
//
// Speed: the campaign clock is the OpenFront tick (72 game minutes each), so
// pause / x1 / x2 / x5 drive the solo turn loop of LocalServer: military time
// and calendar accelerate together.
//
// J7: the always-visible interface reads a light view of the simulation four
// times a second (the HUD): the date, the player's decisions and votes, and
// the journal entries it has not seen. What concerns the player pauses the
// game a few seconds (a countdown on the speed control, then the game resumes
// at the speed it had; Space during the countdown keeps the pause), at most
// once every 20 real seconds; the rest is a card, or the journal.
const HUD_MS = 250;
// Game days a marker stays on the map (J7): news of the player's nation,
// then what is critical or major.
const MARKER_DAYS_INFO = 15;
const MARKER_DAYS_MAJOR = 30;

// A localised event on the map (J7): animated, clickable, for 15 to 30 game
// days.
export interface MapMarker {
  entry: JournalEntry;
  x: number;
  y: number;
  level: "critical" | "info" | "major";
  until: string; // game date it goes at
}

export class CampaignController {
  private unsubscribe: (() => void) | null = null;
  private sim: RemoteVeritableSim | null = null;
  private eventBus: EventBus | null = null;
  private paused = false;
  private speed: Speed = 1;
  private hudTimer: ReturnType<typeof setInterval> | null = null;
  private hudBusy = false;
  private journalMark: number | undefined = undefined;
  private seenDecisions = new Set<number>();
  private settings: PauseSettings = loadPauseSettings();
  private lastAutoPause: number | null = null;
  private countdown: ReturnType<typeof setInterval> | null = null;
  private resumeSpeed: Speed | null = null;
  private mapWidth = 0;
  private gameDate = "";
  private markerList: MapMarker[] = [];

  constructor(private readonly store: SaveStore = new IndexedDbSaveStore()) {}

  async attach(sim: RemoteVeritableSim, eventBus: EventBus): Promise<void> {
    this.detach();
    this.sim = sim;
    this.eventBus = eventBus;
    veritablePanel().attach(sim);

    const bar = veritableTopBar();
    bar.onSpeed = (speed) => {
      // The player's own choice ends a countdown.
      this.cancelCountdown();
      void this.setSpeed(speed);
    };
    bar.setSettings(this.settings);
    bar.onSettings = (settings) => {
      this.settings = settings;
      savePauseSettings(settings);
    };
    const screens = veritableScreens();
    screens.attach(sim);
    bar.screens = SCREENS;
    bar.onScreen = (screen) => {
      screens.toggle(screen as ScreenId);
      bar.setActiveScreen(screens.current());
    };
    screens.addEventListener("screen-changed", () =>
      bar.setActiveScreen(screens.current()),
    );

    const cards = eventCards();
    cards.onChoose = (id, choice) =>
      void this.command({ type: "event-choose", id, choice });
    cards.onVote = (proposal, vote) =>
      void this.command({ type: "bloc-vote", proposal, vote });
    cards.onOpenJournal = () => {
      screens.show("objectives");
      bar.setActiveScreen(screens.current());
    };

    const view = await sim.read();
    if (this.sim !== sim) return; // detached meanwhile
    const nation = view.nations.find((n) => n.id === view.playerNation);
    const label =
      nation === undefined
        ? ""
        : nation.name.kind === "key"
          ? vt(nation.name.key)
          : nation.name.text;
    bar.show(label, view.date, view.speed as Speed);
    // A loaded campaign resumes at the speed it was saved with.
    await this.setSpeed(view.speed as Speed);
    // The decisions already waiting in a loaded campaign do not pause it.
    for (const p of view.events.pending) this.seenDecisions.add(p.id);

    this.unsubscribe = sim.onEvents((events) => {
      for (const event of events) {
        if (event.type === "day-started") bar.setDate(event.date);
        if (event.type === "month-started") void this.autosave(event.date);
        // A decision for the player (J5): its card comes with the next
        // HUD; read it at once.
        if (event.type === "event-popup") void this.pollHud();
      }
    });
    this.hudTimer = setInterval(() => void this.pollHud(), HUD_MS);
    void this.pollHud();
  }

  // The simulation of the running campaign, null outside a campaign.
  remote(): RemoteVeritableSim | null {
    return this.sim;
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.hudTimer !== null) clearInterval(this.hudTimer);
    this.hudTimer = null;
    this.cancelCountdown();
    this.sim = null;
    this.eventBus = null;
    this.paused = false;
    this.journalMark = undefined;
    this.seenDecisions.clear();
    this.markerList = [];
    this.lastAutoPause = null;
    veritablePanel().detach();
    veritableScreens().detach();
    eventCards().clear();
    veritableTopBar().setActiveScreen(null);
    veritableTopBar().hide();
  }

  async setSpeed(speed: Speed): Promise<void> {
    const { sim, eventBus } = this;
    if (sim === null || eventBus === null) return;
    if (speed === 0) {
      if (!this.paused) eventBus.emit(new PauseGameIntentEvent(true));
      this.paused = true;
    } else {
      // LocalServer multiplies the turn interval by this value.
      eventBus.emit(
        new ReplaySpeedChangeEvent((1 / speed) as ReplaySpeedMultiplier),
      );
      if (this.paused) eventBus.emit(new PauseGameIntentEvent(false));
      this.paused = false;
    }
    this.speed = speed;
    veritableTopBar().setSpeed(speed);
    await sim.apply({ type: "set-speed", speed });
  }

  private async command(
    command: Parameters<RemoteVeritableSim["apply"]>[0],
  ): Promise<void> {
    const sim = this.sim;
    if (sim === null) return;
    try {
      await sim.apply(command);
    } catch (error) {
      console.warn("Véritable command refused", error);
    }
    await this.pollHud();
  }

  // The light view, and what it brings: the cards, the date, the pauses.
  private async pollHud(): Promise<void> {
    const sim = this.sim;
    if (sim === null || this.hudBusy) return;
    this.hudBusy = true;
    try {
      const hud = await sim.hud(this.journalMark);
      if (this.sim !== sim) return;
      this.receive(hud);
    } catch {
      // The worker is gone: the game ended.
    } finally {
      this.hudBusy = false;
    }
  }

  // The markers on the map now, and the game date they are read at.
  markers(): readonly MapMarker[] {
    return this.markerList;
  }

  date(): string {
    return this.gameDate;
  }

  // The camera to a tile of the map (an entry of the journal, a marker).
  focus(tile: number): void {
    if (this.eventBus === null || this.mapWidth <= 0) return;
    const x = tile % this.mapWidth;
    const y = Math.floor(tile / this.mapWidth);
    this.eventBus.emit(new GoToPositionEvent(x, y));
  }

  // A click on a marker: the journal on its thread, or its nation.
  openMarker(marker: MapMarker): void {
    const screens = veritableScreens();
    screens.openJournal(
      marker.entry.link !== undefined
        ? { link: marker.entry.link }
        : { nation: marker.entry.nation },
    );
    veritableTopBar().setActiveScreen(screens.current());
  }

  private receive(hud: HudView): void {
    const cards = eventCards();
    const first = this.journalMark === undefined;
    this.journalMark = hud.journalMark;
    this.mapWidth = hud.mapWidth;
    this.gameDate = hud.date;
    this.markerList = this.markerList.filter((m) => m.until >= hud.date);
    veritableTopBar().setDate(hud.date);
    cards.setHud(hud);
    for (const p of hud.pending) {
      if (this.seenDecisions.has(p.id)) continue;
      this.seenDecisions.add(p.id);
      this.autoPause("decision");
    }
    if (first) return;
    for (const entry of hud.journal) {
      const notice = classify(entry, hud);
      this.mark(entry, notice.level);
      // A vote has its own card (from the HUD), with its buttons.
      if (notice.category !== "vote") cards.push(notice);
      if (notice.level === "critical" && notice.category !== null) {
        this.autoPause(notice.category);
      }
    }
  }

  // A marker for an entry with a place that concerns the player or is a
  // major event of the world.
  private mark(entry: JournalEntry, level: NoticeLevel): void {
    if (entry.tile === undefined || this.mapWidth <= 0) return;
    const major = keptForEver(entry, null) && entry.kind !== "note";
    if (level === "log" && !major) return;
    const kind = level === "log" ? "major" : level;
    this.markerList = [
      ...this.markerList,
      {
        entry,
        x: entry.tile % this.mapWidth,
        y: Math.floor(entry.tile / this.mapWidth),
        level: kind,
        until: addDays(
          entry.date,
          kind === "info" ? MARKER_DAYS_INFO : MARKER_DAYS_MAJOR,
        ),
      },
    ];
  }

  private autoPause(category: PauseCategory): void {
    if (this.countdown !== null) return;
    const now = Date.now();
    if (
      !shouldPause(this.settings, category, now, this.lastAutoPause, this.speed)
    ) {
      return;
    }
    this.lastAutoPause = now;
    this.resumeSpeed = this.speed;
    void this.setSpeed(0);
    let left = this.settings.seconds as number;
    const bar = veritableTopBar();
    bar.setCountdown(left);
    window.addEventListener("keydown", this.onKey, true);
    this.countdown = setInterval(() => {
      left -= 1;
      if (left > 0) {
        bar.setCountdown(left);
        return;
      }
      const speed = this.resumeSpeed;
      this.cancelCountdown();
      if (speed !== null && speed !== 0) void this.setSpeed(speed);
    }, 1000);
  }

  // Space during the countdown keeps the pause.
  private onKey = (e: KeyboardEvent): void => {
    if (this.countdown === null || e.code !== "Space") return;
    e.preventDefault();
    e.stopPropagation();
    this.cancelCountdown();
  };

  private cancelCountdown(): void {
    if (this.countdown !== null) clearInterval(this.countdown);
    this.countdown = null;
    this.resumeSpeed = null;
    window.removeEventListener("keydown", this.onKey, true);
    veritableTopBar().setCountdown(null);
  }

  private async autosave(gameDate: string): Promise<void> {
    const sim = this.sim;
    if (sim === null) return;
    try {
      const snap = await sim.snapshot();
      const meta = autosaveMeta(
        snap.gameDate,
        new Date().toISOString(),
        vt("save.autosave-name", { date: gameDate }),
        peekSchemaVersion(snap.bytes),
        snap.bytes.length,
      );
      await writeAutosave(
        this.store,
        meta,
        snap.bytes,
        loadVeritableConfig().save.autosaveSlots,
      );
    } catch (error) {
      console.warn("Véritable autosave failed", error);
    }
  }
}

let controller: CampaignController | null = null;
export function campaignController(): CampaignController {
  controller ??= new CampaignController();
  return controller;
}
