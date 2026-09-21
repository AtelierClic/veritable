import { SaveMeta, SaveStore } from "./SaveStore";

// Automatic saves: one per game month, the most recent N kept (N lives in
// data/veritable/config.json, save.autosaveSlots). Manual saves are never
// touched by the rotation.

export function autosaveMeta(
  gameDate: string,
  savedAt: string,
  name: string,
  schemaVersion: number,
  sizeBytes: number,
): SaveMeta {
  return {
    // One slot per game date: replaying the same month overwrites its save.
    id: `auto-${gameDate}`,
    name,
    kind: "auto",
    gameDate,
    savedAt,
    schemaVersion,
    sizeBytes,
  };
}

// Writes an automatic save, then deletes the automatic saves beyond `slots`,
// oldest first. Returns the ids that were deleted.
export async function writeAutosave(
  store: SaveStore,
  meta: SaveMeta,
  bytes: Uint8Array,
  slots: number,
): Promise<string[]> {
  if (meta.kind !== "auto") throw new Error("writeAutosave: not an autosave");
  if (!Number.isInteger(slots) || slots < 1) {
    throw new Error("writeAutosave: at least one slot is required");
  }
  await store.put(meta, bytes);
  const autos = (await store.list()).filter((m) => m.kind === "auto"); // recent first
  const expired = autos.slice(slots).map((m) => m.id);
  for (const id of expired) await store.delete(id);
  return expired;
}
