import { NationId } from "../../data/schemas/common";
import {
  ContaminationEntry,
  NuclearStrike,
  TILE_FALLOUT_BIT,
  TILE_NATION_MASK,
} from "../../data/schemas/save";
import { daysBetweenDates } from "../time";

// Saves of the J5 to the J7b: a warhead that burst released its tiles (no
// owner, the fallout bit of OpenFront). J7c: a shot never changes the owner
// of a tile. The released land of such a save comes back, region by region
// (8-connected), to its owner of before — a nation a detonated strike hit
// that borders it, else the neighbour that borders it most — and is
// contaminated as a burst left it, healed since the last detonated strike
// (half-life `halfLifeYears`). Null when the save has no released land.

export interface FalloutRepair {
  tiles: Uint16Array;
  entries: ContaminationEntry[];
  repaired: number;
}

export function repairFallout(input: {
  tiles: Uint16Array;
  width: number;
  height: number;
  nations: readonly NationId[];
  strikes: readonly NuclearStrike[];
  date: string;
  halfLifeYears: number;
}): FalloutRepair | null {
  const { width, height } = input;
  const released: number[] = [];
  for (let t = 0; t < input.tiles.length; t++) {
    const v = input.tiles[t];
    if ((v & TILE_FALLOUT_BIT) !== 0 && (v & TILE_NATION_MASK) === 0) {
      released.push(t);
    }
  }
  if (released.length === 0) return null;
  const tiles = input.tiles.slice();
  const detonated = input.strikes.filter((s) => s.status === "detonated");
  // Nations a burst hit, by index in the save (1-based, as on the tiles).
  const hit = new Set<number>();
  for (const s of detonated) {
    for (const [nation, n] of Object.entries(s.hits)) {
      const i = input.nations.indexOf(nation);
      if (n > 0 && i >= 0) hit.add(i + 1);
    }
  }
  const last = detonated.map((s) => s.date).sort()[detonated.length - 1];
  const years =
    last === undefined ? 0 : daysBetweenDates(last, input.date) / 365.25;
  const level = Math.pow(0.5, years / input.halfLifeYears);
  const isReleased = (t: number) =>
    (tiles[t] & TILE_FALLOUT_BIT) !== 0 && (tiles[t] & TILE_NATION_MASK) === 0;
  const seen = new Uint8Array(tiles.length);
  const entries: ContaminationEntry[] = [];
  for (const start of released) {
    if (seen[start] !== 0) continue;
    // The region, and the owners of the tiles around it.
    const region: number[] = [];
    const border = new Map<number, number>();
    const queue = [start];
    seen[start] = 1;
    while (queue.length > 0) {
      const t = queue.pop()!;
      region.push(t);
      const x = t % width;
      const y = (t - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (isReleased(n)) {
            if (seen[n] === 0) {
              seen[n] = 1;
              queue.push(n);
            }
            continue;
          }
          const owner = tiles[n] & TILE_NATION_MASK;
          if (owner !== 0) border.set(owner, (border.get(owner) ?? 0) + 1);
        }
      }
    }
    const pick = (keep: (owner: number) => boolean): number => {
      let best = 0;
      let most = 0;
      for (const [owner, n] of [...border].sort((a, b) => a[0] - b[0])) {
        if (!keep(owner)) continue;
        if (n > most) {
          best = owner;
          most = n;
        }
      }
      return best;
    };
    const owner = pick((o) => hit.has(o)) || pick(() => true);
    for (const t of region) {
      tiles[t] = (tiles[t] & ~TILE_FALLOUT_BIT & ~TILE_NATION_MASK) | owner;
      entries.push({ tile: t, level, dead: 0 });
    }
  }
  entries.sort((a, b) => a.tile - b.tile);
  return { tiles, entries, repaired: released.length };
}
