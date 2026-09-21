import { AttackExecution } from "../../src/core/execution/AttackExecution";
import { Executor } from "../../src/core/execution/ExecutionManager";
import { NationExecution } from "../../src/core/execution/NationExecution";
import { PlayerExecution } from "../../src/core/execution/PlayerExecution";
import {
  Cell,
  Game,
  Nation,
  PlayerInfo,
  PlayerType,
} from "../../src/core/game/Game";
import { GameImpl } from "../../src/core/game/GameImpl";
import { targetTransportTile } from "../../src/core/game/TransportShipUtils";
import { GameRunner } from "../../src/core/GameRunner";
import { setup } from "../util/Setup";
import { executeTicks } from "../util/utils";

// VERITABLE (J1): land outside the scenario is neutral and cannot be
// conquered; the legacy nation AI is not registered in a campaign.

async function game(veritable: boolean): Promise<Game> {
  const g = await setup("big_plains", { veritable, infiniteTroops: true }, [
    new PlayerInfo("state", PlayerType.Human, "client_1", "state_id"),
  ]);
  const state = g.player("state_id");
  for (let x = 40; x < 50; x++) {
    for (let y = 40; y < 50; y++) state.conquer(g.ref(x, y));
  }
  state.setSpawnTile(g.ref(45, 45));
  g.addExecution(new PlayerExecution(state));
  return g;
}

// Everything from x = 53 eastwards is neutral.
function neutralEast(g: Game): Uint8Array {
  const mask = new Uint8Array(g.width() * g.height());
  g.forEachTile((t) => {
    if (g.x(t) >= 53) mask[t] = 1;
  });
  return mask;
}

function expand(g: Game, ticks: number) {
  g.addExecution(
    new AttackExecution(50_000, g.player("state_id"), g.terraNullius().id()),
  );
  executeTicks(g, ticks);
}

describe("Véritable: neutral land", () => {
  it("an expansion never takes a neutral tile, and stops at the limit", async () => {
    const g = await game(true);
    g.setUnclaimableTiles(neutralEast(g));
    expand(g, 400);

    const state = g.player("state_id");
    expect(state.numTilesOwned()).toBeGreaterThan(100); // it did expand west
    let beyond = 0;
    for (const t of state.tiles()) if (g.x(t) >= 53) beyond++;
    expect(beyond).toBe(0);
    expect(g.owner(g.ref(52, 45))).toBe(state); // right up to the limit
  });

  it("control: without the mask the same expansion crosses x = 53", async () => {
    const g = await game(true);
    expand(g, 400);
    let beyond = 0;
    for (const t of g.player("state_id").tiles()) if (g.x(t) >= 53) beyond++;
    expect(beyond).toBeGreaterThan(0);
  });

  it("canAttack refuses neutral land and paths through it", async () => {
    const g = await game(true);
    const state = g.player("state_id");
    expect(state.canAttack(g.ref(70, 45))).toBe(true);
    g.setUnclaimableTiles(neutralEast(g));
    expect(state.canAttack(g.ref(70, 45))).toBe(false);
    expect(state.canAttack(g.ref(51, 45))).toBe(true);

    // Claimable land reachable only across neutral land is out of reach.
    const mask = neutralEast(g);
    g.forEachTile((t) => {
      if (g.x(t) >= 80) mask[t] = 0;
    });
    const ring = new Uint8Array(mask);
    g.forEachTile((t) => {
      // close the western side too: neutral everywhere but x >= 80
      if (g.x(t) < 80 && g.owner(t) !== state) ring[t] = 1;
    });
    g.setUnclaimableTiles(ring);
    expect(state.canAttack(g.ref(90, 45))).toBe(false);
  });

  it("owned tiles are never neutral: a nation's land can change hands inside the mask", async () => {
    const g = await setup("big_plains", { veritable: true }, [
      new PlayerInfo("state", PlayerType.Human, "client_1", "state_id"),
      new PlayerInfo("rival", PlayerType.Human, "client_2", "rival_id"),
    ]);
    const all = new Uint8Array(g.width() * g.height()).fill(1);
    g.setUnclaimableTiles(all);
    const state = g.player("state_id");
    const rival = g.player("rival_id");
    state.conquer(g.ref(40, 40));
    rival.conquer(g.ref(41, 40));
    expect(g.isUnclaimable(g.ref(41, 40))).toBe(true); // in the mask…
    expect(state.canAttack(g.ref(41, 40))).toBe(true); // …but owned: attackable
  });

  it("no landing on a neutral shore", async () => {
    const g = await setup("half_land_half_ocean", { veritable: true }, [
      new PlayerInfo("state", PlayerType.Human, "client_1", "state_id"),
    ]);
    const state = g.player("state_id");
    let shore = -1;
    g.forEachTile((t) => {
      if (shore === -1 && g.isShore(t) && g.isLand(t)) shore = t;
    });
    expect(shore).toBeGreaterThanOrEqual(0);
    g.setUnclaimableTiles(new Uint8Array(g.width() * g.height()).fill(1));
    expect(targetTransportTile(g, state, shore)).toBeNull();
  });

  it("the mask is refused outside a campaign, and must fit the map", async () => {
    const legacy = await game(false);
    expect(() => legacy.setUnclaimableTiles(neutralEast(legacy))).toThrow(
      /Véritable/,
    );
    expect(legacy.isUnclaimable(legacy.ref(70, 45))).toBe(false);

    const g = await game(true);
    expect(() => g.setUnclaimableTiles(new Uint8Array(3))).toThrow(/match/);
    g.setUnclaimableTiles(neutralEast(g));
    g.setUnclaimableTiles(null);
    expect(g.isUnclaimable(g.ref(70, 45))).toBe(false);
  });
});

describe("Véritable: no legacy nation AI", () => {
  it("GameRunner registers NationExecution only outside a campaign", async () => {
    for (const veritable of [true, false]) {
      const nation = new Nation(
        new Cell(100, 100),
        new PlayerInfo("Syldavie", PlayerType.Nation, null, "syl_id"),
      );
      const g = await setup(
        "big_plains",
        { veritable },
        [new PlayerInfo("state", PlayerType.Human, "client_1", "state_id")],
        undefined,
        undefined,
        false,
        [nation],
      );
      new GameRunner(g, new Executor(g, "game_id", undefined), () => {}).init();
      executeTicks(g, 2);
      const hasNationAi = (g as unknown as GameImpl)
        .executions()
        .some((e) => e instanceof NationExecution);
      expect(hasNationAi).toBe(!veritable);
    }
  });
});
