import { IDBFactory } from "fake-indexeddb";
import { IndexedDbSaveStore } from "./IndexedDbSaveStore";
import { SaveMeta } from "./SaveStore";

const meta = (id: string, savedAt: string): SaveMeta => ({
  id,
  name: `save ${id}`,
  kind: "manual",
  gameDate: "2026-03-01",
  savedAt,
  schemaVersion: 1,
  sizeBytes: 4,
});

describe("IndexedDbSaveStore", () => {
  it("stores, lists most recent first, reads back and deletes", async () => {
    const store = new IndexedDbSaveStore(new IDBFactory());
    expect(await store.list()).toEqual([]);

    const bytes = new Uint8Array([0x56, 0x52, 0x54, 0x42, 0, 255, 7]);
    await store.put(meta("a", "2026-09-21T10:00:00Z"), bytes);
    await store.put(meta("b", "2026-09-21T11:00:00Z"), new Uint8Array([1]));

    expect((await store.list()).map((m) => m.id)).toEqual(["b", "a"]);
    expect((await store.list())[1]).toEqual(meta("a", "2026-09-21T10:00:00Z"));
    expect(Array.from((await store.get("a"))!)).toEqual(Array.from(bytes));
    expect(await store.get("missing")).toBeUndefined();

    await store.delete("a");
    expect(await store.get("a")).toBeUndefined();
    expect((await store.list()).map((m) => m.id)).toEqual(["b"]);
  });

  it("overwrites a save with the same id", async () => {
    const store = new IndexedDbSaveStore(new IDBFactory());
    await store.put(meta("a", "2026-09-21T10:00:00Z"), new Uint8Array([1]));
    await store.put(
      { ...meta("a", "2026-09-21T12:00:00Z"), name: "renamed" },
      new Uint8Array([2, 3]),
    );
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("renamed");
    expect(Array.from((await store.get("a"))!)).toEqual([2, 3]);
  });

  it("persists across store instances on the same database", async () => {
    const factory = new IDBFactory();
    await new IndexedDbSaveStore(factory).put(
      meta("a", "2026-09-21T10:00:00Z"),
      new Uint8Array([9]),
    );
    const reopened = new IndexedDbSaveStore(factory);
    expect((await reopened.list()).map((m) => m.id)).toEqual(["a"]);
    expect(Array.from((await reopened.get("a"))!)).toEqual([9]);
  });

  it("can be constructed without IndexedDB and fails only on use", async () => {
    const store = new IndexedDbSaveStore(); // jsdom has no indexedDB
    await expect(store.list()).rejects.toThrow(/IndexedDB is not available/);
  });
});
