import fs from "fs";
import path from "path";
import { Feature, REPO_ROOT } from "./geodata";
import {
  Georef,
  PROJECTION_KINDS,
  ProjectionKind,
  toTile,
  WORLD_PROJECTIONS,
} from "./projections";
import { fillPolygon } from "./raster";

// Self-calibration of a map that ships without any georeference: find the
// projection and placement under which the Natural Earth land best overlaps
// the map's own land mask (intersection over union).

export interface LandMask {
  width: number;
  height: number;
  land: Uint8Array; // 1 = land
}

const LAND_BIT = 0x80; // bit 7 of a terrain byte (src/core/game/GameMap.ts)

export function loadLandMask(mapName: string): LandMask {
  const dir = path.join(REPO_ROOT, "resources/maps", mapName);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
  );
  const { width, height } = manifest.map;
  const terrain = fs.readFileSync(path.join(dir, "map.bin"));
  if (terrain.length !== width * height) {
    throw new Error(`${mapName}: map.bin does not match the manifest`);
  }
  const land = new Uint8Array(width * height);
  for (let i = 0; i < land.length; i++) land[i] = terrain[i] & LAND_BIT ? 1 : 0;
  return { width, height, land };
}

// Majority downsample by an integer factor.
export function downsample(mask: LandMask, factor: number): LandMask {
  if (factor === 1) return mask;
  const width = Math.floor(mask.width / factor);
  const height = Math.floor(mask.height / factor);
  const land = new Uint8Array(width * height);
  const half = (factor * factor) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let count = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * mask.width + x * factor;
        for (let dx = 0; dx < factor; dx++) count += mask.land[row + dx];
      }
      land[y * width + x] = count > half ? 1 : 0;
    }
  }
  return { width, height, land };
}

// Rings as flat lon/lat arrays, prepared once.
export interface PreparedPolygon {
  rings: Float64Array[];
}
export function prepare(features: readonly Feature[]): PreparedPolygon[] {
  return features.flatMap((f) =>
    f.polygons.map((polygon) => ({
      rings: polygon.map((ring) => {
        const flat = new Float64Array(ring.length * 2);
        ring.forEach(([lon, lat], i) => {
          flat[2 * i] = lon;
          flat[2 * i + 1] = lat;
        });
        return flat;
      }),
    })),
  );
}

// A ring of lon/lat pairs cut at the seam of a world projection: its
// longitudes relative to lon0 are made continuous along the ring, then the
// ring and its copies shifted by a full turn are clipped to [-180, 180]
// (Sutherland-Hodgman against two meridians). Returns lon/lat rings whose
// relative longitude never crosses the seam; lon0 is added back.
export function cutAtSeam(ring: Float64Array, lon0: number): Float64Array[] {
  const n = ring.length / 2;
  const rel = new Float64Array(ring.length);
  let previous = 0;
  for (let i = 0; i < n; i++) {
    let d = ring[2 * i] - lon0;
    d = ((((d + 180) % 360) + 360) % 360) - 180;
    if (i > 0) {
      while (d - previous > 180) d -= 360;
      while (d - previous < -180) d += 360;
    }
    rel[2 * i] = d;
    rel[2 * i + 1] = ring[2 * i + 1];
    previous = d;
  }
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    min = Math.min(min, rel[2 * i]);
    max = Math.max(max, rel[2 * i]);
  }
  const out: Float64Array[] = [];
  for (let shift = -360; shift <= 360; shift += 360) {
    if (max + shift <= -180 || min + shift >= 180) continue;
    let points: number[] = [];
    for (let i = 0; i < n; i++) points.push(rel[2 * i] + shift, rel[2 * i + 1]);
    for (const [bound, keepAbove] of [
      [-180, true],
      [180, false],
    ] as const) {
      const next: number[] = [];
      const m = points.length / 2;
      for (let i = 0; i < m; i++) {
        const ax = points[2 * i];
        const ay = points[2 * i + 1];
        const bx = points[2 * ((i + 1) % m)];
        const by = points[2 * ((i + 1) % m) + 1];
        const aIn = keepAbove ? ax >= bound : ax <= bound;
        const bIn = keepAbove ? bx >= bound : bx <= bound;
        if (aIn) next.push(ax, ay);
        if (aIn !== bIn) {
          const t = (bound - ax) / (bx - ax);
          next.push(bound, ay + t * (by - ay));
        }
      }
      points = next;
      if (points.length < 6) break;
    }
    if (points.length < 6) continue;
    const clipped = new Float64Array(points.length);
    for (let i = 0; i < points.length; i += 2) {
      clipped[i] = points[i] + lon0;
      clipped[i + 1] = points[i + 1];
    }
    out.push(clipped);
  }
  return out;
}

export function rasterize(
  polygons: readonly PreparedPolygon[],
  georef: Georef,
  width: number,
  height: number,
  factor: number,
  paint: (index: number, polygonIndex: number) => void,
): void {
  const project = toTile(georef);
  const world = WORLD_PROJECTIONS.includes(georef.projection);
  polygons.forEach((source, polygonIndex) => {
    const polygon = world
      ? { rings: source.rings.flatMap((ring) => cutAtSeam(ring, georef.lon0)) }
      : source;
    const rings = polygon.rings.map((ring) => {
      const out = new Float64Array(ring.length);
      for (let i = 0; i < ring.length; i += 2) {
        const [x, y] = project(ring[i], ring[i + 1]);
        out[i] = x / factor;
        out[i + 1] = y / factor;
      }
      return out;
    });
    fillPolygon(rings, width, height, (index) => paint(index, polygonIndex));
  });
}

export function overlap(
  polygons: readonly PreparedPolygon[],
  georef: Georef,
  mask: LandMask,
  factor: number,
): number {
  const drawn = new Uint8Array(mask.land.length);
  rasterize(polygons, georef, mask.width, mask.height, factor, (i) => {
    drawn[i] = 1;
  });
  let both = 0;
  let either = 0;
  for (let i = 0; i < drawn.length; i++) {
    both += drawn[i] & mask.land[i];
    either += drawn[i] | mask.land[i];
  }
  return either === 0 ? 0 : both / either;
}

// Least-squares similarity (scale, rotation, translation) sending projected
// points onto tile coordinates: the starting point of the search.
export function similarityFromPoints(
  base: Georef,
  points: readonly { lon: number; lat: number; x: number; y: number }[],
): Georef {
  const project = toTile({
    ...base,
    scale: 1,
    aspect: 1,
    rotation: 0,
    tx: 0,
    ty: 0,
  });
  // Unknowns a = s cos, b = s sin:  X = tx + a u - b v ;  Y = ty + b u + a v
  // with (u, v) = projected point in y-down coordinates.
  let su = 0,
    sv = 0,
    sx = 0,
    sy = 0,
    suu = 0,
    sux = 0,
    svy = 0,
    suy = 0,
    svx = 0;
  const n = points.length;
  const uv = points.map((p) => project(p.lon, p.lat));
  uv.forEach(([u, v], i) => {
    su += u;
    sv += v;
    sx += points[i].x;
    sy += points[i].y;
  });
  const mu = su / n,
    mv = sv / n,
    mx = sx / n,
    my = sy / n;
  uv.forEach(([u, v], i) => {
    const du = u - mu,
      dv = v - mv,
      dx = points[i].x - mx,
      dy = points[i].y - my;
    suu += du * du + dv * dv;
    sux += du * dx;
    svy += dv * dy;
    suy += du * dy;
    svx += dv * dx;
  });
  const a = (sux + svy) / suu;
  const b = (suy - svx) / suu;
  // toTile uses X = tx + c*x - s*y, Y = ty - (s*x + c*y) with y north (v = -y):
  // X = tx + c*u + s*v ; Y = ty - s*u + c*v  =>  c = a, s = -b.
  const scale = Math.hypot(a, b);
  const rotation = (Math.atan2(-b, a) * 180) / Math.PI;
  return {
    ...base,
    scale,
    rotation,
    tx: mx - (a * mu - b * mv),
    ty: my - (b * mu + a * mv),
  };
}

type Key =
  | "lon0"
  | "lat0"
  | "lat1"
  | "lat2"
  | "scale"
  | "aspect"
  | "rotation"
  | "tx"
  | "ty";

function searchKeys(kind: ProjectionKind): Key[] {
  // For eqc the centre is redundant with the translation.
  const placement: Key[] = ["tx", "ty", "scale", "aspect", "rotation"];
  if (kind === "eqc") return placement;
  // A world projection: the central meridian (where the seam falls); its
  // latitude of origin is the equator.
  if (WORLD_PROJECTIONS.includes(kind)) return [...placement, "lon0"];
  const common: Key[] = [...placement, "lon0", "lat0"];
  return kind === "lcc" || kind === "albers"
    ? [...common, "lat1", "lat2"]
    : common;
}

// Pattern search (coordinate moves with step halving). The objective is
// piecewise constant, which rules out gradient methods.
export function refine(
  start: Georef,
  polygons: readonly PreparedPolygon[],
  mask: LandMask,
  factor: number,
  steps: Record<Key, number>,
  rounds: number,
  log: (line: string) => void = () => {},
): { georef: Georef; iou: number } {
  let best = { ...start };
  let bestIou = overlap(polygons, best, mask, factor);
  const step = { ...steps };
  const keys = searchKeys(start.projection);
  for (let round = 0; round < rounds; round++) {
    let improved = false;
    for (const key of keys) {
      for (const direction of [1, -1]) {
        for (;;) {
          const candidate = {
            ...best,
            [key]: best[key] + direction * step[key],
          };
          if (candidate.lat1 >= candidate.lat2 - 1) break;
          const value = overlap(polygons, candidate, mask, factor);
          if (value <= bestIou) break;
          best = candidate;
          bestIou = value;
          improved = true;
        }
      }
    }
    log(`  x${factor} round ${round + 1}: IoU ${bestIou.toFixed(5)}`);
    if (!improved) for (const key of keys) step[key] /= 2;
  }
  return { georef: best, iou: bestIou };
}

// The longitude at the horizontal middle of a world map, from a straight
// line through the anchors (x against longitude).
function centralLongitude(
  anchors: readonly { lon: number; x: number }[],
  width: number,
): number {
  const n = anchors.length;
  const mx = anchors.reduce((s, p) => s + p.x, 0) / n;
  const ml = anchors.reduce((s, p) => s + p.lon, 0) / n;
  let sxl = 0;
  let sxx = 0;
  for (const p of anchors) {
    sxl += (p.x - mx) * (p.lon - ml);
    sxx += (p.x - mx) * (p.x - mx);
  }
  return ml + (sxl / sxx) * (width / 2 - mx);
}

export interface CalibrationResult {
  georef: Georef;
  iou: number; // at full resolution
  candidates: { projection: ProjectionKind; iou: number }[];
}

export function calibrate(
  mask: LandMask,
  land: readonly PreparedPolygon[],
  anchors: readonly { lon: number; lat: number; x: number; y: number }[],
  log: (line: string) => void = () => {},
  kinds: readonly ProjectionKind[] = PROJECTION_KINDS,
): CalibrationResult {
  const coarse = downsample(mask, 8);
  const medium = downsample(mask, 4);
  const candidates: { georef: Georef; iou: number }[] = [];

  for (const projection of kinds) {
    log(`projection ${projection}`);
    const world = WORLD_PROJECTIONS.includes(projection);
    const lonMid = world
      ? centralLongitude(anchors, mask.width)
      : anchors.reduce((s, p) => s + p.lon, 0) / anchors.length;
    const latMid = world
      ? 0
      : anchors.reduce((s, p) => s + p.lat, 0) / anchors.length;
    const base: Georef = {
      projection,
      lon0: Math.round(lonMid),
      lat0: Math.round(latMid),
      lat1: 40,
      lat2: 62,
      scale: 1,
      aspect: 1,
      rotation: 0,
      tx: 0,
      ty: 0,
    };
    let current = similarityFromPoints(base, anchors);
    const steps = {
      lon0: 4,
      lat0: 4,
      lat1: 5,
      lat2: 5,
      scale: current.scale * 0.02,
      aspect: 0.02,
      rotation: 1,
      tx: 16,
      ty: 16,
    };
    current = refine(current, land, coarse, 8, steps, 10, log).georef;
    const fineSteps = {
      lon0: 0.5,
      lat0: 0.5,
      lat1: 1,
      lat2: 1,
      scale: current.scale * 0.002,
      aspect: 0.004,
      rotation: 0.1,
      tx: 4,
      ty: 4,
    };
    candidates.push(refine(current, land, medium, 4, fineSteps, 8, log));
  }

  candidates.sort((a, b) => b.iou - a.iou);
  log(`best at x4: ${candidates[0].georef.projection}`);
  const winner = candidates[0].georef;
  const finalSteps = {
    lon0: 0.1,
    lat0: 0.1,
    lat1: 0.25,
    lat2: 0.25,
    scale: winner.scale * 0.0005,
    aspect: 0.001,
    rotation: 0.02,
    tx: 1,
    ty: 1,
  };
  const final = refine(
    winner,
    land,
    downsample(mask, 2),
    2,
    finalSteps,
    6,
    log,
  );
  return {
    georef: final.georef,
    iou: overlap(land, final.georef, mask, 1),
    candidates: candidates.map((c) => ({
      projection: c.georef.projection,
      iou: c.iou,
    })),
  };
}
