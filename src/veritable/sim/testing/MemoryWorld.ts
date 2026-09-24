import { NationId } from "../../data/schemas/common";
import {
  TILE_CONTESTED_BIT,
  TILE_FALLOUT_BIT,
  TILE_NATION_MASK,
  WorldState,
} from "../../data/schemas/save";
import {
  FrontGeometry,
  NavalSnapshot,
  NukeAim,
  NukeOutcome,
  TileGrid,
  WorldPort,
} from "../VeritableSim";
import {
  captureAlong,
  frontTiles,
  GridAccess,
  segmentFront,
  Terrain,
} from "../war/geometry";
import { ContestLedger } from "../war/contest";

// In-memory WorldPort: a tiled world without the OpenFront core. Used by the
// simulation and save tests. Every tile is land; terrain is plains unless set;
// the sea is whatever the test declares (setNaval).
export class MemoryWorld implements WorldPort {
  private owners: (NationId | null)[];
  private fallout: boolean[];
  private ledger: ContestLedger;
  private terrain: Terrain[];
  private structures = new Map<number, number>(); // tile -> defence multiplier
  private segments = new Map<string, number[][]>(); // front id -> segment tiles
  private sea: NavalSnapshot = { coast: {}, ports: {}, ships: {} };
  // Zone a landing on each nation aims at, and the tiles it takes.
  private landingZones: Record<NationId, string> = {};
  landings: { attacker: NationId; target: NationId; radius: number }[] = [];
  coreStart: unknown = { memory: true };

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.owners = new Array(width * height).fill(null);
    this.fallout = new Array(width * height).fill(false);
    this.ledger = new ContestLedger(width * height);
    this.terrain = new Array<Terrain>(width * height).fill("plains");
  }

  setOwner(tile: number, nation: NationId | null): void {
    this.owners[tile] = nation;
  }

  ownerOf(tile: number): NationId | null {
    return this.owners[tile];
  }

  isContested(tile: number): boolean {
    return this.ledger.isContested(tile);
  }

  setMonth(month: number): void {
    this.ledger.setMonth(month);
  }

  contestedCounts(): ReadonlyMap<NationId, number> {
    return this.ledger.counts((tile) => this.owners[tile]);
  }

  cede(winner: NationId): number {
    return this.ledger.cede((tile) => this.owners[tile] === winner);
  }

  // Structures on the map, set by the tests.
  readonly built = new Map<NationId, Record<string, number>>();

  // Nuclear weapons (J5), as the tests declare them: capitals (tile index),
  // distance of a capital to its fronts, warheads that cannot leave, the
  // number of the next ones intercepted, and the radius a warhead burns
  // around its aim (the capital of the target, or its first tile).
  readonly capitals = new Map<NationId, number>();
  readonly frontDistances = new Map<NationId, number>();
  nukesBlocked = false;
  interceptNext = 0;
  nukeRadius = 1;
  readonly launched: {
    id: number;
    by: NationId;
    target: NationId;
    aim: NukeAim;
    weapon: "atom" | "hydrogen";
  }[] = [];
  private inFlight: MemoryWorld["launched"] = [];

  launchNuke(
    id: number,
    by: NationId,
    target: NationId,
    aim: NukeAim,
    weapon: "atom" | "hydrogen",
  ): boolean {
    if (this.nukesBlocked) return false;
    const launch = { id, by, target, aim, weapon };
    this.launched.push(launch);
    this.inFlight.push(launch);
    return true;
  }

  // Resolved at the next call: the tiles within the radius of the aim burn
  // (owner lost, fallout).
  nukeOutcomes(): NukeOutcome[] {
    const out: NukeOutcome[] = [];
    for (const launch of this.inFlight) {
      if (this.interceptNext > 0) {
        this.interceptNext -= 1;
        out.push({ id: launch.id, status: "intercepted", hits: {} });
        continue;
      }
      const aim =
        this.capitals.get(launch.target) ??
        this.owners.findIndex((o) => o === launch.target);
      const hits: Record<NationId, number> = {};
      if (aim >= 0) {
        const ax = aim % this.width;
        const ay = Math.floor(aim / this.width);
        const r = this.nukeRadius;
        for (let y = Math.max(0, ay - r); y <= Math.min(this.height - 1, ay + r); y++) {
          for (let x = Math.max(0, ax - r); x <= Math.min(this.width - 1, ax + r); x++) {
            const tile = y * this.width + x;
            const owner = this.owners[tile];
            if (owner === null) continue;
            hits[owner] = (hits[owner] ?? 0) + 1;
            this.owners[tile] = null;
            this.fallout[tile] = true;
            this.ledger.clear(tile);
          }
        }
      }
      out.push({ id: launch.id, status: "detonated", hits });
    }
    this.inFlight = [];
    return out;
  }

  capitalHeld(nation: NationId): boolean {
    const tile = this.capitals.get(nation);
    return tile === undefined || this.owners[tile] === nation;
  }

  capitalFrontDistance(nation: NationId): number | null {
    return this.frontDistances.get(nation) ?? null;
  }

  structureCounts(): ReadonlyMap<NationId, Record<string, number>> {
    return this.built;
  }

  settleContested(warMonths: number, cessionMonths: number): number {
    return this.ledger.settle(
      warMonths,
      cessionMonths,
      (tile) => this.owners[tile] !== null,
    );
  }

  setFallout(tile: number, value: boolean): void {
    this.fallout[tile] = value;
  }

  setTerrain(tile: number, terrain: Terrain): void {
    this.terrain[tile] = terrain;
  }

  // A defensive structure: its multiplier applies to the tiles within range.
  setStructure(tile: number, multiplier: number): void {
    this.structures.set(tile, multiplier);
  }

  setNaval(sea: NavalSnapshot, landingZones: Record<NationId, string> = {}) {
    this.sea = sea;
    this.landingZones = landingZones;
  }

  // Gives every tile of `from` to `to` (or to nobody).
  transferAll(from: NationId, to: NationId | null): number {
    let moved = 0;
    this.owners = this.owners.map((o, i) => {
      if (o !== from) return o;
      moved++;
      if (to !== null) this.ledger.mark(i);
      else this.ledger.clear(i);
      return to;
    });
    return moved;
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
    const contest = new Uint16Array(this.owners.length);
    this.owners.forEach((o, i) => {
      const owner = o === null ? 0 : (index.get(o) ?? 0);
      const contested = owner !== 0 && this.ledger.isContested(i);
      tiles[i] =
        owner |
        (this.fallout[i] ? TILE_FALLOUT_BIT : 0) |
        (contested ? TILE_CONTESTED_BIT : 0);
      if (contested) contest[i] = this.ledger.values[i];
    });
    return {
      world: { coreStart: this.coreStart, players: [] },
      grid: { width: this.width, height: this.height, tiles, contest },
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
    this.ledger.load(grid.tiles, grid.contest);
    this.segments.clear();
  }

  // --- fronts -------------------------------------------------------------------

  private grid(nations: readonly NationId[]): GridAccess {
    const index = new Map(nations.map((id, i) => [id, i + 1]));
    return {
      width: this.width,
      height: this.height,
      ownerAt: (tile) => {
        const o = this.owners[tile];
        return o === null ? 0 : (index.get(o) ?? 0);
      },
      terrainAt: (tile) => this.terrain[tile],
    };
  }

  fronts(
    pairs: readonly [NationId, NationId][],
    segmentTiles: number,
  ): FrontGeometry[] {
    const out: FrontGeometry[] = [];
    for (const [a, b] of pairs) {
      const nations = [a, b];
      const g = this.grid(nations);
      const candidates: number[] = [];
      this.owners.forEach((o, i) => {
        if (o === a || o === b) candidates.push(i);
      });
      const line = frontTiles(g, candidates, 1, 2);
      const id = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (line.length === 0) {
        this.segments.delete(id);
        continue;
      }
      const segments = segmentFront(g, line, segmentTiles);
      this.segments.set(
        id,
        segments.map((s) => s.tiles),
      );
      out.push({
        id,
        a: id.split("|")[0],
        b: id.split("|")[1],
        segments: segments.map((s) => {
          const defense: Record<NationId, number> = {};
          const supply: Record<NationId, number> = {};
          for (const n of nations) {
            // A structure of n within 2 tiles of a tile n holds here.
            let covered = 0;
            let held = 0;
            let bonus = 1;
            let near = 0;
            for (const tile of s.tiles) {
              if (this.owners[tile] !== n) continue;
              held++;
              for (const [at, multiplier] of this.structures) {
                if (this.owners[at] !== n) continue;
                const dx = Math.abs((at % this.width) - (tile % this.width));
                const dy = Math.abs(
                  Math.floor(at / this.width) - Math.floor(tile / this.width),
                );
                if (Math.max(dx, dy) <= 2) {
                  covered++;
                  bonus = Math.max(bonus, multiplier);
                  break;
                }
              }
            }
            for (const [at] of this.structures) {
              if (this.owners[at] === n) near++;
            }
            defense[n] = held === 0 ? 1 : 1 + (bonus - 1) * (covered / held);
            supply[n] = near;
          }
          return {
            index: s.index,
            tiles: s.tiles.length,
            terrain: s.terrain,
            defense,
            supply,
          };
        }),
      });
    }
    return out;
  }

  advance(
    front: string,
    segment: number,
    winner: NationId,
    loser: NationId,
    tiles: number,
  ): number {
    const segments = this.segments.get(front);
    if (segments === undefined || segments[segment] === undefined) return 0;
    const nations = [winner, loser];
    const g = this.grid(nations);
    const taken = captureAlong(g, segments[segment], 1, 2, tiles, (tile) => {
      this.owners[tile] = winner;
      this.ledger.mark(tile);
      this.fallout[tile] = false;
    });
    return taken.length;
  }

  // --- sea ------------------------------------------------------------------------

  naval(): NavalSnapshot {
    return this.sea;
  }

  landingZone(_attacker: NationId, target: NationId): string | null {
    return this.landingZones[target] ?? null;
  }

  // The beachhead: the first `radius` tiles of the target, at once.
  launchLanding(attacker: NationId, target: NationId, radius: number): boolean {
    if (this.landingZones[target] === undefined) return false;
    this.landings.push({ attacker, target, radius });
    let taken = 0;
    for (let i = 0; i < this.owners.length && taken < radius; i++) {
      if (this.owners[i] !== target) continue;
      this.owners[i] = attacker;
      this.ledger.mark(i);
      taken++;
    }
    return true;
  }
}
