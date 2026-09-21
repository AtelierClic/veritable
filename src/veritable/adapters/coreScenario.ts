import { Game, Player, PlayerType } from "../../core/game/Game";
import { NationId } from "../data/schemas/common";
import { Scenario } from "../data/schemas/scenario";

// J0: there is no scenario file yet (J1) and no nation sheets (J2). The
// campaign's nations are derived from the OpenFront roster: the human player
// and the nations of the map manifest. Tribes (bots) are map fill, not nations.

export interface NationBinding {
  nationId: NationId;
  player: Player;
}

const PLAYER_NATION_ID = "player";

function slug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

// Deterministic: depends only on the roster order of the core game, which is
// itself a function of GameStartInfo. The same GameStartInfo always gives the
// same NationIds, which is what lets a save be bound to a recreated core game.
export function bindNations(game: Game): NationBinding[] {
  const used = new Set<string>();
  const bindings: NationBinding[] = [];
  let humanSeen = false;
  for (const player of game.allPlayers()) {
    if (
      player.type() !== PlayerType.Human &&
      player.type() !== PlayerType.Nation
    ) {
      continue;
    }
    let base: string;
    if (player.type() === PlayerType.Human && !humanSeen) {
      base = PLAYER_NATION_ID;
      humanSeen = true;
    } else {
      base = slug(player.name()) || `nation-${player.smallID()}`;
    }
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    bindings.push({ nationId: id, player });
  }
  return bindings;
}

export function scenarioFromCoreGame(
  game: Game,
  bindings: readonly NationBinding[],
  startDate: string,
): Scenario {
  const human = bindings.find((b) => b.player.type() === PlayerType.Human);
  if (human === undefined) {
    throw new Error("a Véritable campaign needs a human player");
  }
  return {
    id: "j0-core-roster",
    map: String(game.config().gameConfig().gameMap),
    startDate,
    nations: [],
    adHocNations: bindings.map((b) => ({
      id: b.nationId,
      literalName: b.player.name(),
    })),
    contested: [],
    wars: [],
    playerDefault: human.nationId,
  };
}
