import { CityExecution } from "../../core/execution/CityExecution";
import { DefensePostExecution } from "../../core/execution/DefensePostExecution";
import { FactoryExecution } from "../../core/execution/FactoryExecution";
import { MissileSiloExecution } from "../../core/execution/MissileSiloExecution";
import { PlayerExecution } from "../../core/execution/PlayerExecution";
import { PortExecution } from "../../core/execution/PortExecution";
import { SAMLauncherExecution } from "../../core/execution/SAMLauncherExecution";
import {
  Execution,
  Game,
  Player,
  Structures,
  Unit,
  UnitType,
} from "../../core/game/Game";
import { NationId } from "../data/schemas/common";
import {
  CorePlayerState,
  TILE_FALLOUT_BIT,
  TILE_NATION_MASK,
  WorldState,
} from "../data/schemas/save";
import { TileGrid, WorldPort } from "../sim/VeritableSim";
import { NationBinding } from "./coreScenario";

// The only place where the Véritable simulation meets the OpenFront core.
//
// Tiles belong to nations: the core stores a 12-bit owner smallID per tile,
// this bridge maps smallID <-> NationId, and a save stores the index of the
// nation in the save's own nation table — never a smallID.
//
// What survives a reload (DECISIONS.md, option A): tile ownership, fallout,
// and per nation troops, gold, spawn tile and structures. In-flight state
// (attacks, boats, warheads, legacy AI, alliances, embargoes) does not.

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

  constructor(
    private readonly game: Game,
    bindings: readonly NationBinding[],
    // Whatever recreates this exact core game (OpenFront GameStartInfo).
    coreStart: unknown,
  ) {
    this.coreStart = canonicalJson(coreStart);
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
        grid: { ...this.pending.grid, tiles: this.pending.grid.tiles.slice() },
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
    this.game.forEachTile((tile) => {
      // Tiles of non-nations (tribes) are saved unowned.
      let value = smallIdToIndex.get(this.game.ownerID(tile)) ?? 0;
      if (this.game.hasFallout(tile)) value |= TILE_FALLOUT_BIT;
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
      grid: { width, height, tiles },
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
