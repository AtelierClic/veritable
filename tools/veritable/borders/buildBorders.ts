import { Borders } from "../../../src/veritable/data/bordersFile";
import { LandMask, prepare, rasterize } from "./calibrate";
import { Feature } from "./geodata";
import { Georef } from "./projections";

// Natural Earth countries -> one owner per LAND tile of the map.
//
// 1. Every country (not just the scenario's) is rasterized. Only tiles that
//    are land in map.bin ever get an owner: lakes and rivers carved by the map
//    stay water even where Natural Earth says land.
// 2. De facto overrides (contested territories) reassign tiles whose Natural
//    Earth owner is listed in `from`.
// 3. Orphan land tiles (coast mismatch, small islands) go to the nearest
//    country among ALL countries, within a distance limit. Insets (pieces of
//    map drawn out of position) are excluded and stay neutral.
// 4. Only then is the result filtered to the nations of the scenario: a
//    Belgian coast tile becomes neutral, never French.

export interface Override {
  id: string;
  controller: string;
  from: string[];
  feature: Feature;
  status?: string; // "approximate": zoom image checked by eye
}

export interface Inset {
  name: string;
  box: [number, number, number, number]; // x0, y0, x1, y1 (inclusive), tiles
}

export interface NationReport {
  nation: string;
  fromPolygons: number;
  fromOrphans: number;
  gainedByOverride: number;
  lostToOverride: number;
  total: number;
}

export interface BordersReport {
  landTiles: number;
  nations: NationReport[];
  neutralLand: number; // land of countries outside the scenario
  insetLand: number; // land inside insets, neutral by rule
  unattachedLand: number; // orphans beyond the distance limit, neutral
  orphansReattached: number;
  overrides: { id: string; controller: string; tiles: number }[];
}

const NONE = -1;

export function buildBorders(
  mask: LandMask,
  georef: Georef,
  countriesIn: readonly Feature[],
  overrides: readonly Override[],
  insets: readonly Inset[],
  nations: readonly string[],
  maxOrphanDistance: number,
  // Natural Earth unit -> nation of the scenario, when they differ (J6: a
  // dependency to its sovereign, SDS -> SSD); the rest map to themselves.
  attach: ReadonlyMap<string, string> = new Map(),
): {
  borders: Borders;
  report: BordersReport;
  // Natural Earth country of each land tile before the overrides (index in
  // `countries`, -1 = none): regions filter their tiles on it (J6).
  natural: Int32Array;
} {
  const { width, height, land } = mask;
  const owner = new Int32Array(width * height).fill(NONE);
  // J6: a controller that is no Natural Earth country is a de facto entity
  // (Abkhazia, the Houthis' Yemen...): a unit without polygons of its own,
  // whose territory is what its overrides take.
  const known = new Set(countriesIn.map((c) => c.id));
  const units: Feature[] = [
    ...countriesIn,
    ...[...new Set(overrides.map((o) => o.controller))]
      .filter((id) => !known.has(id))
      .map((id) => ({ id, name: id, label: null, polygons: [] })),
  ];
  const countries: readonly Feature[] = units;
  const indexOf = new Map(countries.map((c, i) => [c.id, i]));

  countries.forEach((country, c) => {
    rasterize(prepare([country]), georef, width, height, 1, (i) => {
      if (land[i] === 1) owner[i] = c;
    });
  });
  const fromPolygons = countTiles(owner, countries.length);
  const natural = owner.slice();

  const gained = new Array(countries.length).fill(0);
  const lost = new Array(countries.length).fill(0);
  const overrideReport = overrides.map((o) => {
    const controller = indexOf.get(o.controller);
    if (controller === undefined) {
      throw new Error(`override ${o.id}: unknown controller ${o.controller}`);
    }
    const from = new Set(o.from.map((id) => indexOf.get(id)));
    let tiles = 0;
    rasterize(prepare([o.feature]), georef, width, height, 1, (i) => {
      if (land[i] !== 1 || !from.has(owner[i])) return;
      lost[owner[i]]++;
      gained[controller]++;
      owner[i] = controller;
      tiles++;
    });
    return { id: o.id, controller: o.controller, tiles };
  });

  const inInset = (i: number) => {
    const x = i % width;
    const y = (i - x) / width;
    return insets.some(
      ({ box }) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3],
    );
  };

  // Multi-source breadth-first search from every owned tile, through land and
  // water alike (an uncovered islet is reached across the sea).
  const nearest = new Int32Array(owner);
  const distance = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] !== NONE) {
      distance[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    if (distance[i] >= maxOrphanDistance) continue;
    const x = i % width;
    const visit = (j: number) => {
      if (distance[j] !== -1) return;
      distance[j] = distance[i] + 1;
      nearest[j] = nearest[i];
      queue[tail++] = j;
    };
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < owner.length - width) visit(i + width);
  }

  const fromOrphans = new Array(countries.length).fill(0);
  let insetLand = 0;
  let unattachedLand = 0;
  let landTiles = 0;
  for (let i = 0; i < owner.length; i++) {
    if (land[i] !== 1) continue;
    landTiles++;
    if (inInset(i)) {
      insetLand++;
      owner[i] = NONE;
    } else if (owner[i] === NONE) {
      if (nearest[i] === NONE) unattachedLand++;
      else {
        owner[i] = nearest[i];
        fromOrphans[owner[i]]++;
      }
    }
  }

  const nationOf = (c: number) =>
    attach.get(countries[c].id) ?? countries[c].id;
  const slot = countries.map((_, c) => nations.indexOf(nationOf(c)) + 1);
  const tiles = new Uint16Array(width * height);
  const totals = new Array(nations.length + 1).fill(0);
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] === NONE) continue;
    tiles[i] = slot[owner[i]];
    totals[tiles[i]]++;
  }

  const report: BordersReport = {
    landTiles,
    nations: nations.map((nation, n) => {
      const units = countries
        .map((_, c) => c)
        .filter((c) => nationOf(c) === nation);
      if (units.length === 0) {
        throw new Error(`no Natural Earth country ${nation}`);
      }
      const sum = (values: number[]) =>
        units.reduce((s, c) => s + values[c], 0);
      return {
        nation,
        fromPolygons: sum(fromPolygons),
        fromOrphans: sum(fromOrphans),
        gainedByOverride: sum(gained),
        lostToOverride: sum(lost),
        total: totals[n + 1],
      };
    }),
    neutralLand: totals[0],
    insetLand,
    unattachedLand,
    orphansReattached: fromOrphans.reduce((a, b) => a + b, 0),
    overrides: overrideReport,
  };
  return {
    borders: { width, height, nations: [...nations], tiles },
    report,
    natural,
  };
}

// A contested region of a scenario (J6): the land tiles inside its polygons,
// outside the insets, whose Natural Earth country (before the overrides) is
// one of `within` when given.
export interface RegionSpec {
  id: string;
  feature: Feature;
  within?: readonly string[];
}

export function buildRegions(
  mask: LandMask,
  georef: Georef,
  countries: readonly Feature[],
  natural: Int32Array,
  insets: readonly Inset[],
  specs: readonly RegionSpec[],
): Map<string, Uint32Array> {
  const { width, height, land } = mask;
  const inInset = (i: number) => {
    const x = i % width;
    const y = (i - x) / width;
    return insets.some(
      ({ box }) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3],
    );
  };
  const regions = new Map<string, Uint32Array>();
  for (const spec of specs) {
    const within =
      spec.within === undefined
        ? null
        : new Set(
            spec.within.map((id) => {
              const c = countries.findIndex((country) => country.id === id);
              if (c < 0) throw new Error(`region ${spec.id}: unknown ${id}`);
              return c;
            }),
          );
    const tiles = new Set<number>();
    rasterize(prepare([spec.feature]), georef, width, height, 1, (i) => {
      if (land[i] !== 1 || inInset(i)) return;
      if (within !== null && !within.has(natural[i])) return;
      tiles.add(i);
    });
    regions.set(spec.id, Uint32Array.from([...tiles].sort((a, b) => a - b)));
  }
  return regions;
}

function countTiles(owner: Int32Array, count: number): number[] {
  const totals = new Array(count).fill(0);
  for (const o of owner) if (o !== NONE) totals[o]++;
  return totals;
}

// Nations under `threshold` tiles become micro-states (J6): their few tiles
// go to the nation that owns most of the tiles around them (8-neighbourhood)
// or stay neutral, and each gets a host tile, its capital's.
export function demoteMicrostates(
  borders: Borders,
  threshold: number,
  capitals: Record<string, [number, number]>,
): Record<string, [number, number]> {
  const { width, height, tiles, nations } = borders;
  const counts = new Array(nations.length + 1).fill(0);
  for (const v of tiles) counts[v]++;
  const micro = new Set<number>();
  nations.forEach((_, n) => {
    if (counts[n + 1] < threshold) micro.add(n + 1);
  });
  const out: Record<string, [number, number]> = {};
  for (const index of [...micro].sort((a, b) => a - b)) {
    const id = nations[index - 1];
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== index) continue;
      const x = i % width;
      const y = (i - x) / width;
      const around = new Map<number, number>();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const v = tiles[ny * width + nx];
          if (v === 0 || micro.has(v)) continue;
          around.set(v, (around.get(v) ?? 0) + 1);
        }
      }
      const best = [...around].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      tiles[i] = best === undefined ? 0 : best[0];
    }
    const [cx, cy] = capitals[id];
    out[id] = [
      Math.max(0, Math.min(width - 1, Math.floor(cx))),
      Math.max(0, Math.min(height - 1, Math.floor(cy))),
    ];
  }
  return out;
}
