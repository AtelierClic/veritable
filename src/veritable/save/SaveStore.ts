// Where encoded saves (.vsave bytes) are kept. J0: IndexedDB in the browser
// (IndexedDbSaveStore); J7: files in the user folder through Electron.
// Automatic monthly saves and their rotation arrive with the J1 Scheduler.

export type SaveKind = "manual" | "auto";

export interface SaveMeta {
  id: string;
  name: string;
  kind: SaveKind;
  gameDate: string; // ISO date in the campaign
  savedAt: string; // real-world ISO timestamp, provided by the caller
  schemaVersion: number;
  sizeBytes: number;
}

export interface SaveStore {
  list(): Promise<SaveMeta[]>; // most recent first
  put(meta: SaveMeta, bytes: Uint8Array): Promise<void>;
  get(id: string): Promise<Uint8Array | undefined>;
  delete(id: string): Promise<void>;
}

export function sortSaves(metas: SaveMeta[]): SaveMeta[] {
  return [...metas].sort(
    (a, b) => b.savedAt.localeCompare(a.savedAt) || a.id.localeCompare(b.id),
  );
}

export class MemorySaveStore implements SaveStore {
  private entries = new Map<string, { meta: SaveMeta; bytes: Uint8Array }>();

  async list(): Promise<SaveMeta[]> {
    return sortSaves([...this.entries.values()].map((e) => ({ ...e.meta })));
  }

  async put(meta: SaveMeta, bytes: Uint8Array): Promise<void> {
    this.entries.set(meta.id, { meta: { ...meta }, bytes: bytes.slice() });
  }

  async get(id: string): Promise<Uint8Array | undefined> {
    return this.entries.get(id)?.bytes.slice();
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
  }
}
