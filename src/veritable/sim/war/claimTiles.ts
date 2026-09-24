import { NationId } from "../../data/schemas/common";
import { TILE_SETTLED_BIT } from "../../data/schemas/save";

// Tiles of the claims (J6), kept by each world: the regions of the scenario
// (lists of land tiles, borders/<scenario>.regions.bin), the nation that held
// each tile on the first day (a nation claims its homeland), and the tiles a
// peace treaty settled (no claim covers them any more; bit 14 of a saved
// tile). Shared by the core bridge and the test worlds.

export const HOMELAND_PREFIX = "homeland:";

export function homelandRegion(nation: NationId): string {
  return `${HOMELAND_PREFIX}${nation}`;
}

export interface ClaimTilesInput {
  regions: ReadonlyMap<string, Uint32Array>;
  // Nation of each tile on the first day: index in `nations` + 1, 0 = none.
  firstDay: Uint16Array;
  nations: readonly NationId[];
}

export class ClaimTiles {
  private readonly settled: Uint8Array;
  private changes = 0;
  // Holders of each region, and of every homeland at once (one pass over
  // the map), for the key of the world state they were counted on.
  private regionCache = new Map<
    string,
    { key: string; holders: Map<NationId, number> }
  >();
  private homelandCache: {
    key: string;
    holders: Map<NationId, Map<NationId, number>>;
  } | null = null;

  constructor(
    private readonly size: number,
    private readonly input: ClaimTilesInput | null,
  ) {
    this.settled = new Uint8Array(size);
    if (input !== null && input.firstDay.length !== size) {
      throw new Error("first-day tiles do not match the map");
    }
  }

  hasRegion(region: string): boolean {
    if (region.startsWith(HOMELAND_PREFIX)) return this.input !== null;
    return this.input?.regions.has(region) ?? false;
  }

  isSettled(tile: number): boolean {
    return this.settled[tile] === 1;
  }

  version(): number {
    return this.changes;
  }

  // Tiles of the region each nation holds, settled tiles excluded. `key`
  // identifies the state of the world the counts are valid for.
  holders(
    region: string,
    key: string,
    nationAt: (tile: number) => NationId | null,
  ): ReadonlyMap<NationId, number> {
    const fullKey = `${key}|${this.changes}`;
    if (region.startsWith(HOMELAND_PREFIX)) {
      if (this.homelandCache?.key !== fullKey) {
        this.homelandCache = {
          key: fullKey,
          holders: this.countHomelands(nationAt),
        };
      }
      return (
        this.homelandCache.holders.get(region.slice(HOMELAND_PREFIX.length)) ??
        new Map()
      );
    }
    const cached = this.regionCache.get(region);
    if (cached?.key === fullKey) return cached.holders;
    const holders = new Map<NationId, number>();
    const tiles = this.input?.regions.get(region);
    if (tiles !== undefined) {
      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        if (this.settled[tile] === 1) continue;
        const holder = nationAt(tile);
        if (holder !== null)
          holders.set(holder, (holders.get(holder) ?? 0) + 1);
      }
    }
    this.regionCache.set(region, { key: fullKey, holders });
    return holders;
  }

  private countHomelands(
    nationAt: (tile: number) => NationId | null,
  ): Map<NationId, Map<NationId, number>> {
    const out = new Map<NationId, Map<NationId, number>>();
    if (this.input === null) return out;
    const { firstDay, nations } = this.input;
    for (let tile = 0; tile < this.size; tile++) {
      const first = firstDay[tile];
      if (first === 0 || this.settled[tile] === 1) continue;
      const holder = nationAt(tile);
      if (holder === null) continue;
      const home = nations[first - 1];
      let counts = out.get(home);
      if (counts === undefined) {
        counts = new Map();
        out.set(home, counts);
      }
      counts.set(holder, (counts.get(holder) ?? 0) + 1);
    }
    return out;
  }

  // A treaty in which `loser` cedes land to `winner`: every tile the winner
  // holds that was the loser's on the first day, or lies in one of
  // `regions` (the loser's claims), is settled. Returns how many.
  settle(
    winner: NationId,
    loser: NationId,
    regions: readonly string[],
    nationAt: (tile: number) => NationId | null,
  ): number {
    if (this.input === null) return 0;
    let count = 0;
    const mark = (tile: number) => {
      if (this.settled[tile] === 1) return;
      this.settled[tile] = 1;
      count++;
    };
    const loserIndex = this.input.nations.indexOf(loser) + 1;
    if (loserIndex > 0) {
      const { firstDay } = this.input;
      for (let tile = 0; tile < this.size; tile++) {
        if (firstDay[tile] === loserIndex && nationAt(tile) === winner) {
          mark(tile);
        }
      }
    }
    for (const region of regions) {
      const tiles = this.input.regions.get(region);
      if (tiles === undefined) continue;
      for (let i = 0; i < tiles.length; i++) {
        if (nationAt(tiles[i]) === winner) mark(tiles[i]);
      }
    }
    if (count > 0) this.changes++;
    return count;
  }

  // Saved tiles carry the settled bit (bit 14).
  load(tiles: Uint16Array): void {
    for (let tile = 0; tile < this.size; tile++) {
      this.settled[tile] = (tiles[tile] & TILE_SETTLED_BIT) !== 0 ? 1 : 0;
    }
    this.changes++;
  }

  write(tiles: Uint16Array): void {
    for (let tile = 0; tile < this.size; tile++) {
      if (this.settled[tile] === 1) tiles[tile] |= TILE_SETTLED_BIT;
    }
  }
}
