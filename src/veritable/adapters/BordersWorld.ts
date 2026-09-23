import { Borders } from "../data/bordersFile";
import { NationId } from "../data/schemas/common";
import { TILE_NATION_MASK, WorldState } from "../data/schemas/save";
import { Zones } from "../data/zonesFile";
import {
  FrontGeometry,
  NavalSnapshot,
  TileGrid,
  WorldPort,
} from "../sim/VeritableSim";

// The tiled world WITHOUT the OpenFront core: nations sit on the rasterized
// borders of their scenario and nothing moves. Used by the headless runner v1
// (J2), whose economy only needs tile counts, and by the tests. It knows the
// maritime zones (coasts) but has no terrain, no structures and no ships:
// no fronts, no landings.
export class BordersWorld implements WorldPort {
  private tiles: Uint16Array;
  private nations: NationId[];
  private coreStart: unknown;
  private readonly zones: Zones | null;
  private sea: NavalSnapshot | null = null;

  constructor(
    borders: Borders,
    zones: Zones | null = null,
    coreStart: unknown = { headless: true },
  ) {
    this.tiles = borders.tiles.slice();
    this.nations = [...borders.nations];
    this.coreStart = coreStart;
    this.width = borders.width;
    this.height = borders.height;
    this.zones = zones;
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
    this.sea = null;
  }

  // No terrain, no structures: this world has no fronts. Wars declared in it
  // change relations and trade, never a tile (the runner on the core does).
  fronts(): FrontGeometry[] {
    return [];
  }

  advance(): number {
    return 0;
  }

  transferAll(from: NationId, to: NationId): number {
    const f = this.nations.indexOf(from) + 1;
    const t = this.nations.indexOf(to) + 1;
    if (f === 0 || t === 0) return 0;
    let moved = 0;
    for (let i = 0; i < this.tiles.length; i++) {
      if ((this.tiles[i] & TILE_NATION_MASK) === f) {
        this.tiles[i] = (this.tiles[i] & ~TILE_NATION_MASK) | t;
        moved++;
      }
    }
    this.counts = null;
    this.sea = null;
    return moved;
  }

  // Coastal zones of every nation, read once off the tiles: a land tile of
  // the nation next to a water tile of a zone.
  naval(): NavalSnapshot {
    if (this.sea !== null) return this.sea;
    const coast: Record<NationId, Set<string>> = {};
    for (const id of this.nations) coast[id] = new Set();
    if (this.zones !== null) {
      const { width, height } = this;
      const z = this.zones;
      const visit = (a: number, b: number) => {
        const owner = this.tiles[a] & TILE_NATION_MASK;
        const zone = z.tiles[b];
        if (owner !== 0 && zone !== 0 && this.tiles[b] === 0) {
          coast[this.nations[owner - 1]].add(z.zones[zone - 1]);
        }
      };
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          if (x + 1 < width) {
            visit(i, i + 1);
            visit(i + 1, i);
          }
          if (y + 1 < height) {
            visit(i, i + width);
            visit(i + width, i);
          }
        }
      }
    }
    this.sea = {
      coast: Object.fromEntries(
        this.nations.map((id) => [id, [...coast[id]].sort()]),
      ),
      ports: Object.fromEntries(this.nations.map((id) => [id, []])),
      ships: {},
    };
    return this.sea;
  }

  landingZone(): string | null {
    return null;
  }

  launchLanding(): boolean {
    return false;
  }

  // Nothing is ever contested here: no front takes a tile.
  setMonth(): void {}

  contestedCounts(): ReadonlyMap<NationId, number> {
    return new Map();
  }

  cede(): number {
    return 0;
  }

  settleContested(): number {
    return 0;
  }
}
