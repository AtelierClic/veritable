import { html, render } from "lit";
import { Controller } from "../../client/Controller";
import type { MapRenderer } from "../../client/render/gl/MapRenderer";
import { TransformHandler } from "../../client/TransformHandler";
import { GameView } from "../../client/view/GameView";
import { Cell } from "../../core/game/Game";
import { dataSource } from "../data/catalog";
import { vt } from "../data/i18n";
import { campaignController } from "./CampaignController";
import type { CityLayerController } from "./CityLayer";
import type { FrontOverlayController } from "./FrontOverlay";
import {
  defaultBloc,
  densityColor,
  MAP_MODES,
  MapColors,
  MapMode,
  MODE_KEYS,
  nationColors,
  Rgb,
} from "./mapModes";
import { MINIMAP_ID } from "./MiniMap";

// The modes of the map on screen (J7b): the colours of the nations written
// into the palette of the renderer of OpenFront (a table indexed by the id
// of each player: a change of mode repaints nothing but that table), the
// density of the people drawn over the map in the population mode, the
// fronts thickened in the wars mode; a bar of buttons with the key of each
// mode, the bloc to show, a legend. The colours are read from the worker
// every two seconds, so that a change of mode applies what is already
// there.

const PALETTE_SIZE = 4096;
const REFRESH_MS = 2000;
const FILL_ALPHA = 150 / 255;
// The density image, at most this wide (the world map: half its tiles).
const DENSITY_MAX_WIDTH = 2100;
// Opacity of the density over the map: the names show through.
const DENSITY_ALPHA = 190;
const BAR_ID = "veritable-map-modes";
const CANVAS_ID = "veritable-density-layer";
// J7c: the keys of the controller of the game in play only (a save loaded
// in the game makes a new one).
let activeKeys: ((e: KeyboardEvent) => void) | null = null;

export class MapModesController implements Controller {
  private mode: MapMode = "political";
  private bloc: string | null = null;
  private colors: MapColors | null = null;
  private smallIds: Record<string, number> = {};
  private readonly palette = new Float32Array(PALETTE_SIZE * 2 * 4);
  private inFlight = false;
  private density: HTMLCanvasElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private lastCamera = "";
  // The time the last change of mode took to apply (ms), for the checks.
  lastSwitchMs = 0;

  constructor(
    private readonly transform: TransformHandler,
    private readonly game: GameView,
    private readonly view: MapRenderer,
    private readonly fronts: FrontOverlayController,
    private readonly cities: CityLayerController,
  ) {}

  init(): void {
    this.legibility();
    if (activeKeys !== null) window.removeEventListener("keydown", activeKeys);
    activeKeys = this.onKey;
    window.addEventListener("keydown", this.onKey);
    document.getElementById(CANVAS_ID)?.remove();
    const canvas = document.createElement("canvas");
    canvas.id = CANVAS_ID;
    Object.assign(canvas.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      display: "none",
    });
    const overlay = document.getElementById("game-input-overlay");
    if (overlay?.parentElement) overlay.after(canvas);
    else document.body.appendChild(canvas);
    this.canvas = canvas;
    const frame = () => {
      if (this.canvas === null || !this.canvas.isConnected) return;
      this.legibility();
      this.drawDensity();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    this.renderBar();
    // The density image is built while the player looks at the map, so
    // that the population mode opens at once.
    window.setTimeout(() => void this.buildDensity(), 4000);
    // Its own clock: the colours follow the campaign even while it is
    // paused.
    void this.refresh();
    window.setInterval(() => void this.refresh(), REFRESH_MS);
  }

  // J7b (legibility): no legacy troop counts under the names, no cosmetic
  // patterns or skins over the nations, no dots of the legacy structures at
  // the scale of the whole map (the cities of the campaign have their
  // layer). Set again at every frame: the renderer of the map is made after
  // the controllers, and remade when its context is lost.
  private legibility(): void {
    const settings = this.view.getSettings();
    if (settings.passEnabled === undefined) return;
    settings.name.troopSizeMultiplier = 0;
    settings.passEnabled.territoryPatterns = false;
    settings.structure.dotScale = 0;
  }

  current(): MapMode {
    return this.mode;
  }

  // The colour of each core player in the mode (the mini-map reads it).
  colorOf(smallID: number): Rgb | null {
    const off = smallID * 4;
    if (this.palette[off + 3] === 0) return null;
    return [
      Math.round(this.palette[off] * 255),
      Math.round(this.palette[off + 1] * 255),
      Math.round(this.palette[off + 2] * 255),
    ];
  }

  private firstBloc(colors: MapColors): string | null {
    const types = new Map(dataSource.blocs().map((b) => [b.id, b.type]));
    return defaultBloc(colors, (id) => types.get(id));
  }

  setMode(mode: MapMode): void {
    const started = performance.now();
    this.mode = mode;
    if (mode === "blocs" && this.bloc === null && this.colors !== null) {
      this.bloc = this.firstBloc(this.colors);
    }
    this.apply();
    this.lastSwitchMs = performance.now() - started;
    this.renderBar();
  }

  private onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (
      target !== null &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const mode = MAP_MODES.find((m) => MODE_KEYS[m] === e.code);
    if (mode === undefined) return;
    e.preventDefault();
    this.setMode(mode);
  };

  private async refresh(): Promise<void> {
    const sim = campaignController().remote();
    if (sim === null || this.inFlight) return;
    this.inFlight = true;
    try {
      const result = await sim.mapColors();
      this.colors = result.colors;
      this.smallIds = result.smallIds;
      this.bloc ??= this.firstBloc(result.colors);
      // The palette of the campaign, again at every refresh: the renderer
      // of the map is made after the controllers and takes the palette of
      // OpenFront (its cosmetics) until then.
      this.apply();
      this.renderBar();
    } catch (error) {
      console.warn("Véritable map modes failed", error);
    } finally {
      this.inFlight = false;
    }
  }

  // The palette of the political map: each player's own colours.
  private politicalPalette(): void {
    this.palette.fill(0);
    for (const p of this.game.players()) {
      write(
        this.palette,
        p.smallID(),
        rgbOf(p.territoryColor().toRgb()),
        rgbOf(p.borderColor().toRgb()),
        FILL_ALPHA,
      );
    }
  }

  private apply(): void {
    this.politicalPalette();
    if (this.mode !== "political" && this.colors !== null) {
      const colors = nationColors(
        this.mode,
        this.colors,
        Object.keys(this.smallIds),
        this.bloc,
      );
      for (const [nation, rgb] of colors ?? []) {
        const id = this.smallIds[nation];
        if (id === undefined) continue;
        write(this.palette, id, rgb, darker(rgb), FILL_ALPHA);
      }
    }
    this.view.updatePalette(this.palette);
    this.fronts.setWide(this.mode === "wars");
    // The cities stay: they read with the density.
    this.cities.setVisible(true);
    if (this.canvas !== null) {
      this.canvas.style.display = this.mode === "population" ? "" : "none";
      this.lastCamera = "";
    }
  }

  // --- the density of the people -----------------------------------------------

  private async buildDensity(): Promise<void> {
    if (this.density !== null) return;
    const id = this.game.config().gameConfig().veritableScenario;
    if (id === undefined) return;
    const grid = await dataSource.population(dataSource.scenario(id));
    if (grid === null) return;
    const step = Math.max(1, Math.ceil(grid.width / DENSITY_MAX_WIDTH));
    const w = Math.ceil(grid.width / step);
    const h = Math.ceil(grid.height / step);
    // The ramp runs from the 5th to the 99.5th percentile of the levels of
    // the land: most of it would sit in one colour between the extremes.
    const histogram = new Uint32Array(256);
    let land = 0;
    for (let i = 0; i < grid.levels.length; i++) {
      if (grid.levels[i] === 0) continue;
      histogram[grid.levels[i]]++;
      land++;
    }
    const percentile = (q: number): number => {
      let seen = 0;
      for (let level = 1; level < 256; level++) {
        seen += histogram[level];
        if (seen >= q * land) return level;
      }
      return 255;
    };
    const low = percentile(0.05);
    const high = Math.max(low + 1, percentile(0.995));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d");
    if (context === null) return;
    const image = context.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // The densest tile of the block.
        let level = 0;
        for (let dy = 0; dy < step; dy++) {
          const ty = y * step + dy;
          if (ty >= grid.height) break;
          for (let dx = 0; dx < step; dx++) {
            const tx = x * step + dx;
            if (tx >= grid.width) break;
            const l = grid.levels[ty * grid.width + tx];
            if (l > level) level = l;
          }
        }
        if (level === 0) continue;
        const rgb = densityColor(
          1 + Math.max(0, level - low),
          Math.max(1, high - low),
        );
        if (rgb === null) continue;
        const o = (y * w + x) * 4;
        image.data[o] = rgb[0];
        image.data[o + 1] = rgb[1];
        image.data[o + 2] = rgb[2];
        image.data[o + 3] = DENSITY_ALPHA;
      }
    }
    context.putImageData(image, 0, 0);
    this.density = canvas;
    this.lastCamera = "";
  }

  private drawDensity(): void {
    const canvas = this.canvas!;
    if (this.mode !== "population") return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    const t = this.transform;
    const origin = t.worldToScreenCoordinates(new Cell(0, 0));
    const camera = `${w}x${h}:${t.scale}:${origin.x}:${origin.y}:${this.density !== null}`;
    if (camera === this.lastCamera) return;
    this.lastCamera = camera;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (this.density === null) {
      void this.buildDensity();
      return;
    }
    const sx = (this.game.width() / this.density.width) * t.scale * dpr;
    const sy = (this.game.height() / this.density.height) * t.scale * dpr;
    ctx.setTransform(sx, 0, 0, sy, dpr * origin.x, dpr * origin.y);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.density, 0, 0);
  }

  // --- the bar -------------------------------------------------------------------

  private renderBar(): void {
    let el = document.getElementById(BAR_ID);
    if (el === null) {
      el = document.createElement("div");
      el.id = BAR_ID;
      el.className =
        "fixed bottom-2 right-2 z-[900] w-64 rounded border border-gray-600 bg-gray-900/90 p-1 text-[11px] text-white";
      document.body.appendChild(el);
    }
    const key = (m: MapMode) => MODE_KEYS[m].replace("Key", "");
    // The time the last change of mode took, for the checks of the J7b.
    el.dataset.switchMs = this.lastSwitchMs.toFixed(1);
    el.dataset.mode = this.mode;
    render(
      html`<canvas
          id=${MINIMAP_ID}
          class="mb-1 w-full cursor-pointer rounded border border-gray-700"
          title=${vt("map.minimap-hint")}
        ></canvas>
        <div class="flex flex-wrap gap-1">
          ${MAP_MODES.map(
            (m) =>
              html`<button
                class="rounded px-1 ${m === this.mode
                  ? "bg-blue-700"
                  : "bg-gray-700 hover:bg-gray-600"}"
                title=${vt(`map.mode.${m}.hint`)}
                @click=${() => this.setMode(m)}
              >
                ${vt(`map.mode.${m}`)}
                <span class="text-gray-400">${key(m)}</span>
              </button>`,
          )}
        </div>
        ${this.mode === "blocs"
          ? html`<select
              class="mt-1 w-full bg-gray-800"
              @change=${(e: Event) => {
                this.bloc = (e.target as HTMLSelectElement).value;
                this.apply();
              }}
            >
              ${(this.colors?.blocs ?? []).map(
                (b) =>
                  html`<option value=${b.id} ?selected=${b.id === this.bloc}>
                    ${vt(`bloc.${b.id}.name`)}
                  </option>`,
              )}
            </select>`
          : ""}
        <div class="mt-1 text-gray-300">
          ${vt(`map.mode.${this.mode}.legend`)}
        </div>`,
      el,
    );
  }
}

function rgbOf(c: { r: number; g: number; b: number }): Rgb {
  return [c.r, c.g, c.b];
}

function darker(rgb: Rgb): Rgb {
  return [
    Math.round(rgb[0] * 0.55),
    Math.round(rgb[1] * 0.55),
    Math.round(rgb[2] * 0.55),
  ];
}

function write(
  palette: Float32Array,
  smallID: number,
  fill: Rgb,
  border: Rgb,
  alpha: number,
): void {
  const f = smallID * 4;
  palette[f] = fill[0] / 255;
  palette[f + 1] = fill[1] / 255;
  palette[f + 2] = fill[2] / 255;
  palette[f + 3] = alpha;
  const b = PALETTE_SIZE * 4 + smallID * 4;
  palette[b] = border[0] / 255;
  palette[b + 1] = border[1] / 255;
  palette[b + 2] = border[2] / 255;
  palette[b + 3] = 1;
}
