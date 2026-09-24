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
  // J6c, a world that reports every change of owner (the core bridge):
  // counts kept up to date tile by tile, null until the first full count
  // (and again after a load). The scenario regions each tile lies in.
  private live: {
    homelands: Map<NationId, Map<NationId, number>>;
    regions: Map<string, Map<NationId, number>>;
  } | null = null;
  private tracking = false;
  private tileRegions: Map<number, string[]> | null = null;

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

  // J6c: from now on the world reports every change of owner
  // (ownerChanged); the counts are kept up to date instead of recounted.
  track(): void {
    this.tracking = true;
  }

  // The full count, now rather than at the first question (a load).
  prime(nationAt: (tile: number) => NationId | null): void {
    if (this.tracking && this.live === null) this.countLive(nationAt);
  }

  ownerChanged(tile: number, from: NationId | null, to: NationId | null): void {
    if (this.live === null || this.settled[tile] === 1) return;
    this.move(tile, from, to);
  }

  private move(tile: number, from: NationId | null, to: NationId | null) {
    if (this.live === null || this.input === null || from === to) return;
    const first = this.input.firstDay[tile];
    if (first !== 0) {
      const home = this.input.nations[first - 1];
      shift(this.live.homelands, home, from, to);
    }
    for (const region of this.regionsOf(tile)) {
      shift(this.live.regions, region, from, to);
    }
  }

  private regionsOf(tile: number): readonly string[] {
    if (this.tileRegions === null) {
      this.tileRegions = new Map();
      for (const [region, tiles] of this.input?.regions ?? []) {
        for (let i = 0; i < tiles.length; i++) {
          const list = this.tileRegions.get(tiles[i]);
          if (list === undefined) this.tileRegions.set(tiles[i], [region]);
          else list.push(region);
        }
      }
    }
    return this.tileRegions.get(tile) ?? [];
  }

  private countLive(nationAt: (tile: number) => NationId | null) {
    const regions = new Map<string, Map<NationId, number>>();
    for (const region of this.input?.regions.keys() ?? []) {
      regions.set(region, this.countRegion(region, nationAt));
    }
    this.live = { homelands: this.countHomelands(nationAt), regions };
  }

  // Tiles of the region each nation holds, settled tiles excluded. `key`
  // identifies the state of the world the counts are valid for (unused once
  // the world reports every change of owner).
  holders(
    region: string,
    key: string,
    nationAt: (tile: number) => NationId | null,
  ): ReadonlyMap<NationId, number> {
    if (this.tracking) {
      if (this.live === null) this.countLive(nationAt);
      const live = this.live!;
      return region.startsWith(HOMELAND_PREFIX)
        ? (live.homelands.get(region.slice(HOMELAND_PREFIX.length)) ??
            new Map())
        : (live.regions.get(region) ?? new Map());
    }
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
    const holders = this.countRegion(region, nationAt);
    this.regionCache.set(region, { key: fullKey, holders });
    return holders;
  }

  private countRegion(
    region: string,
    nationAt: (tile: number) => NationId | null,
  ): Map<NationId, number> {
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
      // A settled tile leaves every count (J6c: the live ones too).
      this.move(tile, winner, null);
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
    this.live = null; // counted again at the next question
  }

  write(tiles: Uint16Array): void {
    for (let tile = 0; tile < this.size; tile++) {
      if (this.settled[tile] === 1) tiles[tile] |= TILE_SETTLED_BIT;
    }
  }
}

// One tile of `key` moves from one holder to another (null: nobody).
function shift(
  counts: Map<string, Map<NationId, number>>,
  key: string,
  from: NationId | null,
  to: NationId | null,
): void {
  let holders = counts.get(key);
  if (holders === undefined) {
    holders = new Map();
    counts.set(key, holders);
  }
  if (from !== null) {
    const left = (holders.get(from) ?? 0) - 1;
    if (left > 0) holders.set(from, left);
    else holders.delete(from);
  }
  if (to !== null) holders.set(to, (holders.get(to) ?? 0) + 1);
}
