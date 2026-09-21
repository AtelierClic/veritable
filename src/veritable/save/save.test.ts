import { zb } from "../../../zbin";
import { loadVeritableConfig } from "../data/loadConfig";
import { SaveFile } from "../data/schemas/save";
import { MemoryWorld } from "../sim/testing/MemoryWorld";
import { testNation, testScenario } from "../sim/testing/nations";
import { VeritableSimImpl } from "../sim/VeritableSimImpl";
import { migrateToCurrent, Migration, MigrationError } from "./migrations";
import { MemorySaveStore, SaveMeta } from "./SaveStore";
import {
  decodeSave,
  encodeSave,
  encodeSaveWithStats,
  peekSchemaVersion,
  SaveFormatError,
} from "./serialize";
import { decodeTiles, encodeTiles, TileBlockError } from "./tiles";

const scenario = testScenario(["alpha", "beta", "gamma"]);

function playedGame() {
  const world = new MemoryWorld(40, 25);
  for (let t = 0; t < 400; t++) world.setOwner(t, "alpha");
  for (let t = 400; t < 700; t++) world.setOwner(t, "beta");
  world.setFallout(650, true);
  world.setFallout(900, true);
  const sim = new VeritableSimImpl({
    nationData: testNation,
    config: loadVeritableConfig(),
    world,
  });
  sim.init(scenario, 20260101);
  sim.advance(43_200 * 7 + 555);
  world.transferAll("beta", "alpha"); // beta now has zero tiles
  sim.advance(72);
  sim.apply({ type: "set-speed", speed: 5 });
  return { sim, world };
}

describe("tile block (RLE)", () => {
  it("round-trips any grid", () => {
    const tiles = new Uint16Array(10_000);
    for (let i = 0; i < tiles.length; i++) {
      tiles[i] = i % 97 === 0 ? 0x2000 | (i % 5) : Math.floor(i / 1000);
    }
    const bytes = encodeTiles(tiles);
    expect(decodeTiles(bytes, tiles.length)).toEqual(tiles);
    expect(bytes.length).toBeLessThan(tiles.byteLength);
  });

  it("handles the empty grid, a single run and the extreme value", () => {
    expect(decodeTiles(encodeTiles(new Uint16Array(0)), 0)).toEqual(
      new Uint16Array(0),
    );
    const uniform = new Uint16Array(2_000_000).fill(0xffff);
    const bytes = encodeTiles(uniform);
    expect(bytes.length).toBeLessThan(10);
    // (not toEqual: deep-comparing two million entries is needlessly slow)
    const back = decodeTiles(bytes, uniform.length);
    expect(back.length).toBe(uniform.length);
    expect(back.every((v) => v === 0xffff)).toBe(true);
  });

  it("rejects a block that does not fit the grid", () => {
    const bytes = encodeTiles(new Uint16Array(100).fill(3));
    expect(() => decodeTiles(bytes, 99)).toThrow(TileBlockError);
    expect(() => decodeTiles(bytes, 101)).toThrow(TileBlockError);
    expect(() => decodeTiles(bytes.subarray(0, 1), 100)).toThrow(
      TileBlockError,
    );
  });
});

describe("save file v1", () => {
  it("save -> load -> identical state, identical bytes", () => {
    const { sim } = playedGame();
    const saved = sim.snapshot();
    const bytes = encodeSave(saved);

    // Identity is defined on the file: same bytes. (Comparing the objects
    // themselves trips on structuredClone realms under jsdom.)
    const loaded = decodeSave(bytes);
    expect(encodeSave(loaded)).toEqual(bytes);
    expect(loaded.nations).toEqual(JSON.parse(JSON.stringify(saved.nations)));
    expect(Array.from(loaded.tiles)).toEqual(Array.from(saved.tiles));
    expect(loaded.rngState).toEqual([...saved.rngState]);

    // Restored in a brand new simulation and world, then saved again.
    const sim2 = new VeritableSimImpl({
      nationData: testNation,
      config: loadVeritableConfig(),
      world: new MemoryWorld(40, 25),
    });
    sim2.restore(loaded);
    expect(encodeSave(sim2.snapshot())).toEqual(bytes);
    expect(sim2.read()).toEqual(sim.read());
  });

  it("the nation with zero tiles is still in the reloaded campaign", () => {
    const { sim } = playedGame();
    const loaded = decodeSave(encodeSave(sim.snapshot()));
    const beta = loaded.nations.find((n) => n.id === "beta")!;
    expect(beta.tileCount).toBe(0);
    expect(beta.status).toBe("exiled");
  });

  it("the reloaded campaign continues exactly like the original", () => {
    const { sim, world } = playedGame();
    const world2 = new MemoryWorld(40, 25);
    const sim2 = new VeritableSimImpl({
      nationData: testNation,
      config: loadVeritableConfig(),
      world: world2,
    });
    sim2.restore(decodeSave(encodeSave(sim.snapshot())));

    for (const w of [world, world2]) w.setOwner(3, "beta");
    expect(sim2.advance(90_000)).toEqual(sim.advance(90_000));
    expect(encodeSave(sim2.snapshot())).toEqual(encodeSave(sim.snapshot()));
  });

  it("carries schemaVersion where it can be read before decoding", () => {
    const bytes = encodeSave(playedGame().sim.snapshot());
    expect(peekSchemaVersion(bytes)).toBe(1);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("VRTB");
  });

  it("reports the size of each block", () => {
    const { stats } = encodeSaveWithStats(playedGame().sim.snapshot());
    expect(stats.rawTileBytes).toBe(40 * 25 * 2);
    expect(stats.tileBytes).toBeLessThan(40);
    expect(stats.totalBytes).toBe(10 + stats.headerBytes + 4 + stats.tileBytes);
  });

  it("rejects foreign, truncated and inconsistent files", () => {
    const bytes = encodeSave(playedGame().sim.snapshot());
    expect(() => decodeSave(new Uint8Array([1, 2, 3]))).toThrow(
      SaveFormatError,
    );
    const foreign = bytes.slice();
    foreign[0] = 0x58;
    expect(() => decodeSave(foreign)).toThrow(/magic/);
    expect(() => decodeSave(bytes.subarray(0, bytes.length - 3))).toThrow();

    const future = bytes.slice();
    new DataView(future.buffer).setUint16(4, 99, true);
    expect(() => decodeSave(future)).toThrow(/unknown save schemaVersion/);

    const saved = playedGame().sim.snapshot();
    saved.tiles[0] = 50; // nation index that does not exist
    expect(() => decodeSave(encodeSave(saved))).toThrow(/unknown nation/);
  });
});

describe("migration chain", () => {
  // A fake "version 0" whose header lacks `metrics` and names the seed
  // differently: proves that an older file is decoded with ITS codec and then
  // walked up the chain to the current version.
  const V0Header = zb.object({
    schemaVersion: zb.literal(0),
    oldSeed: zb.uint(),
    tilesInfo: zb.object({ width: zb.uint(), height: zb.uint() }),
  });

  function v0File(): Uint8Array {
    const header = V0Header.serialize({
      schemaVersion: 0,
      oldSeed: 77,
      tilesInfo: { width: 40, height: 25 },
    });
    const tiles = encodeTiles(new Uint16Array(1000).fill(1));
    const bytes = new Uint8Array(10 + header.length + 4 + tiles.length);
    const view = new DataView(bytes.buffer);
    bytes.set([0x56, 0x52, 0x54, 0x42], 0);
    view.setUint16(4, 0, true);
    view.setUint32(6, header.length, true);
    bytes.set(header, 10);
    view.setUint32(10 + header.length, tiles.length, true);
    bytes.set(tiles, 14 + header.length);
    return bytes;
  }

  const v0ToV1: Migration = {
    from: 0,
    migrate: (save) => {
      const current = playedGame().sim.snapshot();
      return {
        ...current,
        seed: save.oldSeed as number,
        tiles: save.tiles,
      };
    },
  };

  it("loads an older file through its codec and the chain", () => {
    const save = decodeSave(v0File(), {
      codecs: { 0: V0Header, 1: { parseBytes: () => ({ schemaVersion: 1 }) } },
      migrations: [v0ToV1],
    });
    expect(save.schemaVersion).toBe(1);
    expect(save.seed).toBe(77);
    expect(save.tiles[999]).toBe(1);
  });

  it("applies several steps in order", () => {
    const steps: number[] = [];
    const chain: Migration[] = [2, 0, 1].map((from) => ({
      from,
      migrate: (s) => {
        steps.push(from);
        return { ...s, schemaVersion: from + 1 };
      },
    }));
    const out = migrateToCurrent(
      { schemaVersion: 0, tiles: new Uint16Array(0) },
      chain,
      3,
    );
    expect(steps).toEqual([0, 1, 2]);
    expect(out.schemaVersion).toBe(3);
  });

  it("fails loudly on a missing step, a bad step or a save from the future", () => {
    const raw = { schemaVersion: 0, tiles: new Uint16Array(0) };
    expect(() => migrateToCurrent(raw, [], 1)).toThrow(MigrationError);
    expect(() =>
      migrateToCurrent(raw, [{ from: 0, migrate: (s) => s }], 1),
    ).toThrow(/produced version/);
    expect(() => migrateToCurrent({ ...raw, schemaVersion: 5 }, [], 1)).toThrow(
      /newer/,
    );
  });

  it("a current save goes through the (empty) chain untouched", () => {
    const saved: SaveFile = playedGame().sim.snapshot();
    expect(migrateToCurrent(saved)).toBe(saved);
  });
});

describe("MemorySaveStore", () => {
  const meta = (id: string, savedAt: string): SaveMeta => ({
    id,
    name: id,
    kind: "manual",
    gameDate: "2026-08-01",
    savedAt,
    schemaVersion: 1,
    sizeBytes: 3,
  });

  it("stores, lists most recent first, reads back and deletes", async () => {
    const store = new MemorySaveStore();
    const bytes = encodeSave(playedGame().sim.snapshot());
    await store.put(meta("a", "2026-09-21T10:00:00Z"), bytes);
    await store.put(meta("b", "2026-09-21T11:00:00Z"), new Uint8Array([1]));

    expect((await store.list()).map((m) => m.id)).toEqual(["b", "a"]);
    expect(await store.get("a")).toEqual(bytes);
    expect(decodeSave((await store.get("a"))!).seed).toBe(20260101);

    await store.delete("a");
    expect(await store.get("a")).toBeUndefined();
    expect((await store.list()).map((m) => m.id)).toEqual(["b"]);
  });
});
