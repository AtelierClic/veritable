// Front geometry on a tile grid, independent of the world that owns the
// tiles (the OpenFront core through CoreBridge, or the in-memory world of the
// tests). Pure functions over accessors; nothing here mutates a tile.
//
// The front between a and b is the set of tiles owned by either that touch
// (4-neighbourhood) a tile owned by the other. Its connected components
// (8-neighbourhood) are walked from one end and cut into segments of about
// `segmentTiles` tiles, so a segment is a stretch of the line, not a random
// sample of it.

export const TERRAINS = ["plains", "highland", "mountain"] as const;
export type Terrain = (typeof TERRAINS)[number];

export interface GridAccess {
  width: number;
  height: number;
  // Index of the owner (0 = nobody) and terrain of a tile; water and
  // impassable tiles are never owned.
  ownerAt(tile: number): number;
  terrainAt(tile: number): Terrain;
}

export interface SegmentTiles {
  index: number;
  tiles: number[]; // both sides, along the line
  terrain: Record<Terrain, number>; // shares
  owned: Record<number, number>; // owner index -> tiles it holds here
}

function neighbours4(g: GridAccess, tile: number, out: number[]): number {
  const { width, height } = g;
  const x = tile % width;
  const y = (tile - x) / width;
  let n = 0;
  if (x > 0) out[n++] = tile - 1;
  if (x < width - 1) out[n++] = tile + 1;
  if (y > 0) out[n++] = tile - width;
  if (y < height - 1) out[n++] = tile + width;
  return n;
}

function neighbours8(g: GridAccess, tile: number, out: number[]): number {
  const { width, height } = g;
  const x = tile % width;
  const y = (tile - x) / width;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= height) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      if ((dx === 0 && dy === 0) || xx < 0 || xx >= width) continue;
      out[n++] = yy * width + xx;
    }
  }
  return n;
}

// Tiles of `candidates` (border tiles of a and of b) that face the other.
export function frontTiles(
  g: GridAccess,
  candidates: Iterable<number>,
  a: number,
  b: number,
): number[] {
  const out: number[] = [];
  const buf = [0, 0, 0, 0];
  const seen = new Set<number>();
  for (const tile of candidates) {
    if (seen.has(tile)) continue;
    seen.add(tile);
    const owner = g.ownerAt(tile);
    if (owner !== a && owner !== b) continue;
    const other = owner === a ? b : a;
    const n = neighbours4(g, tile, buf);
    for (let i = 0; i < n; i++) {
      if (g.ownerAt(buf[i]) === other) {
        out.push(tile);
        break;
      }
    }
  }
  return out.sort((p, q) => p - q);
}

// Farthest tile from `start` inside `set`, by BFS on the 8-neighbourhood, and
// the BFS order from that end.
function walk(
  g: GridAccess,
  set: Set<number>,
  start: number,
): { order: number[]; end: number } {
  const buf = new Array<number>(8).fill(0);
  const visited = new Set<number>([start]);
  const order: number[] = [start];
  for (let head = 0; head < order.length; head++) {
    const tile = order[head];
    const n = neighbours8(g, tile, buf);
    for (let i = 0; i < n; i++) {
      const next = buf[i];
      if (set.has(next) && !visited.has(next)) {
        visited.add(next);
        order.push(next);
      }
    }
  }
  return { order, end: order[order.length - 1] };
}

export function segmentFront(
  g: GridAccess,
  tiles: readonly number[],
  segmentTiles: number,
): SegmentTiles[] {
  const left = new Set(tiles);
  const components: number[][] = [];
  // Components, each ordered along the line from one end.
  for (const seed of tiles) {
    if (!left.has(seed)) continue;
    const first = walk(g, left, seed);
    const second = walk(g, left, first.end);
    for (const t of second.order) left.delete(t);
    components.push(second.order);
  }
  components.sort((p, q) => Math.min(...p) - Math.min(...q));

  const segments: SegmentTiles[] = [];
  for (const component of components) {
    const count = Math.max(1, Math.round(component.length / segmentTiles));
    const size = Math.ceil(component.length / count);
    for (let at = 0; at < component.length; at += size) {
      const chunk = component.slice(at, at + size);
      const terrain: Record<Terrain, number> = {
        plains: 0,
        highland: 0,
        mountain: 0,
      };
      const owned: Record<number, number> = {};
      for (const tile of chunk) {
        terrain[g.terrainAt(tile)] += 1;
        const owner = g.ownerAt(tile);
        owned[owner] = (owned[owner] ?? 0) + 1;
      }
      for (const key of TERRAINS) terrain[key] /= chunk.length;
      segments.push({ index: segments.length, tiles: chunk, terrain, owned });
    }
  }
  return segments;
}

// Takes up to `n` tiles of `loser` along the segment for `winner`: the tiles
// with the most winner neighbours first, then the neighbours of what was
// taken. Returns the tiles taken, in order.
export function captureAlong(
  g: GridAccess,
  segment: readonly number[],
  winner: number,
  loser: number,
  n: number,
  conquer: (tile: number) => void,
): number[] {
  const buf = [0, 0, 0, 0];
  const candidates = new Set<number>();
  const consider = (tile: number) => {
    if (g.ownerAt(tile) === loser) candidates.add(tile);
  };
  for (const tile of segment) {
    consider(tile);
    const k = neighbours4(g, tile, buf);
    for (let i = 0; i < k; i++) consider(buf[i]);
  }
  const taken: number[] = [];
  while (taken.length < n && candidates.size > 0) {
    let best = -1;
    let bestScore = -1;
    for (const tile of candidates) {
      if (g.ownerAt(tile) !== loser) {
        candidates.delete(tile);
        continue;
      }
      const k = neighbours4(g, tile, buf);
      let score = 0;
      for (let i = 0; i < k; i++) if (g.ownerAt(buf[i]) === winner) score++;
      if (score === 0) continue;
      if (score > bestScore || (score === bestScore && tile < best)) {
        best = tile;
        bestScore = score;
      }
    }
    if (best < 0) break;
    conquer(best);
    candidates.delete(best);
    taken.push(best);
    const k = neighbours4(g, best, buf);
    for (let i = 0; i < k; i++) consider(buf[i]);
  }
  return taken;
}
