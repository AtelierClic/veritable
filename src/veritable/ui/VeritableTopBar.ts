import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { vt } from "../data/i18n";
import { SPEEDS } from "../data/schemas/save";
import { longDate } from "./format";
import { PAUSE_CATEGORIES, PauseCategory, PauseSettings } from "./notices";

export type Speed = (typeof SPEEDS)[number];

// Top bar of a campaign: played nation, date, speed (pause, x1, x2, x5).
// Functional, ugly on purpose (polish is J7). It only displays and asks: the
// CampaignController owns the simulation handle and the game speed. J7: the
// countdown of an automatic pause on the speed control, and the settings of
// the automatic pauses.
@customElement("veritable-topbar")
export class VeritableTopBar extends LitElement {
  @state() private nation = "";
  @state() private date = "";
  @state() private speed: Speed = 1;
  @state() private visible = false;
  @state() private countdown: number | null = null;
  @state() private settingsOpen = false;
  @state() private settings: PauseSettings | null = null;

  onSpeed: (speed: Speed) => void = () => {};
  onSettings: (settings: PauseSettings) => void = () => {};
  // Screens of the campaign, opened from the bar.
  screens: readonly string[] = [];
  onScreen: (screen: string) => void = () => {};
  @state() private activeScreen: string | null = null;

  setActiveScreen(screen: string | null): void {
    this.activeScreen = screen;
  }

  createRenderRoot() {
    return this;
  }

  show(nation: string, date: string, speed: Speed): void {
    this.nation = nation;
    this.date = date;
    this.speed = speed;
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
    this.countdown = null;
    this.settingsOpen = false;
  }

  setDate(date: string): void {
    this.date = date;
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
  }

  // Seconds before the game resumes after an automatic pause; null: none.
  setCountdown(seconds: number | null): void {
    this.countdown = seconds;
  }

  setSettings(settings: PauseSettings): void {
    this.settings = settings;
  }

  private changeSettings(change: (s: PauseSettings) => void): void {
    if (this.settings === null) return;
    const next = structuredClone(this.settings);
    change(next);
    this.settings = next;
    this.onSettings(next);
  }

  private renderSettings() {
    const s = this.settings;
    if (!this.settingsOpen || s === null) return nothing;
    return html`<div
      class="absolute top-full right-0 mt-1 w-[24rem] rounded border border-gray-500 bg-gray-900/95 p-2 text-xs"
    >
      <div class="mb-1 font-bold">${vt("pause.settings.title")}</div>
      <div class="mb-1 flex items-center gap-1">
        <span>${vt("pause.settings.duration")}</span>
        ${([0, 3, 5] as const).map(
          (seconds) =>
            html`<button
              class="rounded px-2 ${s.seconds === seconds
                ? "bg-blue-600"
                : "bg-gray-700"}"
              @click=${() =>
                this.changeSettings((x) => {
                  x.seconds = seconds;
                })}
            >
              ${seconds === 0
                ? vt("pause.settings.none")
                : vt("pause.settings.seconds", { seconds })}
            </button>`,
        )}
      </div>
      ${PAUSE_CATEGORIES.map(
        (c: PauseCategory) =>
          html`<label class="flex items-center gap-1">
            <input
              type="checkbox"
              .checked=${s.categories[c]}
              @change=${() =>
                this.changeSettings((x) => {
                  x.categories[c] = !x.categories[c];
                })}
            />
            ${vt(`pause.category.${c}`)}
          </label>`,
      )}
    </div>`;
  }

  render() {
    if (!this.visible) return nothing;
    return html`
      <div
        class="fixed top-1 left-1/2 z-[10000] flex max-w-[98vw] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded border border-gray-500 bg-gray-900/90 px-3 py-1 text-sm text-white"
        style="pointer-events:auto"
      >
        <span class="font-bold text-yellow-300"
          >${vt("topbar.nation", { nation: this.nation })}</span
        >
        <span class="w-32 text-center whitespace-nowrap tabular-nums"
          >${longDate(this.date)}</span
        >
        <span class="flex gap-1">
          ${SPEEDS.map(
            (speed) => html`
              <button
                class="rounded px-2 ${speed === this.speed
                  ? "bg-blue-600"
                  : "bg-gray-700"}"
                title=${speed === 0 ? vt("topbar.pause") : ""}
                @click=${() => this.onSpeed(speed)}
              >
                ${speed === 0
                  ? this.countdown === null
                    ? "⏸"
                    : `⏸ ${this.countdown}`
                  : vt("topbar.speed", { speed })}
              </button>
            `,
          )}
        </span>
        <span
          class="w-28 whitespace-nowrap text-xs ${this.countdown !== null
            ? "text-yellow-200"
            : "text-gray-300"}"
          title=${this.countdown !== null ? vt("topbar.space-keeps") : ""}
          >${this.countdown !== null
            ? vt("topbar.resume-in", { seconds: this.countdown })
            : this.speed === 0
              ? vt("topbar.paused")
              : ""}</span
        >
        <span class="flex flex-wrap justify-center gap-1">
          ${this.screens.map(
            (screen) => html`
              <button
                class="rounded px-1.5 text-xs whitespace-nowrap ${screen ===
                this.activeScreen
                  ? "bg-yellow-600"
                  : "bg-gray-700"}"
                @click=${() => this.onScreen(screen)}
              >
                ${vt(`screen.${screen}.title`)}
              </button>
            `,
          )}
        </span>
        <span class="relative">
          <button
            class="rounded bg-gray-700 px-2"
            title=${vt("topbar.settings")}
            @click=${() => (this.settingsOpen = !this.settingsOpen)}
          >
            ⚙
          </button>
          ${this.renderSettings()}
        </span>
      </div>
    `;
  }
}

export function veritableTopBar(): VeritableTopBar {
  let bar = document.querySelector(
    "veritable-topbar",
  ) as VeritableTopBar | null;
  if (bar === null) {
    bar = document.createElement("veritable-topbar") as VeritableTopBar;
    document.body.appendChild(bar);
  }
  return bar;
}
