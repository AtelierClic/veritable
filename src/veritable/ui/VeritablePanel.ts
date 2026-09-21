import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { RemoteVeritableSim } from "../adapters/RemoteVeritableSim";
import { gameStartInfoFromSave } from "../adapters/soloConfig";
import { hasTextKey, vt } from "../data/i18n";
import { NationState } from "../data/schemas/save";
import { IndexedDbSaveStore } from "../save/IndexedDbSaveStore";
import { SaveMeta, SaveStore } from "../save/SaveStore";
import { peekSchemaVersion, SAVE_FILE_EXTENSION } from "../save/serialize";
import { ReadonlyWorldView } from "../sim/VeritableSim";
import {
  newCampaignStartInfo,
  ScenarioChoice,
  scenarioChoices,
} from "./newCampaign";

const REFRESH_MS = 1000;
const JOURNAL_LINES = 8;

// J0 screen: functional, ugly on purpose (polish is J7). Campaign date, nations
// with their tile count and status, journal, and save / load / export / import.
// In the main menu (no campaign attached) it only lists and loads saves.
@customElement("veritable-panel")
export class VeritablePanel extends LitElement {
  @state() private open = false;
  @state() private view: ReadonlyWorldView | null = null;
  @state() private saves: SaveMeta[] = [];
  @state() private status = "";
  @state() private saveName = "";
  @state() private scenarioId = "";
  @state() private nationId = "";

  private readonly scenarios: ScenarioChoice[] = scenarioChoices();

  private sim: RemoteVeritableSim | null = null;
  private store: SaveStore = new IndexedDbSaveStore();
  private timer: ReturnType<typeof setInterval> | null = null;

  createRenderRoot() {
    return this;
  }

  attach(sim: RemoteVeritableSim): void {
    this.sim = sim;
    this.view = null;
    void this.refresh();
  }

  detach(): void {
    this.sim = null;
    this.view = null;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.timer = setInterval(() => {
      if (this.open) void this.refresh();
    }, REFRESH_MS);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.timer !== null) clearInterval(this.timer);
  }

  private async refresh(): Promise<void> {
    try {
      if (this.sim !== null) this.view = await this.sim.read();
    } catch {
      this.view = null; // worker gone: the game ended
    }
  }

  private async refreshSaves(): Promise<void> {
    try {
      this.saves = await this.store.list();
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    // Adapters report known failures as i18n keys.
    this.status = hasTextKey(message)
      ? vt(message)
      : vt("save.status.error", { message });
  }

  private currentScenario(): ScenarioChoice | undefined {
    return (
      this.scenarios.find((s) => s.id === this.scenarioId) ?? this.scenarios[0]
    );
  }

  // Starting = joining a solo lobby with the GameStartInfo of the campaign.
  private startCampaign(): void {
    const scenario = this.currentScenario();
    if (scenario === undefined) return;
    const nation = scenario.nations.some((n) => n.id === this.nationId)
      ? this.nationId
      : scenario.playerDefault;
    try {
      const gameStartInfo = newCampaignStartInfo(
        scenario.id,
        nation,
        Date.now(),
      );
      this.open = false;
      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: gameStartInfo.gameID,
            gameStartInfo,
            source: "singleplayer",
          },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      this.fail(error);
    }
  }

  private renderNewCampaign() {
    const scenario = this.currentScenario();
    if (scenario === undefined) return nothing;
    const selected = scenario.nations.some((n) => n.id === this.nationId)
      ? this.nationId
      : scenario.playerDefault;
    return html`
      <div class="font-bold">${vt("start.title")}</div>
      <label class="mt-1 block text-gray-300">${vt("start.scenario")}</label>
      <select
        class="w-full rounded bg-gray-700 px-1"
        @change=${(e: Event) => {
          this.scenarioId = (e.target as HTMLSelectElement).value;
          this.nationId = "";
        }}
      >
        ${this.scenarios.map(
          (s) =>
            html`<option value=${s.id} ?selected=${s.id === scenario.id}>
              ${s.label}
            </option>`,
        )}
      </select>
      <label class="mt-1 block text-gray-300">${vt("start.nation")}</label>
      <select
        class="w-full rounded bg-gray-700 px-1"
        @change=${(e: Event) =>
          (this.nationId = (e.target as HTMLSelectElement).value)}
      >
        ${scenario.nations.map(
          (n) =>
            html`<option value=${n.id} ?selected=${n.id === selected}>
              ${n.label}
            </option>`,
        )}
      </select>
      <button
        class="mt-1 w-full rounded bg-blue-700 px-2"
        @click=${() => this.startCampaign()}
      >
        ${vt("start.begin")}
      </button>
    `;
  }

  private toggle(): void {
    this.open = !this.open;
    if (this.open) {
      void this.refresh();
      void this.refreshSaves();
    }
  }

  private async snapshotWithMeta() {
    if (this.sim === null) throw new Error("no campaign");
    const snap = await this.sim.snapshot();
    const name =
      this.saveName.trim() || vt("save.default-name", { date: snap.gameDate });
    const meta: SaveMeta = {
      id: `${Date.now().toString(36)}-${snap.gameDate}`,
      name,
      kind: "manual",
      gameDate: snap.gameDate,
      savedAt: new Date().toISOString(),
      schemaVersion: peekSchemaVersion(snap.bytes),
      sizeBytes: snap.bytes.length,
    };
    return { snap, meta };
  }

  private async save(): Promise<void> {
    try {
      const { snap, meta } = await this.snapshotWithMeta();
      await this.store.put(meta, snap.bytes);
      this.status = vt("save.status.saved", { name: meta.name });
      this.saveName = "";
      await this.refreshSaves();
    } catch (error) {
      this.fail(error);
    }
  }

  private async exportFile(): Promise<void> {
    try {
      const { snap, meta } = await this.snapshotWithMeta();
      const fileName = `veritable-${meta.gameDate}${SAVE_FILE_EXTENSION}`;
      const blob = new Blob([snap.bytes as BlobPart], {
        type: "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      this.status = vt("save.status.exported", { name: fileName });
    } catch (error) {
      this.fail(error);
    }
  }

  private async importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file === undefined) return;
    try {
      this.load(new Uint8Array(await file.arrayBuffer()), file.name);
    } catch (error) {
      this.fail(error);
    }
  }

  private async loadStored(meta: SaveMeta): Promise<void> {
    try {
      const bytes = await this.store.get(meta.id);
      if (bytes === undefined) throw new Error(meta.name);
      this.load(bytes, meta.name);
    } catch (error) {
      this.fail(error);
    }
  }

  // Loading = starting the core game the save was made in, with the save to
  // restore. Main's join-lobby handler stops the running game first.
  private load(bytes: Uint8Array, name: string): void {
    const gameStartInfo = gameStartInfoFromSave(bytes); // validates the file
    this.status = vt("save.status.loading", { name });
    this.open = false;
    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: gameStartInfo.gameID,
          gameStartInfo,
          veritableSave: bytes,
          source: "singleplayer",
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async deleteStored(meta: SaveMeta): Promise<void> {
    try {
      await this.store.delete(meta.id);
      await this.refreshSaves();
    } catch (error) {
      this.fail(error);
    }
  }

  private nationLabel(n: Readonly<NationState>): string {
    return n.name.kind === "key" ? vt(n.name.key) : n.name.text;
  }

  private renderCampaign(view: ReadonlyWorldView) {
    const nations = [...view.nations].sort(
      (a, b) =>
        Number(b.isPlayer) - Number(a.isPlayer) || b.tileCount - a.tileCount,
    );
    return html`
      <div class="font-bold">${vt("save.panel.date", { date: view.date })}</div>
      <div class="mt-2 font-bold">
        ${vt("save.panel.nations", { count: nations.length })}
      </div>
      <div class="max-h-40 overflow-y-auto">
        ${nations.map(
          (n) => html`
            <div class="flex justify-between gap-2">
              <span class=${n.isPlayer ? "text-yellow-300" : ""}
                >${this.nationLabel(n)}</span
              >
              <span class="text-gray-300"
                >${vt("save.panel.tiles", { count: n.tileCount })} ·
                ${vt(`nation.status.${n.status}`)}</span
              >
            </div>
          `,
        )}
      </div>
      <div class="mt-2 font-bold">${vt("save.panel.journal")}</div>
      <div class="max-h-24 overflow-y-auto text-gray-300">
        ${view.journal.slice(-JOURNAL_LINES).map((entry) => {
          const nation = view.nations.find((n) => n.id === entry.nation);
          const params: Record<string, string> = {
            nation: nation ? this.nationLabel(nation) : "",
          };
          for (const [k, v] of Object.entries(entry.params)) {
            params[k] =
              k === "from" || k === "to" ? vt(`nation.status.${v}`) : v;
          }
          return html`<div>
            ${entry.date} — ${vt(`journal.${entry.kind}`, params)}
          </div>`;
        })}
      </div>
      <div class="mt-2 flex gap-1">
        <input
          class="min-w-0 flex-1 rounded bg-gray-700 px-1"
          .value=${this.saveName}
          placeholder=${vt("save.panel.name.placeholder")}
          @input=${(e: Event) =>
            (this.saveName = (e.target as HTMLInputElement).value)}
          @keydown=${(e: Event) => e.stopPropagation()}
        />
        <button class="rounded bg-blue-700 px-2" @click=${() => this.save()}>
          ${vt("save.panel.save")}
        </button>
      </div>
      <button
        class="mt-1 w-full rounded bg-gray-700 px-2"
        @click=${() => this.exportFile()}
      >
        ${vt("save.panel.export")}
      </button>
    `;
  }

  render() {
    return html`
      <div
        class="fixed bottom-2 left-2 z-[10000] text-xs text-white"
        style="pointer-events:auto"
      >
        ${this.open
          ? html`
              <div
                class="mb-1 w-80 rounded border border-gray-500 bg-gray-900/95 p-2"
              >
                <div class="mb-1 text-sm font-bold">
                  ${vt("app.name")} — ${vt("save.panel.title")}
                </div>
                ${this.view !== null
                  ? this.renderCampaign(this.view)
                  : this.renderNewCampaign()}
                <label
                  class="mt-1 block w-full cursor-pointer rounded bg-gray-700 px-2 text-center"
                >
                  ${vt("save.panel.import")}
                  <input
                    type="file"
                    accept=${SAVE_FILE_EXTENSION}
                    class="hidden"
                    @change=${(e: Event) => this.importFile(e)}
                  />
                </label>
                <div class="mt-2 font-bold">${vt("save.panel.saves")}</div>
                <div class="max-h-32 overflow-y-auto">
                  ${this.saves.length === 0
                    ? html`<div class="text-gray-400">
                        ${vt("save.panel.empty")}
                      </div>`
                    : this.saves.map(
                        (meta) => html`
                          <div class="flex items-center justify-between gap-1">
                            <span class="truncate" title=${meta.savedAt}
                              >[${vt(`save.kind.${meta.kind}`)}] ${meta.name}
                              (${Math.ceil(meta.sizeBytes / 1024)} ko)</span
                            >
                            <span class="flex shrink-0 gap-1">
                              <button
                                class="rounded bg-green-700 px-1"
                                @click=${() => this.loadStored(meta)}
                              >
                                ${vt("save.panel.load")}
                              </button>
                              <button
                                class="rounded bg-red-800 px-1"
                                @click=${() => this.deleteStored(meta)}
                              >
                                ${vt("save.panel.delete")}
                              </button>
                            </span>
                          </div>
                        `,
                      )}
                </div>
                ${this.status
                  ? html`<div class="mt-1 text-gray-300">${this.status}</div>`
                  : nothing}
              </div>
            `
          : nothing}
        <button
          class="rounded border border-gray-500 bg-gray-900/90 px-2 py-1"
          @click=${() => this.toggle()}
        >
          ${vt("save.panel.toggle")}
        </button>
      </div>
    `;
  }
}

// The single panel of the page, created on first use.
export function veritablePanel(): VeritablePanel {
  let panel = document.querySelector(
    "veritable-panel",
  ) as VeritablePanel | null;
  if (panel === null) {
    panel = document.createElement("veritable-panel") as VeritablePanel;
    document.body.appendChild(panel);
  }
  return panel;
}
