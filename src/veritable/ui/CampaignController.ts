import { ReplaySpeedChangeEvent } from "../../client/InputHandler";
import { PauseGameIntentEvent } from "../../client/Transport";
import { ReplaySpeedMultiplier } from "../../client/utilities/ReplaySpeedMultiplier";
import { EventBus } from "../../core/EventBus";
import { RemoteVeritableSim } from "../adapters/RemoteVeritableSim";
import { vt } from "../data/i18n";
import { loadVeritableConfig } from "../data/loadConfig";
import { autosaveMeta, writeAutosave } from "../save/autosave";
import { IndexedDbSaveStore } from "../save/IndexedDbSaveStore";
import { SaveStore } from "../save/SaveStore";
import { peekSchemaVersion } from "../save/serialize";
import { veritablePanel } from "./VeritablePanel";
import { ScreenId, SCREENS, veritableScreens } from "./VeritableScreens";
import { Speed, veritableTopBar } from "./VeritableTopBar";

// Glue between a running campaign (the simulation in the game worker) and the
// Véritable screens: top bar, campaign panel, monthly automatic save.
//
// Speed: the campaign clock is the OpenFront tick (72 game minutes each), so
// pause / x1 / x2 / x5 drive the solo turn loop of LocalServer: military time
// and calendar accelerate together.
export class CampaignController {
  private unsubscribe: (() => void) | null = null;
  private sim: RemoteVeritableSim | null = null;
  private eventBus: EventBus | null = null;
  private paused = false;

  constructor(private readonly store: SaveStore = new IndexedDbSaveStore()) {}

  async attach(sim: RemoteVeritableSim, eventBus: EventBus): Promise<void> {
    this.detach();
    this.sim = sim;
    this.eventBus = eventBus;
    veritablePanel().attach(sim);

    const bar = veritableTopBar();
    bar.onSpeed = (speed) => void this.setSpeed(speed);
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

    this.unsubscribe = sim.onEvents((events) => {
      for (const event of events) {
        if (event.type === "day-started") bar.setDate(event.date);
        if (event.type === "month-started") void this.autosave(event.date);
      }
    });
  }

  // The simulation of the running campaign, null outside a campaign.
  remote(): RemoteVeritableSim | null {
    return this.sim;
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.sim = null;
    this.eventBus = null;
    this.paused = false;
    veritablePanel().detach();
    veritableScreens().detach();
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
    veritableTopBar().setSpeed(speed);
    await sim.apply({ type: "set-speed", speed });
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
