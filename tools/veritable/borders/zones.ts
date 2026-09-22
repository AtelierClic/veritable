import { Zones } from "../../../src/veritable/data/zonesFile";
import { LandMask } from "./calibrate";

// Maritime zones: every water tile goes to the seed it is closest to by
// travel over water (multi-source breadth-first search on the 4-neighbourhood
// of water tiles). Land never carries a zone; water no seed reaches (lakes,
// inland seas the seeds do not touch) stays at 0.

export interface Seed {
  id: string;
  x: number;
  y: number;
}

// Nearest water tile to (x, y), searching growing squares.
export function nearestWater(
  mask: LandMask,
  x: number,
  y: number,
  maxRadius = 200,
): [number, number] | null {
  const { width, height, land } = mask;
  for (let r = 0; r <= maxRadius; r++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
        if (land[ty * width + tx] === 1) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = [tx, ty];
        }
      }
    }
    if (best !== null) return best;
  }
  return null;
}

export function partitionWater(mask: LandMask, seeds: readonly Seed[]): Zones {
  const { width, height, land } = mask;
  const tiles = new Uint16Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  seeds.forEach((seed, i) => {
    const at = seed.y * width + seed.x;
    if (land[at] === 1) throw new Error(`seed ${seed.id} is on land`);
    if (tiles[at] !== 0) throw new Error(`seed ${seed.id} shares a tile`);
    tiles[at] = i + 1;
    queue[tail++] = at;
  });
  while (head < tail) {
    const tile = queue[head++];
    const zone = tiles[tile];
    const x = tile % width;
    const y = (tile - x) / width;
    const visit = (next: number) => {
      if (land[next] === 1 || tiles[next] !== 0) return;
      tiles[next] = zone;
      queue[tail++] = next;
    };
    if (x > 0) visit(tile - 1);
    if (x < width - 1) visit(tile + 1);
    if (y > 0) visit(tile - width);
    if (y < height - 1) visit(tile + width);
  }
  return { width, height, zones: seeds.map((s) => s.id), tiles };
}
