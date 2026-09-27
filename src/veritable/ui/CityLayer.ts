import { Controller } from "../../client/Controller";
import { TransformHandler } from "../../client/TransformHandler";
import { GameView } from "../../client/view/GameView";
import { Cell } from "../../core/game/Game";
import { dataSource } from "../data/catalog";
import { vt } from "../data/i18n";
import { CityData } from "../data/schemas/cities";

// The cities of the campaign on the map (J7b): the capitals and the three
// largest cities of each nation (data/veritable/cities), a dot that grows
// with the population, a star for a capital, the name beside it. At the
// scale of the whole map only the capitals and the cities of more than ten
// million; more as the camera closes in; never two labels over each other
// (the capitals first, then by population).

const CANVAS_ID = "veritable-city-layer";
// Zoom relative to the whole map in view.
const ZOOM_MEDIUM = 2.5;
const ZOOM_CLOSE = 6;
const MEGACITY = 10_000_000;
const MEDIUM_CITY = 2_000_000;
const FONT_PX = 11;

export function cityShown(city: CityData, zoom: number): boolean {
  if (city.capital || city.population >= MEGACITY) return true;
  if (zoom >= ZOOM_CLOSE) return true;
  return zoom >= ZOOM_MEDIUM && city.population >= MEDIUM_CITY;
}

export function cityRadius(population: number): number {
  return Math.max(2, Math.min(7, 1.5 + 1.2 * Math.sqrt(population / 1e6)));
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

export class CityLayerController implements Controller {
  private canvas: HTMLCanvasElement | null = null;
  private lastCamera = "";
  private cities: CityData[] = [];
  private visible = true;

  constructor(
    private readonly transform: TransformHandler,
    private readonly game: GameView,
  ) {}

  init(): void {
    const id = this.game.config().gameConfig().veritableScenario;
    if (id === undefined) return;
    this.cities = [...dataSource.cities(dataSource.scenario(id))].sort(
      (a, b) =>
        Number(b.capital) - Number(a.capital) || b.population - a.population,
    );
    // J7c: the layer of the game before (a save loaded in the game) goes;
    // its drawing loop stops with it (the names of the cities were drawn
    // twice, the old ones at the old camera).
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
    });
    const overlay = document.getElementById("game-input-overlay");
    if (overlay?.parentElement) overlay.after(canvas);
    else document.body.appendChild(canvas);
    this.canvas = canvas;
    const frame = () => {
      if (this.canvas === null || !this.canvas.isConnected) return;
      this.draw();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // J7b.4: the map modes show or hide the cities.
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.lastCamera = "";
  }

  private draw(): void {
    const canvas = this.canvas!;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    const t = this.transform;
    const origin = t.worldToScreenCoordinates(new Cell(0, 0));
    const camera = `${w}x${h}:${t.scale}:${origin.x}:${origin.y}:${this.visible}`;
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
    if (!this.visible || this.cities.length === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fit = Math.min(
      window.innerWidth / this.game.width(),
      window.innerHeight / this.game.height(),
    );
    const zoom = t.scale / fit;
    ctx.font = `600 ${FONT_PX}px system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    const placed: Box[] = [];
    for (const city of this.cities) {
      if (!cityShown(city, zoom)) continue;
      const x = origin.x + (city.x + 0.5) * t.scale;
      const y = origin.y + (city.y + 0.5) * t.scale;
      if (x < -50 || y < -20 || x > window.innerWidth + 50) continue;
      if (y > window.innerHeight + 20) continue;
      const r = cityRadius(city.population);
      const name = vt(city.name);
      const width = ctx.measureText(name).width;
      const label: Box = {
        x0: x + r + 2,
        y0: y - FONT_PX / 2 - 1,
        x1: x + r + 4 + width,
        y1: y + FONT_PX / 2 + 1,
      };
      const dot: Box = { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
      if (placed.some((b) => overlaps(b, label) || overlaps(b, dot))) {
        continue;
      }
      placed.push(label, dot);
      ctx.fillStyle = city.capital ? "#fde68a" : "#f8fafc";
      ctx.strokeStyle = "rgba(15, 23, 42, 0.85)";
      ctx.lineWidth = 1.5;
      if (city.capital) star(ctx, x, y, r + 1.5);
      else {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
      }
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeText(name, label.x0 + 1, y);
      ctx.fillStyle = "#f8fafc";
      ctx.fillText(name, label.x0 + 1, y);
    }
  }
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const d = i % 2 === 0 ? r : r * 0.45;
    const px = x + d * Math.cos(a);
    const py = y + d * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
