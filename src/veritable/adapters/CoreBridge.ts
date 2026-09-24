import { CityExecution } from "../../core/execution/CityExecution";
import { DefensePostExecution } from "../../core/execution/DefensePostExecution";
import { FactoryExecution } from "../../core/execution/FactoryExecution";
import { MissileSiloExecution } from "../../core/execution/MissileSiloExecution";
import { NukeExecution } from "../../core/execution/NukeExecution";
import { PlayerExecution } from "../../core/execution/PlayerExecution";
import { PortExecution } from "../../core/execution/PortExecution";
import { SAMLauncherExecution } from "../../core/execution/SAMLauncherExecution";
import { TransportShipExecution } from "../../core/execution/TransportShipExecution";
import {
  Execution,
  Game,
  Player,
  Structures,
  TerrainType,
  Unit,
  UnitType,
} from "../../core/game/Game";
import { NationId } from "../data/schemas/common";
import { VeritableConfig } from "../data/schemas/config";
import {
  CorePlayerState,
  TILE_CONTESTED_BIT,
  TILE_FALLOUT_BIT,
  TILE_NATION_MASK,
  WorldState,
} from "../data/schemas/save";
import { Zones } from "../data/zonesFile";
import { ContestLedger } from "../sim/war/contest";
import {
  FrontGeometry,
  NavalSnapshot,
  NukeAim,
  NukeOutcome,
  TileGrid,
  WorldPort,
} from "../sim/VeritableSim";
import {
  captureAlong,
  frontTiles,
  GridAccess,
  segmentFront,
  Terrain,
} from "../sim/war/geometry";
import { NationBinding } from "./scenarioWorld";

// The only place where the Véritable simulation meets the OpenFront core.
//
// Tiles belong to nations: the core stores a 12-bit owner smallID per tile,
// this bridge maps smallID <-> NationId, and a save stores the index of the
// nation in the save's own nation table — never a smallID. Bit 12 of a saved
// tile marks land taken by war (contested); the bridge keeps that mask, the
// core knows nothing of it.
//
// What survives a reload (DECISIONS.md, option A): tile ownership, fallout,
// contested land, and per nation troops, gold, spawn tile and structures.
// In-flight state (attacks, boats, warheads, legacy AI, alliances) does not.
//
// Fronts (J3a): the geometry of a front is read off the border tiles of the
// two core players and cut into segments; captures ordered by the simulation
// conquer tiles through the core's own Player.conquer.

interface PendingRestore {
  nations: readonly NationId[];
  world: WorldState;
  grid: TileGrid;
}

export class CoreBridge implements WorldPort {
  private readonly byNation = new Map<NationId, Player>();
  private readonly bySmallID = new Map<number, NationId>();
  private pending: PendingRestore | null = null;
  private restoredAtTick: number | null = null;
  private readonly coreStart: unknown;
  // Contest of each tile (J5): month of the last capture, ceded or not.
  private readonly ledger: ContestLedger;
  // Segment tiles of the last computed geometry, by front id.
  private readonly segments = new Map<string, number[][]>();
  // Warheads launched (J5): their execution, and who owned each tile within
  // their blast radius at the launch (fallout tiles excluded), to count the
  // tiles each nation lost once the warhead has landed.
  private readonly launches = new Map<
    number,
    { exec: NukeExecution; before: Map<number, NationId> }
  >();

  constructor(
    private readonly game: Game,
    bindings: readonly NationBinding[],
    // Whatever recreates this exact core game (OpenFront GameStartInfo).
    coreStart: unknown,
    private readonly war: VeritableConfig["war"],
    private readonly zones: Zones | null = null,
    private readonly naval_?: VeritableConfig["naval"],
    private readonly logistics?: VeritableConfig["logistics"],
  ) {
    this.coreStart = canonicalJson(coreStart);
    this.ledger = new ContestLedger(game.width() * game.height());
    if (zones !== null && zones.tiles.length !== this.ledger.values.length) {
      throw new Error("maritime zones do not match the map");
    }
    // Landings take a beachhead around the landing tile (J3b).
    game.setVeritableLanding((player, tile) => this.beachhead(player, tile));
    for (const b of bindings) {
      this.byNation.set(b.nationId, b.player);
      this.bySmallID.set(b.player.smallID(), b.nationId);
    }
  }

  tileCounts(): ReadonlyMap<NationId, number> {
    const counts = new Map<NationId, number>();
    if (this.pending !== null) {
      const { nations, grid } = this.pending;
      for (const value of grid.tiles) {
        const owner = value & TILE_NATION_MASK;
        if (owner === 0) continue;
        const id = nations[owner - 1];
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      return counts;
    }
    for (const [id, player] of this.byNation) {
      counts.set(id, player.numTilesOwned());
    }
    return counts;
  }

  capture(nations: readonly NationId[]): { world: WorldState; grid: TileGrid } {
    if (this.pending !== null) {
      // Restore not applied yet (it runs inside the next core tick): the
      // world IS the pending save.
      return {
        world: structuredClone(this.pending.world),
        grid: {
          ...this.pending.grid,
          tiles: this.pending.grid.tiles.slice(),
          contest: this.pending.grid.contest?.slice(),
        },
      };
    }
    const width = this.game.width();
    const height = this.game.height();
    const indexOf = new Map(nations.map((id, i) => [id, i + 1]));
    const smallIdToIndex = new Map<number, number>();
    for (const [smallID, id] of this.bySmallID) {
      const index = indexOf.get(id);
      if (index !== undefined) smallIdToIndex.set(smallID, index);
    }

    const tiles = new Uint16Array(width * height);
    const contest = new Uint16Array(width * height);
    this.game.forEachTile((tile) => {
      // Tiles of non-nations (tribes) are saved unowned.
      let value = smallIdToIndex.get(this.game.ownerID(tile)) ?? 0;
      if (this.game.hasFallout(tile)) value |= TILE_FALLOUT_BIT;
      if (value !== 0 && this.ledger.isContested(tile)) {
        value |= TILE_CONTESTED_BIT;
        contest[tile] = this.ledger.values[tile];
      }
      tiles[tile] = value;
    });

    const players: CorePlayerState[] = [];
    for (const id of nations) {
      const player = this.byNation.get(id);
      if (player === undefined) continue; // nation without a core player
      players.push({
        nation: id,
        troops: player.troops(),
        gold: player.gold(),
        spawnTile: player.spawnTile() ?? null,
        structures: player
          .units()
          .filter((u) => Structures.has(u.type()) && u.isActive())
          .map((u) => ({ type: u.type(), tile: u.tile(), level: u.level() }))
          .sort((a, b) => a.tile - b.tile || a.type.localeCompare(b.type)),
      });
    }

    return {
      world: { coreStart: this.coreStart, players },
      grid: { width, height, tiles, contest },
    };
  }

  // The restore is applied by an Execution during the next core tick, so that
  // every tile, player and unit update reaches the client like any other.
  // It must target a freshly created core game.
  restore(
    nations: readonly NationId[],
    world: WorldState,
    grid: TileGrid,
  ): void {
    if (
      grid.width !== this.game.width() ||
      grid.height !== this.game.height()
    ) {
      throw new Error(
        `save is ${grid.width}x${grid.height}, map is ${this.game.width()}x${this.game.height()}`,
      );
    }
    for (const id of nations) {
      const hasTiles = world.players.some((p) => p.nation === id);
      if (hasTiles && !this.byNation.has(id)) {
        throw new Error(`save nation ${id} has no player in the core game`);
      }
    }
    this.pending = { nations, world, grid };
    this.segments.clear();
    this.game.addExecution(new RestoreExecution(() => this.applyPending()));
  }

  hasPendingRestore(): boolean {
    return this.pending !== null;
  }

  // True right after the core tick that applied a restore: that tick rebuilt
  // the world, it is not campaign time.
  restoredDuringLastTick(): boolean {
    return (
      this.restoredAtTick !== null &&
      this.game.ticks() <= this.restoredAtTick + 1
    );
  }

  private applyPending(): void {
    if (this.pending === null) return;
    const { nations, world, grid } = this.pending;
    const game = this.game;

    this.ledger.load(grid.tiles, grid.contest);
    grid.tiles.forEach((value, tile) => {
      const owner = value & TILE_NATION_MASK;
      if (owner !== 0) {
        const player = this.byNation.get(nations[owner - 1]);
        if (player === undefined) {
          throw new Error(`tile ${tile}: nation without a core player`);
        }
        player.conquer(tile);
      } else if (game.hasOwner(tile)) {
        (game.owner(tile) as Player).relinquish(tile);
      }
    });
    // Fallout after ownership: conquering a tile clears it.
    grid.tiles.forEach((value, tile) => {
      if ((value & TILE_FALLOUT_BIT) !== 0) game.setFallout(tile, true);
    });

    for (const saved of world.players) {
      const player = this.byNation.get(saved.nation);
      if (player === undefined) continue;
      if (saved.spawnTile !== null) {
        if (!player.hasSpawned()) {
          game.addExecution(new PlayerExecution(player));
        }
        player.setSpawnTile(saved.spawnTile);
      }
      for (const s of saved.structures) {
        const unit = player.buildUnit(s.type as UnitType, s.tile, {});
        for (let level = 1; level < s.level; level++) unit.increaseLevel();
        const exec = structureExecution(game, player, unit);
        if (exec !== null) game.addExecution(exec);
      }
      // Last: building structures costs gold.
      player.setTroops(saved.troops);
      player.removeGold(player.gold());
      player.addGold(saved.gold);
    }

    this.pending = null;
    this.restoredAtTick = game.ticks();
    if (game.inSpawnPhase()) game.endSpawnPhase();
  }

  // --- fronts -------------------------------------------------------------------

  isContested(tile: number): boolean {
    return this.ledger.isContested(tile);
  }

  // --- contest (J5) -------------------------------------------------------------

  private nationAt(tile: number): NationId | null {
    if (!this.game.hasOwner(tile)) return null;
    return this.bySmallID.get(this.game.ownerID(tile)) ?? null;
  }

  setMonth(month: number): void {
    this.ledger.setMonth(month);
  }

  contestedCounts(): ReadonlyMap<NationId, number> {
    if (this.pending !== null) return new Map();
    return this.ledger.counts((tile) => this.nationAt(tile));
  }

  cede(winner: NationId): number {
    if (this.pending !== null) return 0;
    return this.ledger.cede((tile) => this.nationAt(tile) === winner);
  }

  settleContested(warMonths: number, cessionMonths: number): number {
    if (this.pending !== null) return 0;
    return this.ledger.settle(
      warMonths,
      cessionMonths,
      (tile) => this.nationAt(tile) !== null,
    );
  }

  // --- nuclear weapons (J5) ------------------------------------------------------

  capitalHeld(nation: NationId): boolean {
    const player = this.byNation.get(nation);
    const capital = player?.spawnTile();
    if (player === undefined || capital === undefined) return true;
    return this.game.owner(capital) === player;
  }

  capitalFrontDistance(nation: NationId): number | null {
    const capital = this.byNation.get(nation)?.spawnTile();
    if (capital === undefined) return null;
    const g = this.game;
    const cx = g.x(capital);
    const cy = g.y(capital);
    let best: number | null = null;
    for (const [id, segments] of this.segments) {
      if (!id.split("|").includes(nation)) continue;
      for (const tiles of segments) {
        for (const tile of tiles) {
          const d = Math.max(Math.abs(g.x(tile) - cx), Math.abs(g.y(tile) - cy));
          if (best === null || d < best) best = d;
        }
      }
    }
    return best;
  }

  launchNuke(
    id: number,
    by: NationId,
    target: NationId,
    aim: NukeAim,
    weapon: "atom" | "hydrogen",
  ): boolean {
    if (this.pending !== null) return false;
    const player = this.byNation.get(by);
    const enemy = this.byNation.get(target);
    if (player === undefined || enemy === undefined) return false;
    const dst = this.nukeTarget(enemy, aim);
    if (dst === null || !this.ensureSilo(player)) return false;
    const type = weapon === "atom" ? UnitType.AtomBomb : UnitType.HydrogenBomb;
    const g = this.game;
    // The warhead is the Véritable arsenal's, not bought with legacy gold.
    player.addGold(g.unitInfo(type).cost(g, player));
    const before = new Map<number, NationId>();
    const radius = g.config().nukeMagnitudes(type).outer;
    const x0 = g.x(dst);
    const y0 = g.y(dst);
    for (let y = Math.max(0, y0 - radius); y <= Math.min(g.height() - 1, y0 + radius); y++) {
      for (let x = Math.max(0, x0 - radius); x <= Math.min(g.width() - 1, x0 + radius); x++) {
        const tile = g.ref(x, y);
        if (!g.hasOwner(tile) || g.hasFallout(tile)) continue;
        const owner = this.bySmallID.get(g.ownerID(tile));
        if (owner !== undefined) before.set(tile, owner);
      }
    }
    const exec = new NukeExecution(type, player, dst);
    g.addExecution(exec);
    this.launches.set(id, { exec, before });
    return true;
  }

  nukeOutcomes(): NukeOutcome[] {
    const out: NukeOutcome[] = [];
    for (const [id, launch] of [...this.launches].sort((a, b) => a[0] - b[0])) {
      if (launch.exec.isActive()) continue;
      this.launches.delete(id);
      if (launch.exec.getNuke() === null) {
        out.push({ id, status: "failed", hits: {} });
        continue;
      }
      const hits: Record<NationId, number> = {};
      for (const [tile, owner] of launch.before) {
        if (this.game.hasFallout(tile)) hits[owner] = (hits[owner] ?? 0) + 1;
      }
      const landed = Object.keys(hits).length > 0;
      out.push({ id, status: landed ? "detonated" : "intercepted", hits });
    }
    return out;
  }

  // The tile a warhead aims at: the middle of the enemy's side of a front
  // segment, its capital, or one of its cities (the largest first).
  private nukeTarget(enemy: Player, aim: NukeAim): number | null {
    const g = this.game;
    if (aim.kind === "front") {
      const tiles = (this.segments.get(aim.front)?.[aim.segment] ?? []).filter(
        (t) => g.owner(t) === enemy,
      );
      if (tiles.length > 0) return tiles[Math.floor(tiles.length / 2)];
    }
    const capital = enemy.spawnTile();
    if (aim.kind !== "city" && capital !== undefined && g.owner(capital) === enemy) {
      return capital;
    }
    const cities = enemy
      .units(UnitType.City)
      .filter((u) => u.isActive())
      .sort((a, b) => b.level() - a.level() || a.tile() - b.tile());
    if (cities.length > 0) {
      const index = aim.kind === "city" ? aim.index : 0;
      return cities[index % cities.length].tile();
    }
    if (capital !== undefined && g.owner(capital) === enemy) return capital;
    return null;
  }

  // A silo near the capital, built at once when the nation has none (a save
  // made before the J5, or a silo lost to the war).
  private ensureSilo(player: Player): boolean {
    if (player.units(UnitType.MissileSilo).some((u) => u.isActive())) {
      return true;
    }
    const g = this.game;
    const capital = player.spawnTile();
    if (capital === undefined) return false;
    const cx = g.x(capital);
    const cy = g.y(capital);
    for (let r = 4; r <= 40; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (!g.isValidCoord(x, y)) continue;
          const tile = g.ref(x, y);
          if (g.owner(tile) !== player || !g.isLand(tile)) continue;
          player.addGold(g.unitInfo(UnitType.MissileSilo).cost(g, player));
          const spawn = player.canBuild(UnitType.MissileSilo, tile);
          if (spawn === false) continue;
          const unit = player.buildUnit(UnitType.MissileSilo, spawn, {});
          const exec = structureExecution(g, player, unit);
          if (exec !== null) g.addExecution(exec);
          return true;
        }
      }
    }
    return false;
  }

  structureCounts(): ReadonlyMap<NationId, Record<string, number>> {
    const counts = new Map<NationId, Record<string, number>>();
    if (this.pending !== null) return counts;
    for (const [id, player] of this.byNation) {
      const count: Record<string, number> = {};
      for (const unit of player.units()) {
        const type = unit.type();
        if (!unit.isActive()) continue;
        if (!Structures.has(type) && type !== UnitType.Warship) continue;
        count[type] = (count[type] ?? 0) + Math.max(1, unit.level());
      }
      counts.set(id, count);
    }
    return counts;
  }

  // What the map overlay draws (client, campaign): the line of every
  // segment of the last computed geometry, as the centres of runs of `step`
  // tiles along the line (the tiles of both sides alternate: a centre is
  // smoother than the tiles), and the contested tiles, sent again only when
  // they changed since `contestedVersion`.
  overlay(step: number, contestedVersion: number): MapOverlay {
    const fronts: MapOverlay["fronts"] = [];
    const width = this.game.width();
    for (const [id, segments] of this.segments) {
      fronts.push({
        id,
        segments: segments.map((tiles, index) => {
          const points: number[] = [];
          for (let i = 0; i < tiles.length; i += step) {
            const end = Math.min(tiles.length, i + step);
            let x = 0;
            let y = 0;
            for (let j = i; j < end; j++) {
              x += tiles[j] % width;
              y += Math.floor(tiles[j] / width);
            }
            points.push(x / (end - i) + 0.5, y / (end - i) + 0.5);
          }
          const mid = Math.floor(points.length / 4) * 2;
          return {
            index,
            points,
            mid: [points[mid] ?? 0, points[mid + 1] ?? 0],
          };
        }),
      });
    }
    const version = this.ledger.version();
    return {
      width,
      height: this.game.height(),
      fronts,
      contestedVersion: version,
      contested: version === contestedVersion ? null : this.ledger.tiles(),
    };
  }

  private grid(nations: readonly NationId[]): GridAccess {
    const bySmall = new Map<number, number>();
    nations.forEach((id, i) => {
      const player = this.byNation.get(id);
      if (player !== undefined) bySmall.set(player.smallID(), i + 1);
    });
    const game = this.game;
    return {
      width: game.width(),
      height: game.height(),
      ownerAt: (tile) => bySmall.get(game.ownerID(tile)) ?? 0,
      terrainAt: (tile) => terrainOf(game.terrainType(tile)),
    };
  }

  fronts(
    pairs: readonly [NationId, NationId][],
    segmentTiles: number,
  ): FrontGeometry[] {
    if (this.pending !== null) return [];
    const out: FrontGeometry[] = [];
    const config = this.game.config();
    for (const [a, b] of pairs) {
      const pa = this.byNation.get(a);
      const pb = this.byNation.get(b);
      if (pa === undefined || pb === undefined) continue;
      const nations = [a, b];
      const g = this.grid(nations);
      // Ports and cities of each side, for the supply of the segments.
      const depots = nations.map((n, i) =>
        (i === 0 ? pa : pb)
          .units(UnitType.Port, UnitType.City)
          .map((u) => u.tile()),
      );
      const range = this.logistics?.range ?? 0;
      const candidates: number[] = [];
      pa.borderTiles().forEach((t) => candidates.push(t));
      pb.borderTiles().forEach((t) => candidates.push(t));
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
          nations.forEach((n, i) => {
            const player = i === 0 ? pa : pb;
            let held = 0;
            let posts = 0;
            let cities = 0;
            for (const tile of s.tiles) {
              if (g.ownerAt(tile) !== i + 1) continue;
              held++;
              if (
                this.game.hasUnitNearby(
                  tile,
                  config.defensePostRange(),
                  UnitType.DefensePost,
                  player.id(),
                )
              ) {
                posts++;
              }
              if (
                this.game.hasUnitNearby(
                  tile,
                  this.war.cityDefenseRange,
                  UnitType.City,
                  player.id(),
                )
              ) {
                cities++;
              }
            }
            defense[n] =
              held === 0
                ? 1
                : (1 +
                    (config.defensePostDefenseBonus() - 1) * (posts / held)) *
                  (1 + (this.war.cityDefense - 1) * (cities / held));
            // Logistics: ports and cities of n within range of the segment.
            supply[n] = this.depotsNear(depots[i], s.tiles, range);
          });
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

  // Number of depots (port or city tiles) within `range` tiles (Chebyshev)
  // of at least one tile of the segment.
  private depotsNear(depots: number[], tiles: number[], range: number): number {
    if (depots.length === 0 || range <= 0) return 0;
    const width = this.game.width();
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const tile of tiles) {
      const x = tile % width;
      const y = Math.floor(tile / width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    let count = 0;
    for (const depot of depots) {
      const dx = depot % width;
      const dy = Math.floor(depot / width);
      // Cheap rejection on the bounding box, then the exact test.
      if (
        dx < minX - range ||
        dx > maxX + range ||
        dy < minY - range ||
        dy > maxY + range
      ) {
        continue;
      }
      for (const tile of tiles) {
        if (
          Math.abs((tile % width) - dx) <= range &&
          Math.abs(Math.floor(tile / width) - dy) <= range
        ) {
          count++;
          break;
        }
      }
    }
    return count;
  }

  advance(
    front: string,
    segment: number,
    winner: NationId,
    loser: NationId,
    tiles: number,
  ): number {
    if (this.pending !== null) return 0;
    const segments = this.segments.get(front);
    const player = this.byNation.get(winner);
    if (segments === undefined || segments[segment] === undefined) return 0;
    if (player === undefined || !this.byNation.has(loser)) return 0;
    const g = this.grid([winner, loser]);
    const taken = captureAlong(g, segments[segment], 1, 2, tiles, (tile) => {
      player.conquer(tile);
      this.ledger.mark(tile);
    });
    if (taken.length > 0) this.sea = null;
    return taken.length;
  }

  // --- sea ------------------------------------------------------------------------

  private sea: { tick: number; snapshot: NavalSnapshot } | null = null;

  private zoneOfWater(tile: number): string | null {
    if (this.zones === null) return null;
    const z = this.zones.tiles[tile];
    return z === 0 ? null : this.zones.zones[z - 1];
  }

  // Zones of the water next to a land tile.
  private zonesAround(tile: number, out: Set<string>): void {
    for (const n of this.game.neighbors(tile)) {
      if (!this.game.isWater(n)) continue;
      const zone = this.zoneOfWater(n);
      if (zone !== null) out.add(zone);
    }
  }

  // Coasts and ports of every nation, warships by zone. Coasts move slowly:
  // the snapshot is kept for a game week of ticks (a performance cache, not a
  // rule), and dropped by captures and transfers.
  naval(): NavalSnapshot {
    const tick = this.game.ticks();
    if (this.sea !== null && tick - this.sea.tick < 140) {
      return this.sea.snapshot;
    }
    const coast: Record<NationId, string[]> = {};
    const ports: Record<NationId, string[]> = {};
    const ships: Record<string, Record<NationId, number>> = {};
    if (this.pending === null) {
      for (const [id, player] of this.byNation) {
        const zones = new Set<string>();
        player.borderTiles().forEach((tile) => {
          if (this.game.isOceanShore(tile)) this.zonesAround(tile, zones);
        });
        coast[id] = [...zones].sort();
        const portZones = new Set<string>();
        for (const unit of player.units(UnitType.Port)) {
          if (unit.isActive()) this.zonesAround(unit.tile(), portZones);
        }
        ports[id] = [...portZones].sort();
        for (const unit of player.units(UnitType.Warship)) {
          if (!unit.isActive()) continue;
          const zone = this.zoneOfWater(unit.tile());
          if (zone === null) continue;
          (ships[zone] ??= {})[id] = (ships[zone][id] ?? 0) + 1;
        }
      }
    }
    this.sea = { tick, snapshot: { coast, ports, ships } };
    return this.sea.snapshot;
  }

  // The landing tile: an enemy port, else the enemy shore nearest to the
  // attacker's capital (spawn tile).
  private landingTile(attacker: NationId, target: NationId): number | null {
    const me = this.byNation.get(attacker);
    const enemy = this.byNation.get(target);
    if (me === undefined || enemy === undefined) return null;
    const from = me.spawnTile() ?? null;
    const candidates: number[] = [];
    for (const unit of enemy.units(UnitType.Port)) {
      if (unit.isActive()) candidates.push(unit.tile());
    }
    if (candidates.length === 0) {
      enemy.borderTiles().forEach((tile) => {
        if (this.game.isOceanShore(tile)) candidates.push(tile);
      });
    }
    if (candidates.length === 0) return null;
    if (from === null) return candidates.sort((a, b) => a - b)[0];
    let best = candidates[0];
    let bestD = Infinity;
    for (const tile of candidates) {
      const d = this.game.manhattanDist(from, tile);
      if (d < bestD || (d === bestD && tile < best)) {
        best = tile;
        bestD = d;
      }
    }
    return best;
  }

  landingZone(attacker: NationId, target: NationId): string | null {
    if (this.pending !== null) return null;
    const tile = this.landingTile(attacker, target);
    if (tile === null) return null;
    const zones = new Set<string>();
    this.zonesAround(tile, zones);
    return [...zones].sort()[0] ?? null;
  }

  private pendingBeachheads = new Map<number, number>(); // tile -> radius

  launchLanding(attacker: NationId, target: NationId, radius: number): boolean {
    if (this.pending !== null) return false;
    const me = this.byNation.get(attacker);
    const tile = this.landingTile(attacker, target);
    if (me === undefined || tile === null) return false;
    // The legacy transport carries core troops; the beachhead does not use
    // them, they come back with the boat.
    const troops = Math.max(1, Math.floor(me.troops() / 10));
    this.pendingBeachheads.set(tile, radius);
    this.game.addExecution(new TransportShipExecution(me, tile, troops));
    return true;
  }

  // On arrival: the tiles of the defender within `radius` of the landing tile.
  private beachhead(player: Player, tile: number): void {
    const radius = this.pendingBeachheads.get(tile) ?? 1;
    this.pendingBeachheads.delete(tile);
    const defender = this.game.owner(tile);
    void defender;
    const x0 = this.game.x(tile);
    const y0 = this.game.y(tile);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = x0 + dx;
        const y = y0 + dy;
        if (
          x < 0 ||
          y < 0 ||
          x >= this.game.width() ||
          y >= this.game.height()
        ) {
          continue;
        }
        const t = this.game.ref(x, y);
        if (!this.game.isLand(t) || this.game.isImpassable(t)) continue;
        const owner = this.game.owner(t);
        if (!owner.isPlayer() || owner === player) continue;
        if (!this.bySmallID.has(owner.smallID())) continue;
        player.conquer(t);
        this.ledger.mark(t);
      }
    }
    this.segments.clear();
  }

  transferAll(from: NationId, to: NationId): number {
    if (this.pending !== null) return 0;
    const loser = this.byNation.get(from);
    const winner = this.byNation.get(to);
    if (loser === undefined || winner === undefined) return 0;
    const tiles = [...loser.tiles()];
    for (const tile of tiles) {
      winner.conquer(tile);
      this.ledger.mark(tile);
    }
    this.segments.clear();
    this.sea = null;
    return tiles.length;
  }
}

function terrainOf(type: TerrainType): Terrain {
  switch (type) {
    case TerrainType.Mountain:
      return "mountain";
    case TerrainType.Highland:
      return "highland";
    default:
      return "plains";
  }
}

// The map overlay of a campaign (client): lines of the fronts, contested
// tiles.
export interface MapOverlay {
  width: number;
  height: number;
  fronts: {
    id: string;
    segments: { index: number; points: number[]; mid: [number, number] }[];
  }[];
  contestedVersion: number;
  // Tile indices under contest; null when unchanged since the version asked.
  contested: Uint32Array | null;
}

// Plain JSON value with object keys sorted: the same GameStartInfo always
// serializes to the same bytes, whatever built it (UI, zod parse of a save).
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonicalJson(v);
    }
    return out;
  }
  return value;
}

function structureExecution(
  game: Game,
  player: Player,
  unit: Unit,
): Execution | null {
  switch (unit.type()) {
    case UnitType.City:
      return new CityExecution(unit);
    case UnitType.Port:
      return new PortExecution(unit);
    case UnitType.MissileSilo:
      return new MissileSiloExecution(unit);
    case UnitType.DefensePost:
      return new DefensePostExecution(unit);
    case UnitType.SAMLauncher:
      return new SAMLauncherExecution(player, null, unit);
    case UnitType.Factory:
      return new FactoryExecution(unit);
    default:
      return null;
  }
}

class RestoreExecution implements Execution {
  private active = true;
  constructor(private readonly apply: () => void) {}

  init(): void {}
  // In tick(), not init(): the core drops executions added while it is
  // initializing others, and the restore adds several.
  tick(): void {
    this.apply();
    this.active = false;
  }
  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
