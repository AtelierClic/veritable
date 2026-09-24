import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { loadBorders, loadScenario } from "../data/catalog";
import { vt } from "../data/i18n";
import { TILE_NATION_MASK } from "../data/schemas/saveV1";
import { fold, geographyOf } from "./nationFilter";

// The choice of the nation to play (J6c): a small map of the scenario to
// click on, and the list of its nations with a search. Emits
// "nation-picked" with the nation id as detail.

const MAP_WIDTH = 300;

interface MiniMap {
  scenario: string;
  width: number;
  height: number;
  cells: Uint16Array; // nation index + 1 of each cell, 0 = none
  nations: readonly string[];
}

@customElement("veritable-nation-picker")
export class NationPicker extends LitElement {
  @property() scenarioId = "";
  @property({ attribute: false }) nations: { id: string; label: string }[] = [];
  @property() selected = "";
  @state() private search = "";
  private map: MiniMap | null = null;
  private loading = "";

  createRenderRoot() {
    return this;
  }

  private pick(id: string): void {
    this.dispatchEvent(
      new CustomEvent("nation-picked", {
        detail: id,
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    const query = fold(this.search.trim());
    const shown = this.nations
      .filter((n) => query === "" || fold(n.label).includes(query))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
    const selected = this.nations.find((n) => n.id === this.selected);
    const where = selected === undefined ? null : geographyOf(selected.id);
    return html`
      <canvas
        class="mt-1 w-full cursor-crosshair rounded border border-gray-700"
        width=${MAP_WIDTH}
        height="150"
        title=${vt("start.map-hint")}
        @click=${(e: MouseEvent) => this.onMapClick(e)}
      ></canvas>
      <div class="text-gray-300">
        ${selected === undefined
          ? nothingText()
          : html`<b>${selected.label}</b>${where === null
                ? ""
                : ` — ${vt(`world-region.${where.subregion}`)}`}`}
      </div>
      <input
        class="mt-1 w-full rounded bg-gray-700 px-1"
        .value=${this.search}
        placeholder=${vt("filter.search")}
        @input=${(e: Event) =>
          (this.search = (e.target as HTMLInputElement).value)}
      />
      <div class="mt-1 max-h-32 overflow-y-auto">
        ${shown.map(
          (n) =>
            html`<button
              class="block w-full rounded px-1 text-left ${n.id ===
              this.selected
                ? "bg-blue-800"
                : "hover:bg-gray-700"}"
              @click=${() => this.pick(n.id)}
            >
              ${n.label}
            </button>`,
        )}
      </div>
    `;
  }

  updated(): void {
    void this.draw();
  }

  private async draw(): Promise<void> {
    const canvas = this.querySelector("canvas");
    if (canvas === null || this.scenarioId === "") return;
    if (this.map?.scenario !== this.scenarioId) {
      if (this.loading === this.scenarioId) return;
      this.loading = this.scenarioId;
      try {
        this.map = await miniMap(this.scenarioId);
      } finally {
        this.loading = "";
      }
    }
    const map = this.map;
    if (map === null) return;
    if (canvas.height !== map.height) canvas.height = map.height;
    const context = canvas.getContext("2d");
    if (context === null) return;
    const image = context.createImageData(map.width, map.height);
    const chosen = map.nations.indexOf(this.selected) + 1;
    for (let i = 0; i < map.cells.length; i++) {
      const cell = map.cells[i];
      const [r, g, b] =
        cell === 0
          ? [18, 28, 46]
          : cell === chosen
            ? [255, 224, 90]
            : colorOf(cell);
      image.data[i * 4] = r;
      image.data[i * 4 + 1] = g;
      image.data[i * 4 + 2] = b;
      image.data[i * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }

  private onMapClick(e: MouseEvent): void {
    const map = this.map;
    const canvas = e.currentTarget as HTMLCanvasElement;
    if (map === null || canvas.clientWidth === 0) return;
    const x = Math.floor((e.offsetX * map.width) / canvas.clientWidth);
    const y = Math.floor((e.offsetY * map.height) / canvas.clientHeight);
    const cell = map.cells[y * map.width + x] ?? 0;
    if (cell === 0) return;
    const id = map.nations[cell - 1];
    if (this.nations.some((n) => n.id === id)) this.pick(id);
  }
}

function nothingText(): string {
  return vt("start.map-hint");
}

// The borders of the scenario sampled on a grid MAP_WIDTH wide.
async function miniMap(scenarioId: string): Promise<MiniMap> {
  const borders = await loadBorders(loadScenario(scenarioId));
  const width = MAP_WIDTH;
  const height = Math.max(
    1,
    Math.round((width * borders.height) / borders.width),
  );
  const cells = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    const ty = Math.floor((y * borders.height) / height);
    for (let x = 0; x < width; x++) {
      const tx = Math.floor((x * borders.width) / width);
      cells[y * width + x] =
        borders.tiles[ty * borders.width + tx] & TILE_NATION_MASK;
    }
  }
  return {
    scenario: scenarioId,
    width,
    height,
    cells,
    nations: borders.nations,
  };
}

// A stable color per nation index (golden angle on the hue).
function colorOf(index: number): [number, number, number] {
  const hue = (index * 137.508) % 360;
  const s = 0.45;
  const l = 0.42;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [
    Math.round(f(0) * 255),
    Math.round(f(8) * 255),
    Math.round(f(4) * 255),
  ];
}
