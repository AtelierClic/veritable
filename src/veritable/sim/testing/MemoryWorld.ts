import { NationId } from "../../data/schemas/common";
import {
  TILE_FALLOUT_BIT,
  TILE_NATION_MASK,
  WorldState,
} from "../../data/schemas/save";
import { TileGrid, WorldPort } from "../VeritableSim";

// In-memory WorldPort: a tiled world without the OpenFront core. Used by the
// simulation and save tests.
export class MemoryWorld implements WorldPort {
  private owners: (NationId | null)[];
  private fallout: boolean[];
  coreStart: unknown = { memory: true };

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.owners = new Array(width * height).fill(null);
    this.fallout = new Array(width * height).fill(false);
  }

  setOwner(tile: number, nation: NationId | null): void {
    this.owners[tile] = nation;
  }

  setFallout(tile: number, value: boolean): void {
    this.fallout[tile] = value;
  }

  // Gives every tile of `from` to `to` (or to nobody).
  transferAll(from: NationId, to: NationId | null): void {
    this.owners = this.owners.map((o) => (o === from ? to : o));
  }

  tileCounts(): ReadonlyMap<NationId, number> {
    const counts = new Map<NationId, number>();
    for (const o of this.owners) {
      if (o !== null) counts.set(o, (counts.get(o) ?? 0) + 1);
    }
    return counts;
  }

  capture(nations: readonly NationId[]): { world: WorldState; grid: TileGrid } {
    const index = new Map(nations.map((id, i) => [id, i + 1]));
    const tiles = new Uint16Array(this.owners.length);
    this.owners.forEach((o, i) => {
      const owner = o === null ? 0 : (index.get(o) ?? 0);
      tiles[i] = owner | (this.fallout[i] ? TILE_FALLOUT_BIT : 0);
    });
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
      throw new Error("tile grid does not match the world");
    }
    this.coreStart = world.coreStart;
    grid.tiles.forEach((value, i) => {
      const owner = value & TILE_NATION_MASK;
      this.owners[i] = owner === 0 ? null : nations[owner - 1];
      this.fallout[i] = (value & TILE_FALLOUT_BIT) !== 0;
    });
  }
}
