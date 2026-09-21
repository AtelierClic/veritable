import { Borders } from "../../../src/veritable/data/bordersFile";
import { LandMask, PreparedPolygon, rasterize } from "./calibrate";
import { encodePng } from "./png";
import { Georef, toTile } from "./projections";

// Control image: the map's own land mask, where Natural Earth disagrees with
// it, and the projected borders on top. For eyeballing a calibration.

const WATER = [16, 24, 96];
const LAND = [214, 222, 176];
const MAP_ONLY = [255, 150, 40]; // land on the map, sea in Natural Earth
const NE_ONLY = [60, 200, 230]; // sea on the map, land in Natural Earth
const BORDER = [200, 0, 0];

export interface Overlay {
  polygons: readonly PreparedPolygon[];
  color: [number, number, number];
  fill?: number; // 0..1 blend of the colour over the base, inside polygons
}

export function controlImage(
  mask: LandMask,
  land: readonly PreparedPolygon[],
  georef: Georef,
  overlays: readonly Overlay[] = [],
): Buffer {
  const { width, height } = mask;
  const drawn = new Uint8Array(width * height);
  rasterize(land, georef, width, height, 1, (i) => (drawn[i] = 1));

  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < drawn.length; i++) {
    const color =
      mask.land[i] === 1
        ? drawn[i] === 1
          ? LAND
          : MAP_ONLY
        : drawn[i] === 1
          ? NE_ONLY
          : WATER;
    rgb.set(color, i * 3);
  }

  for (const overlay of overlays) {
    const alpha = overlay.fill ?? 0;
    if (alpha <= 0) continue;
    rasterize(overlay.polygons, georef, width, height, 1, (i) => {
      if (mask.land[i] !== 1) return;
      for (let c = 0; c < 3; c++) {
        rgb[i * 3 + c] = Math.round(
          rgb[i * 3 + c] * (1 - alpha) + overlay.color[c] * alpha,
        );
      }
    });
  }

  const project = toTile(georef);
  const plot = (x: number, y: number, color: number[]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    rgb.set(color, (y * width + x) * 3);
  };
  const line = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: number[],
  ) => {
    const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    if (steps > 4 * (width + height)) return; // wrapped far off the map
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      plot(
        Math.floor(x0 + (x1 - x0) * t),
        Math.floor(y0 + (y1 - y0) * t),
        color,
      );
    }
  };
  const outline = (polygons: readonly PreparedPolygon[], color: number[]) => {
    for (const polygon of polygons) {
      for (const ring of polygon.rings) {
        let [px, py] = project(ring[0], ring[1]);
        for (let i = 2; i < ring.length; i += 2) {
          const [x, y] = project(ring[i], ring[i + 1]);
          const visible =
            (px >= 0 && px < width && py >= 0 && py < height) ||
            (x >= 0 && x < width && y >= 0 && y < height);
          if (visible) line(px, py, x, y, color);
          px = x;
          py = y;
        }
      }
    }
  };
  outline(land, BORDER);
  for (const overlay of overlays) outline(overlay.polygons, overlay.color);

  return encodePng(rgb, width, height);
}

// Twelve well separated colours; nation n of the borders file gets colour n.
const NATION_COLORS = [
  [31, 119, 180],
  [255, 127, 14],
  [44, 160, 44],
  [214, 39, 40],
  [148, 103, 189],
  [140, 86, 75],
  [227, 119, 194],
  [188, 189, 34],
  [23, 190, 207],
  [255, 215, 0],
  [0, 100, 0],
  [250, 128, 114],
];
const NEUTRAL = [150, 150, 150];

// One colour per nation, neutral land in grey, override outlines in black.
export function bordersImage(
  mask: LandMask,
  borders: Borders,
  georef: Georef,
  overrides: readonly PreparedPolygon[],
  // Optional zoom: lon/lat window, magnified by an integer factor.
  zoom?: {
    west: number;
    east: number;
    south: number;
    north: number;
    factor: number;
  },
): Buffer {
  const { width, height } = mask;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < borders.tiles.length; i++) {
    const n = borders.tiles[i];
    const color =
      mask.land[i] !== 1
        ? WATER
        : n === 0
          ? NEUTRAL
          : NATION_COLORS[(n - 1) % NATION_COLORS.length];
    rgb.set(color, i * 3);
  }
  const project = toTile(georef);
  for (const polygon of overrides) {
    for (const ring of polygon.rings) {
      for (let i = 0; i + 3 < ring.length; i += 2) {
        const [x0, y0] = project(ring[i], ring[i + 1]);
        const [x1, y1] = project(ring[i + 2], ring[i + 3]);
        const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
        for (let s = 0; s <= steps; s++) {
          const x = Math.floor(x0 + ((x1 - x0) * s) / Math.max(steps, 1));
          const y = Math.floor(y0 + ((y1 - y0) * s) / Math.max(steps, 1));
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              if (
                x + dx < 0 ||
                y + dy < 0 ||
                x + dx >= width ||
                y + dy >= height
              )
                continue;
              rgb.set([0, 0, 0], ((y + dy) * width + x + dx) * 3);
            }
          }
        }
      }
    }
  }
  if (zoom === undefined) return encodePng(rgb, width, height);

  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const [xa, ya] = project(zoom.west, zoom.north);
  const [xb, yb] = project(zoom.east, zoom.south);
  const x0 = clamp(Math.floor(xa), width - 1);
  const y0 = clamp(Math.floor(ya), height - 1);
  const w = clamp(Math.ceil(xb), width) - x0;
  const h = clamp(Math.ceil(yb), height) - y0;
  const f = zoom.factor;
  const out = new Uint8Array(w * f * h * f * 3);
  for (let y = 0; y < h * f; y++) {
    for (let x = 0; x < w * f; x++) {
      const from =
        ((y0 + Math.floor(y / f)) * width + x0 + Math.floor(x / f)) * 3;
      out.set(rgb.subarray(from, from + 3), (y * w * f + x) * 3);
    }
  }
  return encodePng(out, w * f, h * f);
}
