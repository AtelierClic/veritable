import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { vt } from "../data/i18n";
import { SPEEDS } from "../data/schemas/save";

export type Speed = (typeof SPEEDS)[number];

// Top bar of a campaign: played nation, date, speed (pause, x1, x2, x5).
// Functional, ugly on purpose (polish is J7). It only displays and asks: the
// CampaignController owns the simulation handle and the game speed.
@customElement("veritable-topbar")
export class VeritableTopBar extends LitElement {
  @state() private nation = "";
  @state() private date = "";
  @state() private speed: Speed = 1;
  @state() private visible = false;

  onSpeed: (speed: Speed) => void = () => {};
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
  }

  setDate(date: string): void {
    this.date = date;
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
  }

  private formattedDate(): string {
    const [year, month, day] = this.date.split("-").map(Number);
    if (!year) return this.date;
    return new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, day)));
  }

  render() {
    if (!this.visible) return nothing;
    return html`
      <div
        class="fixed top-1 left-1/2 z-[10000] flex -translate-x-1/2 items-center gap-3 rounded border border-gray-500 bg-gray-900/90 px-3 py-1 text-sm text-white"
        style="pointer-events:auto"
      >
        <span class="font-bold text-yellow-300"
          >${vt("topbar.nation", { nation: this.nation })}</span
        >
        <span class="tabular-nums">${this.formattedDate()}</span>
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
                ${speed === 0 ? "⏸" : vt("topbar.speed", { speed })}
              </button>
            `,
          )}
        </span>
        ${this.speed === 0
          ? html`<span class="text-gray-300">${vt("topbar.paused")}</span>`
          : nothing}
        <span class="flex gap-1">
          ${this.screens.map(
            (screen) => html`
              <button
                class="rounded px-2 ${screen === this.activeScreen
                  ? "bg-yellow-600"
                  : "bg-gray-700"}"
                @click=${() => this.onScreen(screen)}
              >
                ${vt(`screen.${screen}.title`)}
              </button>
            `,
          )}
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
