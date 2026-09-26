import { NationId } from "../../data/schemas/common";
import {
  ContaminationEntry,
  TILE_CONTESTED_BIT,
  TILE_FALLOUT_BIT,
  TILE_NATION_MASK,
  WorldState,
} from "../../data/schemas/save";
import { ContaminationTiles } from "../nuclear/contamination";
import {
  BlastSite,
  FrontGeometry,
  NavalSnapshot,
  NukeAim,
  NukeOutcome,
  Occupations,
  TileGrid,
  WorldPort,
} from "../VeritableSim";
import { borderAlong } from "../war/borderWalk";
import { ClaimTiles, ClaimTilesInput } from "../war/claimTiles";
import { ContestLedger } from "../war/contest";
import {
  captureAlong,
  frontTiles,
  GridAccess,
  segmentFront,
  Terrain,
} from "../war/geometry";
import { PeopleInput, PeopleTiles } from "../war/people";

// In-memory WorldPort: a tiled world without the OpenFront core. Used by the
// simulation and save tests. Every tile is land; terrain is plains unless set;
// the sea is whatever the test declares (setNaval).
export class MemoryWorld implements WorldPort {
  private owners: (NationId | null)[];
  private fallout: boolean[];
  private ledger: ContestLedger;
  private claims: ClaimTiles;
  // J7b: off unless a test gives the people of the tiles (setPeople).
  private people: PeopleTiles;
  // J7c: the contamination of the simulation, and the size of a tile (km).
  private contamination = new ContaminationTiles();
  tileKm = 1;
  private urban = { threshold: Infinity, defense: 1 };
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
    this.claims = new ClaimTiles(width * height, null);
    this.people = new PeopleTiles(width * height, null);
    this.terrain = new Array<Terrain>(width * height).fill("plains");
  }

  // J7b: the people of the tiles (and the capitals and cities); the owners
  // of now are its first count. Urban tiles, above `threshold` people,
  // defend `defense` times.
  setPeople(
    input: PeopleInput,
    urban: { threshold: number; defense: number } = this.urban,
  ): void {
    this.people = new PeopleTiles(this.owners.length, input);
    this.people.prime((tile) => this.owners[tile]);
    this.urban = urban;
  }

  peopleKnown(): boolean {
    return this.people.known();
  }

  peopleHoldings(): ReadonlyMap<NationId, number> {
    return this.people.holdings();
  }

  takeOccupations(): Occupations {
    return this.people.take();
  }

  // Every change of owner goes through here (the people follow).
  private changeOwner(tile: number, to: NationId | null): void {
    const from = this.owners[tile];
    this.owners[tile] = to;
    this.ownerChanges++;
    this.people.ownerChanged(tile, from, to);
    this.contamination.ownerChanged(tile);
  }

  // Claims (J6): the regions the test declares, and the owners of the
  // tiles as they are now taken as the first day.
  setClaims(regions: ReadonlyMap<string, Uint32Array>): void {
    const nations: NationId[] = [];
    const firstDay = new Uint16Array(this.owners.length);
    this.owners.forEach((o, i) => {
      if (o === null) return;
      let index = nations.indexOf(o);
      if (index < 0) index = nations.push(o) - 1;
      firstDay[i] = index + 1;
    });
    const input: ClaimTilesInput = { regions, firstDay, nations };
    this.claims = new ClaimTiles(this.owners.length, input);
  }

  isSettled(tile: number): boolean {
    return this.claims.isSettled(tile);
  }

  claimHolders(region: string): ReadonlyMap<NationId, number> {
    return this.claims.holders(
      region,
      `${this.ownerChanges}`,
      (tile) => this.owners[tile],
    );
  }

  settleClaims(
    winner: NationId,
    loser: NationId,
    regions: readonly string[],
  ): number {
    return this.claims.settle(winner, loser, regions, (t) => this.owners[t]);
  }

  // Bumped whenever an owner changes (claim counts are cached on it).
  private ownerChanges = 0;

  setOwner(tile: number, nation: NationId | null): void {
    this.changeOwner(tile, nation);
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
  // number of the next ones intercepted. A warhead bursts on its aim (the
  // capital of the target, or its first tile); J7c: the land keeps its
  // owner.
  readonly capitals = new Map<NationId, number>();
  readonly frontDistances = new Map<NationId, number>();
  nukesBlocked = false;
  interceptNext = 0;
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

  // Resolved at the next call: the warhead bursts on its aim.
  nukeOutcomes(): NukeOutcome[] {
    const out: NukeOutcome[] = [];
    for (const launch of this.inFlight) {
      if (this.interceptNext > 0) {
        this.interceptNext -= 1;
        out.push({ id: launch.id, status: "intercepted", tile: null });
        continue;
      }
      const aim =
        this.capitals.get(launch.target) ??
        this.owners.findIndex((o) => o === launch.target);
      out.push({
        id: launch.id,
        status: "detonated",
        tile: aim >= 0 ? aim : null,
      });
    }
    this.inFlight = [];
    return out;
  }

  // J7c: square tiles of `tileKm`.
  blastTiles(tile: number, radiusKm: number): BlastSite[] {
    const out: BlastSite[] = [];
    const cx = tile % this.width;
    const cy = Math.floor(tile / this.width);
    const r = Math.ceil(radiusKm / this.tileKm) + 1;
    for (
      let y = Math.max(0, cy - r);
      y <= Math.min(this.height - 1, cy + r);
      y++
    ) {
      for (
        let x = Math.max(0, cx - r);
        x <= Math.min(this.width - 1, cx + r);
        x++
      ) {
        const t = y * this.width + x;
        out.push({
          tile: t,
          owner: this.owners[t],
          dxKm: (x - cx) * this.tileKm,
          dyKm: (y - cy) * this.tileKm,
          areaKm2: this.tileKm * this.tileKm,
          people: this.people.peopleAt(t),
        });
      }
    }
    return out;
  }

  setContamination(entries: readonly ContaminationEntry[]): void {
    this.contamination.set(entries, this.people, (t) => this.owners[t]);
  }

  contaminatedShares(): ReadonlyMap<NationId, number> {
    const known = this.people.known();
    const holdings = this.people.holdings();
    const counts = known ? null : this.tileCounts();
    return this.contamination.sharesOf(
      (t) => this.owners[t],
      (t) => (known ? this.people.peopleAt(t) : 1),
      (n) => (known ? (holdings.get(n) ?? 0) : (counts?.get(n) ?? 0)),
    );
  }

  homelandHeld(nation: NationId): {
    tiles: ReadonlyMap<NationId, number>;
    people: ReadonlyMap<NationId, number>;
  } {
    const tiles = new Map<NationId, number>();
    const people = new Map<NationId, number>();
    for (const tile of this.claims.homeland(nation)) {
      const owner = this.owners[tile];
      if (owner === null) continue;
      tiles.set(owner, (tiles.get(owner) ?? 0) + 1);
      const p = this.people.peopleAt(tile);
      if (p > 0) people.set(owner, (people.get(owner) ?? 0) + p);
    }
    return { tiles, people };
  }

  returnHomeland(nation: NationId, from: NationId): number {
    if (nation === from) return 0;
    let moved = 0;
    this.ownerChanges++;
    for (const tile of this.claims.homeland(nation)) {
      if (this.owners[tile] !== from) continue;
      this.claims.unsettle(tile, from);
      this.ledger.clear(tile);
      this.changeOwner(tile, nation);
      moved++;
    }
    return moved;
  }

  contaminationAt(tile: number): number {
    return this.contamination.levelAt(tile);
  }

  capitalHeld(nation: NationId): boolean {
    const tile = this.capitals.get(nation);
    return tile === undefined || this.owners[tile] === nation;
  }

  capitalFrontDistance(nation: NationId): number | null {
    return this.frontDistances.get(nation) ?? null;
  }

  mapWidth(): number {
    return this.width;
  }

  // The capital the test declares, else the first tile of the nation.
  capitalTile(nation: NationId): number | null {
    const declared = this.capitals.get(nation);
    if (declared !== undefined) return declared;
    const first = this.owners.indexOf(nation);
    return first < 0 ? null : first;
  }

  borderTile(a: NationId, b: NationId): number | null {
    const from = this.capitalTile(a);
    const to = this.capitalTile(b);
    if (from === null || to === null) return to;
    return borderAlong(this.width, from, to, (t) => this.owners[t], a, b);
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
    this.ownerChanges++;
    this.owners.forEach((o, i) => {
      if (o !== from) return;
      moved++;
      if (to !== null) this.ledger.mark(i);
      else this.ledger.clear(i);
      this.changeOwner(i, to);
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
    this.claims.write(tiles);
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
    this.claims.load(grid.tiles);
    // A load is no occupation (J7b).
    this.people.load();
    this.people.prime((tile) => this.owners[tile]);
    this.ownerChanges++;
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
            let urban = 0;
            for (const tile of s.tiles) {
              if (this.owners[tile] !== n) continue;
              held++;
              if (this.people.isUrban(tile, this.urban.threshold)) urban++;
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
            defense[n] =
              held === 0
                ? 1
                : (1 + (bonus - 1) * (covered / held)) *
                  (1 + (this.urban.defense - 1) * (urban / held));
            supply[n] = near;
          }
          return {
            index: s.index,
            tiles: s.tiles.length,
            terrain: s.terrain,
            defense,
            supply,
            contamination: this.contamination.meanOf(s.tiles),
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
    toward: number | null = null,
  ): number {
    const segments = this.segments.get(front);
    if (segments === undefined || segments[segment] === undefined) return 0;
    const nations = [winner, loser];
    const g = this.grid(nations);
    const taken = captureAlong(
      g,
      segments[segment],
      1,
      2,
      tiles,
      (tile) => {
        this.changeOwner(tile, winner);
        this.ledger.mark(tile);
        this.fallout[tile] = false;
      },
      toward,
    );
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
      this.changeOwner(i, attacker);
      this.ledger.mark(i);
      taken++;
    }
    return true;
  }
}
