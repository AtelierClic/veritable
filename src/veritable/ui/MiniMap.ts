import { Controller } from "../../client/Controller";
import { TransformHandler } from "../../client/TransformHandler";
import { GameView } from "../../client/view/GameView";
import { campaignController } from "./CampaignController";
import type { MapModesController } from "./MapModesController";

// The mini-map of the campaign (J7b): the small map of the choice of the
// nation, in play — the nations in the colours of the mode of the map, the
// rectangle of the camera, the markers of the journal; a click takes the
// camera there. It sits above the bar of the modes.

export const MINIMAP_ID = "veritable-minimap";
const WIDTH = 240;
const SAMPLE_MS = 2000;
const WATER = [16, 32, 58] as const;
const EMPTY = [70, 74, 80] as const;
const MARKER = "#ef4444";

export class MiniMapController implements Controller {
  private image: ImageData | null = null;
  private lastCamera = "";
  private listening: HTMLCanvasElement | null = null;

  constructor(
    private readonly transform: TransformHandler,
    private readonly game: GameView,
    private readonly modes: MapModesController,
  ) {}

  init(): void {
    const frame = () => {
      this.draw();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  getTickIntervalMs(): number {
    return SAMPLE_MS;
  }

  tick(): void {
    this.sample();
  }

  private canvas(): HTMLCanvasElement | null {
    const canvas = document.getElementById(MINIMAP_ID);
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const height = Math.max(
      1,
      Math.round((WIDTH * this.game.height()) / this.game.width()),
    );
    if (canvas.width !== WIDTH || canvas.height !== height) {
      canvas.width = WIDTH;
      canvas.height = height;
      this.image = null;
    }
    if (this.listening !== canvas) {
      this.listening = canvas;
      canvas.addEventListener("click", (e) => this.onClick(e, canvas));
    }
    return canvas;
  }

  // The owner of the tile under each pixel, in the colours of the mode.
  private sample(): void {
    const canvas = this.canvas();
    if (canvas === null) return;
    const w = canvas.width;
    const h = canvas.height;
    const mapW = this.game.width();
    const mapH = this.game.height();
    const image = new ImageData(w, h);
    const colors = new Map<number, readonly number[]>();
    for (let y = 0; y < h; y++) {
      const ty = Math.min(mapH - 1, Math.floor(((y + 0.5) * mapH) / h));
      for (let x = 0; x < w; x++) {
        const tx = Math.min(mapW - 1, Math.floor(((x + 0.5) * mapW) / w));
        const tile = this.game.ref(tx, ty);
        let rgb: readonly number[];
        if (!this.game.isLand(tile)) rgb = WATER;
        else {
          const owner = this.game.ownerID(tile);
          if (owner === 0) rgb = EMPTY;
          else {
            let c = colors.get(owner);
            if (c === undefined) {
              c = this.modes.colorOf(owner) ?? EMPTY;
              colors.set(owner, c);
            }
            rgb = c;
          }
        }
        const o = (y * w + x) * 4;
        image.data[o] = rgb[0];
        image.data[o + 1] = rgb[1];
        image.data[o + 2] = rgb[2];
        image.data[o + 3] = 255;
      }
    }
    this.image = image;
    this.lastCamera = "";
  }

  private draw(): void {
    const canvas = this.canvas();
    if (canvas === null) return;
    if (this.image === null) this.sample();
    const t = this.transform;
    const a = t.screenToWorldCoordinatesFloat(0, 0);
    const b = t.screenToWorldCoordinatesFloat(
      window.innerWidth,
      window.innerHeight,
    );
    const markers = campaignController().markers();
    const camera = `${a.x}:${a.y}:${b.x}:${b.y}:${markers.length}:${this.image === null}`;
    if (camera === this.lastCamera && markers.length === 0) return;
    this.lastCamera = camera;
    const ctx = canvas.getContext("2d");
    if (ctx === null || this.image === null) return;
    ctx.putImageData(this.image, 0, 0);
    const kx = canvas.width / this.game.width();
    const ky = canvas.height / this.game.height();
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(a.x * kx) + 0.5,
      Math.round(a.y * ky) + 0.5,
      Math.max(2, Math.round((b.x - a.x) * kx)),
      Math.max(2, Math.round((b.y - a.y) * ky)),
    );
    ctx.fillStyle = MARKER;
    for (const m of markers) {
      const x = m.x * kx;
      const y = m.y * ky;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  private onClick(e: MouseEvent, canvas: HTMLCanvasElement): void {
    if (canvas.clientWidth === 0) return;
    const x = Math.floor((e.offsetX * this.game.width()) / canvas.clientWidth);
    const y = Math.floor(
      (e.offsetY * this.game.height()) / canvas.clientHeight,
    );
    if (!this.game.isValidCoord(x, y)) return;
    campaignController().focus(this.game.ref(x, y));
  }
}
