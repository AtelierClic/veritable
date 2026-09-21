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
