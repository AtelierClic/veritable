import { Borders } from "../data/bordersFile";
import { NationId } from "../data/schemas/common";
import { TILE_NATION_MASK, WorldState } from "../data/schemas/save";
import { TileGrid, WorldPort } from "../sim/VeritableSim";

// The tiled world WITHOUT the OpenFront core: nations sit on the rasterized
// borders of their scenario and nothing moves. Used by the headless runner v1
// (J2), whose economy only needs tile counts. The core enters the runner at
// J3a, when war starts moving tiles.
export class BordersWorld implements WorldPort {
  private tiles: Uint16Array;
  private nations: NationId[];
  private coreStart: unknown;

  constructor(borders: Borders, coreStart: unknown = { headless: true }) {
    this.tiles = borders.tiles.slice();
    this.nations = [...borders.nations];
    this.coreStart = coreStart;
    this.width = borders.width;
    this.height = borders.height;
  }

  readonly width: number;
  readonly height: number;

  // Nothing moves in this world: counted once, not at every advance().
  private counts: ReadonlyMap<NationId, number> | null = null;

  tileCounts(): ReadonlyMap<NationId, number> {
    if (this.counts === null) {
      const totals = new Array(this.nations.length + 1).fill(0);
      for (const value of this.tiles) totals[value & TILE_NATION_MASK]++;
      this.counts = new Map(this.nations.map((id, i) => [id, totals[i + 1]]));
    }
    return this.counts;
  }

  capture(nations: readonly NationId[]): { world: WorldState; grid: TileGrid } {
    const remap = this.nations.map((id) => nations.indexOf(id) + 1);
    const tiles = new Uint16Array(this.tiles.length);
    for (let i = 0; i < tiles.length; i++) {
      const owner = this.tiles[i] & TILE_NATION_MASK;
      tiles[i] = owner === 0 ? 0 : remap[owner - 1];
    }
    return {
      world: { coreStart: this.coreStart, players: [] },
      grid: { width: this.width, height: this.height, tiles },
    };
  }

  restore(
    nations: readonly NationId[],
    world: WorldState,
    grid: TileGrid,
  ): void {
    if (grid.width !== this.width || grid.height !== this.height) {
      throw new Error("tile grid does not match the borders");
    }
    this.nations = [...nations];
    this.tiles = grid.tiles.slice();
    this.coreStart = world.coreStart;
    this.counts = null;
  }
}
