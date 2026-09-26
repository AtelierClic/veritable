import { html, render } from "lit";
import { Controller } from "../../client/Controller";
import { MouseUpEvent } from "../../client/InputHandler";
import { TransformHandler } from "../../client/TransformHandler";
import { EventBus } from "../../core/EventBus";
import { Cell } from "../../core/game/Game";
import type { MapOverlay } from "../adapters/CoreBridge";
import { MapOverlayResult } from "../adapters/protocol";
import { vt } from "../data/i18n";
import { loadVeritableConfig } from "../data/loadConfig";
import { NationId } from "../data/schemas/common";
import { FrontView, SegmentView } from "../sim/VeritableSim";
import { campaignController, MapMarker } from "./CampaignController";
import {
  attackRatioSeen,
  contactSource,
  shown,
  SideSeen,
  sideSeenWith,
} from "./intel";

// The fronts on the map (J5), for the campaign only: the line of every
// segment, coloured by who advances and how wide the margin is, the force
// ratio at the middle of each segment, the contested tiles hatched, and a
// click on a segment opens the breakdown of its factors.
//
// Drawn on a transparent 2D canvas over the WebGL map (pointer events go
// through it); redrawn when the camera moves or the data changes. The data
// comes from the worker once a second.

const CANVAS_ID = "veritable-front-overlay";
const PANEL_ID = "veritable-segment-panel";
const LEGEND_ID = "veritable-front-legend";
const REFRESH_MS = 1000;

const COLORS = {
  youAdvance: "rgba(74, 222, 128, 0.95)",
  enemyAdvances: "rgba(248, 113, 113, 0.95)",
  youContained: "rgba(250, 204, 21, 0.9)",
  enemyContained: "rgba(251, 146, 60, 0.9)",
  aAdvances: "rgba(96, 165, 250, 0.9)",
  bAdvances: "rgba(192, 132, 252, 0.9)",
  quiet: "rgba(235, 235, 235, 0.95)",
};

const NUMBER = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const INTEGER = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

function nationName(id: NationId): string {
  return vt(`nation.${id.toLowerCase()}.name`);
}

// Style of a segment line, from the player's side of it.
export function segmentStyle(
  front: FrontView,
  segment: SegmentView,
  player: NationId | null,
  threshold: number,
): { color: string; width: number; dashed: boolean } {
  const attacker = segment.attacker;
  if (attacker === null) return { color: COLORS.quiet, width: 2, dashed: true };
  const advancing = segment.attackRatio > threshold;
  const width = advancing
    ? 3 + Math.min(5, 2.5 * (segment.attackRatio - threshold))
    : 2.5;
  const mine = player === front.a || player === front.b;
  if (mine) {
    const own = attacker === player;
    const color = own
      ? advancing
        ? COLORS.youAdvance
        : COLORS.youContained
      : advancing
        ? COLORS.enemyAdvances
        : COLORS.enemyContained;
    return { color, width, dashed: false };
  }
  if (!advancing) return { color: COLORS.quiet, width: 2, dashed: false };
  const color = attacker === front.a ? COLORS.aAdvances : COLORS.bAdvances;
  return { color, width, dashed: false };
}

// Distance from p to the segment [a, b].
function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t =
    length2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const MARKER_PERIOD_MS = 1400;
const MARKER_RADIUS = 5;
const MARKER_COLORS: Record<MapMarker["level"], string> = {
  critical: "#ef4444",
  info: "#f59e0b",
  major: "#a855f7",
};

export class FrontOverlayController implements Controller {
  private canvas: HTMLCanvasElement | null = null;
  private hatch: HTMLCanvasElement | null = null;
  private data: MapOverlayResult | null = null;
  private contestedVersion = -1;
  private inFlight = false;
  private dirty = true;
  private lastCamera = "";
  private selected: { front: string; segment: number } | null = null;
  private readonly threshold = loadVeritableConfig().war.advanceThreshold;

  constructor(
    private readonly eventBus: EventBus,
    private readonly transform: TransformHandler,
  ) {}

  init(): void {
    document.getElementById(CANVAS_ID)?.remove();
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(LEGEND_ID)?.remove();
    const canvas = document.createElement("canvas");
    canvas.id = CANVAS_ID;
    Object.assign(canvas.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
    });
    const overlay = document.getElementById("game-input-overlay");
    if (overlay?.parentElement) overlay.after(canvas);
    else document.body.appendChild(canvas);
    this.canvas = canvas;
    this.eventBus.on(MouseUpEvent, (e) => this.onClick(e.x, e.y));
    window.addEventListener("resize", () => (this.dirty = true));
    const frame = () => {
      if (this.canvas === null || !this.canvas.isConnected) return;
      this.draw();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  getTickIntervalMs(): number {
    return REFRESH_MS;
  }

  tick(): void {
    const sim = campaignController().remote();
    if (sim === null) {
      this.data = null;
      this.dirty = true;
      return;
    }
    if (this.inFlight) return;
    this.inFlight = true;
    sim
      .mapOverlay(this.contestedVersion)
      .then((result) => this.receive(result))
      .catch((error) => console.warn("Véritable front overlay failed", error))
      .finally(() => (this.inFlight = false));
  }

  private receive(result: MapOverlayResult): void {
    if (result.overlay.contested !== null) {
      this.updateHatch(result.overlay);
      this.contestedVersion = result.overlay.contestedVersion;
    }
    this.data = result;
    this.dirty = true;
    this.renderLegend();
    this.renderPanel();
  }

  // The contested tiles, hatched, at one pixel per tile, drawn scaled with
  // the camera. The canvas and its pixels are kept: an update clears the
  // tiles of the last one and paints the new ones, and only the box that
  // changed is sent back to the canvas (a war changes it every second).
  private hatchImage: ImageData | null = null;
  private hatchTiles: Uint32Array = new Uint32Array(0);

  private updateHatch(overlay: MapOverlay): void {
    const tiles = overlay.contested ?? new Uint32Array(0);
    const { width, height } = overlay;
    if (
      this.hatch === null ||
      this.hatch.width !== width ||
      this.hatch.height !== height
    ) {
      this.hatch = document.createElement("canvas");
      this.hatch.width = width;
      this.hatch.height = height;
      this.hatchImage = null;
      this.hatchTiles = new Uint32Array(0);
    }
    const ctx = this.hatch.getContext("2d");
    if (ctx === null) return;
    this.hatchImage ??= ctx.createImageData(width, height);
    const px = this.hatchImage.data;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    const touch = (tile: number) => {
      const x = tile % width;
      const y = (tile - x) / width;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      return (x + y) % 4 === 0;
    };
    for (const tile of this.hatchTiles) {
      touch(tile);
      px[tile * 4 + 3] = 0;
    }
    for (const tile of tiles) {
      const stripe = touch(tile);
      const i = tile * 4;
      px[i] = stripe ? 20 : 255;
      px[i + 1] = stripe ? 20 : 255;
      px[i + 2] = stripe ? 20 : 255;
      px[i + 3] = stripe ? 150 : 40;
    }
    this.hatchTiles = tiles;
    if (x1 >= 0) {
      ctx.putImageData(this.hatchImage, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    }
  }

  private draw(): void {
    const canvas = this.canvas!;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    const t = this.transform;
    const origin = t.worldToScreenCoordinates(new Cell(0, 0));
    const camera = `${w}x${h}:${t.scale}:${origin.x}:${origin.y}`;
    // J7: markers pulse, the canvas is drawn every frame while there are.
    const markers = campaignController().markers();
    if (!this.dirty && camera === this.lastCamera && markers.length === 0) {
      return;
    }
    this.dirty = false;
    this.lastCamera = camera;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.drawMarkers(ctx, dpr, origin, markers);
    const data = this.data;
    if (data === null) return;
    const s = t.scale;
    // World coordinates (tiles) to device pixels.
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * origin.x, dpr * origin.y);
    if (this.hatch !== null && this.hatchTiles.length > 0) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.hatch, 0, 0);
    }
    const geometry = new Map(data.overlay.fronts.map((f) => [f.id, f]));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const labels: { x: number; y: number; text: string; color: string }[] = [];
    const source = contactSource(data.intel);
    for (const front of data.fronts) {
      const lines = geometry.get(front.id);
      if (lines === undefined) continue;
      for (const segment of front.segments) {
        const line = lines.segments.find((l) => l.index === segment.index);
        if (line === undefined || line.points.length < 2) continue;
        const style = segmentStyle(front, segment, data.player, this.threshold);
        const selected =
          this.selected?.front === front.id &&
          this.selected.segment === segment.index;
        const width = style.width + (selected ? 3 : 0);
        ctx.beginPath();
        ctx.moveTo(line.points[0], line.points[1]);
        for (let i = 2; i < line.points.length; i += 2) {
          ctx.lineTo(line.points[i], line.points[i + 1]);
        }
        // A dark casing under the colour, so the line reads on any land.
        ctx.setLineDash([]);
        ctx.strokeStyle = selected
          ? "rgba(255, 255, 255, 0.9)"
          : "rgba(15, 23, 42, 0.7)";
        ctx.lineWidth = (width + 3) / s;
        ctx.stroke();
        ctx.strokeStyle = style.color;
        ctx.lineWidth = width / s;
        ctx.setLineDash(style.dashed ? [6 / s, 5 / s] : []);
        ctx.stroke();
        if (segment.attacker !== null) {
          // J7b: the ratio as the player's intelligence sees it.
          const seenRatio = attackRatioSeen(source, data.player, segment);
          labels.push({
            x: line.mid[0],
            y: line.mid[1],
            text: vt("map.front.ratio", {
              nation: segment.attacker,
              ratio:
                seenRatio === null
                  ? NUMBER.format(segment.attackRatio)
                  : shown(seenRatio, (v) => NUMBER.format(v)),
            }),
            color: style.color,
          });
        }
      }
    }
    ctx.setLineDash([]);
    // Labels in screen space, only when segments are far enough apart.
    if (s < 0.35) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const label of labels) {
      const x = origin.x + label.x * s;
      const y = origin.y + label.y * s;
      const width = ctx.measureText(label.text).width + 8;
      ctx.fillStyle = "rgba(17, 24, 39, 0.8)";
      ctx.fillRect(x - width / 2, y - 8, width, 16);
      ctx.strokeStyle = label.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - width / 2, y - 8, width, 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(label.text, x, y + 0.5);
    }
  }

  // Pulsing rings at the places of the latest events (J7): red what
  // concerns the player critically, amber its news, violet the major events
  // of the world.
  private drawMarkers(
    ctx: CanvasRenderingContext2D,
    dpr: number,
    origin: { x: number; y: number },
    markers: readonly MapMarker[],
  ): void {
    if (markers.length === 0) return;
    const s = this.transform.scale;
    const phase = (performance.now() % MARKER_PERIOD_MS) / MARKER_PERIOD_MS;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const m of markers) {
      const x = origin.x + (m.x + 0.5) * s;
      const y = origin.y + (m.y + 0.5) * s;
      const color = MARKER_COLORS[m.level];
      ctx.beginPath();
      ctx.arc(x, y, MARKER_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, MARKER_RADIUS + 10 * phase, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 1 - phase;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // The marker under a click of the screen, if any.
  private markerAt(x: number, y: number): MapMarker | null {
    const t = this.transform;
    const origin = t.worldToScreenCoordinates(new Cell(0, 0));
    const reach = MARKER_RADIUS + 6;
    let best: { m: MapMarker; d: number } | null = null;
    for (const m of campaignController().markers()) {
      const mx = origin.x + (m.x + 0.5) * t.scale;
      const my = origin.y + (m.y + 0.5) * t.scale;
      const d = Math.hypot(mx - x, my - y);
      if (d <= reach && (best === null || d < best.d)) best = { m, d };
    }
    return best?.m ?? null;
  }

  private onClick(x: number, y: number): void {
    // A marker first (J7): the journal on its event.
    const hit = this.markerAt(x, y);
    if (hit !== null) {
      campaignController().openMarker(hit);
      return;
    }
    const data = this.data;
    if (data === null || data.fronts.length === 0) return;
    const p = this.transform.screenToWorldCoordinatesFloat(x, y);
    const reach = Math.max(2, 14 / this.transform.scale);
    let best: { front: string; segment: number; d: number } | null = null;
    for (const front of data.overlay.fronts) {
      for (const line of front.segments) {
        const pts = line.points;
        for (let i = 0; i + 3 < pts.length; i += 2) {
          const d = distanceToSegment(
            p.x,
            p.y,
            pts[i],
            pts[i + 1],
            pts[i + 2],
            pts[i + 3],
          );
          if (d <= reach && (best === null || d < best.d)) {
            best = { front: front.id, segment: line.index, d };
          }
        }
      }
    }
    this.selected =
      best === null ? null : { front: best.front, segment: best.segment };
    this.dirty = true;
    this.renderPanel();
  }

  private element(id: string, classes: string): HTMLElement {
    let el = document.getElementById(id);
    if (el === null) {
      el = document.createElement("div");
      el.id = id;
      el.className = classes;
      document.body.appendChild(el);
    }
    return el;
  }

  private renderLegend(): void {
    const data = this.data;
    const show = data !== null && data.fronts.length > 0;
    const el = this.element(
      LEGEND_ID,
      "fixed bottom-2 left-2 z-[900] rounded border border-gray-600 bg-gray-900/85 p-2 text-[11px] text-white pointer-events-none",
    );
    el.style.display = show ? "block" : "none";
    if (!show) return;
    const swatch = (color: string, label: string, dashed = false) =>
      html`<div class="flex items-center gap-2">
        <span
          style="display:inline-block;width:18px;height:0;border-top:3px ${dashed
            ? "dashed"
            : "solid"} ${color}"
        ></span
        >${label}
      </div>`;
    render(
      html`<div class="mb-1 font-semibold">${vt("map.legend.title")}</div>
        ${swatch(COLORS.youAdvance, vt("map.legend.you-advance"))}
        ${swatch(COLORS.enemyAdvances, vt("map.legend.enemy-advances"))}
        ${swatch(COLORS.youContained, vt("map.legend.contained"))}
        ${swatch(COLORS.aAdvances, vt("map.legend.others"))}
        ${swatch(COLORS.quiet, vt("map.legend.quiet"), true)}
        <div class="mt-1 opacity-80">${vt("map.legend.contested")}</div>
        <div class="opacity-80">${vt("map.legend.click")}</div>`,
      el,
    );
  }

  private renderPanel(): void {
    const data = this.data;
    const selected = this.selected;
    const front =
      selected === null
        ? undefined
        : data?.fronts.find((f) => f.id === selected.front);
    const segment = front?.segments.find((s) => s.index === selected?.segment);
    const el = this.element(
      PANEL_ID,
      "fixed bottom-16 left-56 z-[900] w-[26rem] max-w-[90vw] rounded border border-gray-500 bg-gray-900/95 p-2 text-xs text-white",
    );
    if (front === undefined || segment === undefined) {
      el.style.display = "none";
      return;
    }
    el.style.display = "block";
    const sides = [front.a, front.b];
    // J7b: every figure of another nation as the player sees it.
    const source = contactSource(data!.intel);
    const side = (id: NationId): SideSeen | null =>
      sideSeenWith(source, data!.player, segment, id);
    const row = (label: string, pick: (s: SideSeen) => string) =>
      html`<tr>
        <td class="pr-2 opacity-80">${label}</td>
        ${sides.map((id) => {
          const s = side(id);
          return html`<td class="px-2 text-right">
            ${s === null ? "–" : pick(s)}
          </td>`;
        })}
      </tr>`;
    const times = (v: number) => `×${NUMBER.format(v)}`;
    const seenRatio = attackRatioSeen(source, data!.player, segment);
    const footer =
      segment.attacker === null
        ? vt("map.front.quiet")
        : `${vt("map.front.attack", {
            nation: nationName(segment.attacker),
            ratio:
              seenRatio === null
                ? NUMBER.format(segment.attackRatio)
                : shown(seenRatio, (v) => NUMBER.format(v)),
            threshold: NUMBER.format(this.threshold),
          })} ${vt(
            segment.attackRatio > this.threshold
              ? "map.front.advancing"
              : "map.front.holding",
          )}`;
    render(
      html`<div class="mb-1 flex items-center justify-between">
          <span class="font-semibold"
            >${vt("map.front.panel-title", {
              index: segment.index + 1,
              a: nationName(front.a),
              b: nationName(front.b),
            })}</span
          >
          <button
            class="rounded bg-gray-700 px-2 hover:bg-gray-600"
            @click=${() => {
              this.selected = null;
              this.dirty = true;
              this.renderPanel();
            }}
          >
            ${vt("map.front.close")}
          </button>
        </div>
        <table class="w-full">
          <thead>
            <tr>
              <th class="text-left">${vt("map.front.factor")}</th>
              ${sides.map(
                (id) =>
                  html`<th class="px-2 text-right">${nationName(id)}</th>`,
              )}
            </tr>
          </thead>
          <tbody>
            ${row(vt("map.front.divisions"), (s) =>
              shown(s.divisions, (v) => NUMBER.format(v)),
            )}
            ${row(vt("map.front.men"), (s) =>
              shown(s.men, (v) => INTEGER.format(v)),
            )}
            ${row(vt("map.front.equipment"), (s) =>
              shown(s.equipment, (v) => `${INTEGER.format(v * 100)} %`),
            )}
            ${row(vt("map.front.training"), (s) => shown(s.training, times))}
            ${row(vt("map.front.supply"), (s) => shown(s.supply, times))}
            ${row(vt("map.front.air"), (s) => shown(s.air, times))}
            ${row(vt("map.front.terrain"), (s) => shown(s.terrain, times))}
            ${row(vt("map.front.structures"), (s) =>
              shown(s.structures, times),
            )}
            ${row(vt("map.front.force"), (s) =>
              shown(s.force, (v) => INTEGER.format(v)),
            )}
          </tbody>
        </table>
        <div class="mt-1">${footer}</div>`,
      el,
    );
  }
}
