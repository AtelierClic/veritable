import {
  Cell,
  Game,
  Nation,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../core/game/Game";
import { PseudoRandom } from "../../core/PseudoRandom";
import { Borders } from "../data/bordersFile";
import { BordersMeta } from "../data/DataSource";
import { vt } from "../data/i18n";
import { NationId } from "../data/schemas/common";
import { NationData } from "../data/schemas/nation";
import { WorldState } from "../data/schemas/save";
import { Scenario } from "../data/schemas/scenario";
import { Zones } from "../data/zonesFile";
import { SimData } from "../sim/economy/context";
import { TileGrid } from "../sim/VeritableSim";

// The scenario loader: a campaign starts from the fixed borders of its
// scenario. There is no spawn phase and no map-manifest roster any more.

export interface ScenarioPack {
  scenario: Scenario;
  nations: NationData[]; // in scenario order
  borders: Borders;
  meta: BordersMeta;
  zones: Zones; // maritime zones of the map (J3b)
  // Tiles of the contested regions (J6, claims); none without a regions file.
  regions?: ReadonlyMap<string, Uint32Array>;
  data: SimData; // goods, rest of the world, blocs, geography
}

export interface NationBinding {
  nationId: NationId;
  player: Player;
}

export function nationDisplayName(data: NationData): string {
  return vt(data.name);
}

export function playerNationOf(
  pack: ScenarioPack,
  requested?: string,
): NationId {
  const id = requested ?? pack.scenario.playerDefault;
  if (!pack.scenario.nations.includes(id)) {
    throw new Error(`${id} is not a nation of scenario ${pack.scenario.id}`);
  }
  return id;
}

// Core roster of the campaign: one Nation-type player per nation of the
// scenario, except the one the human embodies. Passed to createGameRunner.
export function coreRoster(
  pack: ScenarioPack,
  playerNation: NationId,
): (random: PseudoRandom) => Nation[] {
  return (random) =>
    pack.nations
      .filter((n) => n.id !== playerNation)
      .map((n) => {
        const [x, y] = pack.meta.capitals[n.id];
        return new Nation(
          new Cell(x, y),
          new PlayerInfo(
            nationDisplayName(n),
            PlayerType.Nation,
            null,
            random.nextID(),
            false,
            null,
            [],
            null,
            null,
            n.id,
          ),
        );
      });
}

// Nation <-> core player, by the nation id carried by PlayerInfo (J3; it was
// the display name until then). The human is the player's nation: a human
// without an id (tests, older lobbies) is accepted for it.
export function bindScenario(
  game: Game,
  pack: ScenarioPack,
  playerNation: NationId,
): NationBinding[] {
  const players = game.allPlayers();
  return pack.nations.map((nation) => {
    const player =
      nation.id === playerNation
        ? players.find(
            (p) =>
              p.type() === PlayerType.Human &&
              (p.info().nationId === nation.id || p.info().nationId === null),
          )
        : players.find(
            (p) =>
              p.type() === PlayerType.Nation && p.info().nationId === nation.id,
          );
    if (player === undefined) {
      throw new Error(`no core player for nation ${nation.id}`);
    }
    return { nationId: nation.id, player };
  });
}

function assertSameGrid(game: Game, pack: ScenarioPack): void {
  if (
    pack.borders.width !== game.width() ||
    pack.borders.height !== game.height()
  ) {
    throw new Error(
      `scenario ${pack.scenario.id} is rasterized for ${pack.borders.width}x${pack.borders.height}, the map is ${game.width()}x${game.height()} (compact maps are not supported)`,
    );
  }
}

// Land that belongs to no nation of the scenario: neutral, unclaimable.
// Derived from the scenario borders, never from the current owners: land a
// nation loses (nuclear fallout, say) stays claimable.
export function unclaimableMask(game: Game, pack: ScenarioPack): Uint8Array {
  assertSameGrid(game, pack);
  const mask = new Uint8Array(pack.borders.tiles.length);
  game.forEachTile((tile) => {
    if (game.isLand(tile) && pack.borders.tiles[tile] === 0) mask[tile] = 1;
  });
  return mask;
}

// State of the world on the first day: every nation on its borders, a city on
// its capital. Expressed like a save, and applied by the same restore path.
// The first land tile of the nation (owner index `owner` in `tiles`) on the
// rings around its capital, from 6 tiles out: where its silo stands.
function siloTile(
  game: Game,
  tiles: Uint16Array,
  capital: number,
  owner: number,
): number | null {
  const cx = game.x(capital);
  const cy = game.y(capital);
  for (let r = 6; r <= 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!game.isValidCoord(cx + dx, cy + dy)) continue;
        const tile = game.ref(cx + dx, cy + dy);
        if (tiles[tile] === owner && owner !== 0) return tile;
      }
    }
  }
  return null;
}

export function initialWorld(
  game: Game,
  pack: ScenarioPack,
  bindings: readonly NationBinding[],
  coreStart: unknown,
): { world: WorldState; grid: TileGrid } {
  assertSameGrid(game, pack);
  const tiles = new Uint16Array(pack.borders.tiles.length);
  game.forEachTile((tile) => {
    const value = pack.borders.tiles[tile];
    // The borders file only owns land; stay safe if the map ever changes.
    if (value !== 0 && game.isLand(tile) && !game.isImpassable(tile)) {
      tiles[tile] = value;
    }
  });
  return {
    world: {
      coreStart,
      players: bindings.map(({ nationId, player }) => {
        const [x, y] = pack.meta.capitals[nationId];
        const capital = game.ref(x, y);
        const structures = [{ type: UnitType.City, tile: capital, level: 1 }];
        // J5: a nuclear nation has a missile silo near its capital, the
        // vector of its warheads (the Véritable nuclear system fires them).
        const sheet = pack.nations.find((n) => n.id === nationId);
        if ((sheet?.nuclear?.warheads ?? 0) > 0) {
          const silo = siloTile(game, tiles, capital, tiles[capital]);
          if (silo !== null) {
            structures.push({
              type: UnitType.MissileSilo,
              tile: silo,
              level: 1,
            });
          }
        }
        return {
          nation: nationId,
          troops: player.troops(),
          gold: player.gold(),
          spawnTile: capital,
          structures,
        };
      }),
    },
    grid: { width: game.width(), height: game.height(), tiles },
  };
}
