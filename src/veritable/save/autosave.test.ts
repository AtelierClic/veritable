import { IDBFactory } from "fake-indexeddb";
import { autosaveMeta, writeAutosave } from "./autosave";
import { IndexedDbSaveStore } from "./IndexedDbSaveStore";
import { MemorySaveStore, SaveMeta, SaveStore } from "./SaveStore";

const month = (n: number) =>
  `2026-${String(((n - 1) % 12) + 1).padStart(2, "0")}-01`.replace(
    "2026",
    String(2026 + Math.floor((n - 1) / 12)),
  );
const stamp = (n: number) =>
  new Date(Date.UTC(2026, 8, 21, 10, 0, n)).toISOString();

const manual = (id: string, n: number): SaveMeta => ({
  id,
  name: id,
  kind: "manual",
  gameDate: month(n),
  savedAt: stamp(n),
  schemaVersion: 1,
  sizeBytes: 1,
});

const auto = (n: number) =>
  autosaveMeta(month(n), stamp(n), `Auto ${month(n)}`, 1, 1);

const stores: [string, () => SaveStore][] = [
  ["MemorySaveStore", () => new MemorySaveStore()],
  ["IndexedDbSaveStore", () => new IndexedDbSaveStore(new IDBFactory())],
];

describe.each(stores)("monthly autosave rotation on %s", (_name, make) => {
  it("keeps the six most recent automatic saves", async () => {
    const store = make();
    const deleted: string[] = [];
    for (let n = 1; n <= 15; n++) {
      deleted.push(
        ...(await writeAutosave(store, auto(n), new Uint8Array([n]), 6)),
      );
    }
    const list = await store.list();
    expect(list.map((m) => m.gameDate)).toEqual(
      [15, 14, 13, 12, 11, 10].map(month),
    );
    expect(deleted).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `auto-${month(n)}`),
    );
    expect(Array.from((await store.get(`auto-${month(15)}`))!)).toEqual([15]);
    expect(await store.get(`auto-${month(9)}`)).toBeUndefined();
  });

  it("never touches manual saves", async () => {
    const store = make();
    await store.put(manual("before-the-war", 0), new Uint8Array([42]));
    await store.put(manual("another", 3), new Uint8Array([43]));
    for (let n = 1; n <= 10; n++) {
      await writeAutosave(store, auto(n), new Uint8Array([n]), 6);
    }
    const list = await store.list();
    expect(
      list
        .filter((m) => m.kind === "manual")
        .map((m) => m.id)
        .sort(),
    ).toEqual(["another", "before-the-war"]);
    expect(list.filter((m) => m.kind === "auto")).toHaveLength(6);
    expect(Array.from((await store.get("before-the-war"))!)).toEqual([42]);
  });

  it("reaching the same game month again overwrites its slot", async () => {
    const store = make();
    await writeAutosave(store, auto(1), new Uint8Array([1]), 6);
    await writeAutosave(
      store,
      { ...auto(1), savedAt: stamp(50) },
      new Uint8Array([2]),
      6,
    );
    expect(await store.list()).toHaveLength(1);
    expect(Array.from((await store.get(`auto-${month(1)}`))!)).toEqual([2]);
  });
});

describe("writeAutosave", () => {
  it("refuses a manual save and a slot count below one", async () => {
    const store = new MemorySaveStore();
    await expect(
      writeAutosave(store, manual("m", 1), new Uint8Array(1), 6),
    ).rejects.toThrow(/not an autosave/);
    await expect(
      writeAutosave(store, auto(1), new Uint8Array(1), 0),
    ).rejects.toThrow(/slot/);
  });
});
