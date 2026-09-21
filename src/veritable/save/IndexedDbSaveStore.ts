import { SaveMeta, SaveStore, sortSaves } from "./SaveStore";

const DB_NAME = "veritable";
const DB_VERSION = 1;
const META_STORE = "save-meta";
const BYTES_STORE = "save-bytes";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Saves in the browser's IndexedDB. Metadata and bytes live in two object
// stores so that listing saves never loads the save bodies.
export class IndexedDbSaveStore implements SaveStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = this.factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(BYTES_STORE)) {
          db.createObjectStore(BYTES_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  async list(): Promise<SaveMeta[]> {
    const db = await this.open();
    const tx = db.transaction(META_STORE, "readonly");
    const metas = await request<SaveMeta[]>(
      tx.objectStore(META_STORE).getAll(),
    );
    return sortSaves(metas);
  }

  async put(meta: SaveMeta, bytes: Uint8Array): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([META_STORE, BYTES_STORE], "readwrite");
    tx.objectStore(META_STORE).put(meta);
    tx.objectStore(BYTES_STORE).put(bytes, meta.id);
    await done(tx);
  }

  async get(id: string): Promise<Uint8Array | undefined> {
    const db = await this.open();
    const tx = db.transaction(BYTES_STORE, "readonly");
    const bytes = await request<Uint8Array | undefined>(
      tx.objectStore(BYTES_STORE).get(id),
    );
    return bytes;
  }

  async delete(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([META_STORE, BYTES_STORE], "readwrite");
    tx.objectStore(META_STORE).delete(id);
    tx.objectStore(BYTES_STORE).delete(id);
    await done(tx);
  }
}
