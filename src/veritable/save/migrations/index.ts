import {
  SAVE_SCHEMA_VERSION,
  SaveFile,
  SaveHeaderV1Schema,
} from "../../data/schemas/save";

// A save as read from disk, before migration: the header decoded with the
// frozen schema of ITS version, plus the raw tile grid.
export interface VersionedSave {
  schemaVersion: number;
  [field: string]: unknown;
  tiles: Uint16Array;
}

// One entry per change of shape of the save: `from` N produces N + 1.
// File naming: migrations/v1-to-v2.ts exports `(save: SaveV1) => SaveV2`.
export interface Migration {
  from: number;
  migrate(save: VersionedSave): VersionedSave;
}

// Frozen header codec of every version ever shipped. zbin has no version byte:
// a v1 file can only be decoded by the v1 schema, forever.
export interface HeaderCodec {
  parseBytes(bytes: Uint8Array): { schemaVersion: number };
}
export const HEADER_CODECS: Record<number, HeaderCodec> = {
  1: SaveHeaderV1Schema,
};

// The chain. Empty at schemaVersion 1, but wired: decodeSave always runs it.
export const MIGRATIONS: Migration[] = [];

export class MigrationError extends Error {}

export function migrateToCurrent(
  save: VersionedSave,
  migrations: readonly Migration[] = MIGRATIONS,
  target: number = SAVE_SCHEMA_VERSION,
): SaveFile {
  let current = save;
  if (current.schemaVersion > target) {
    throw new MigrationError(
      `save version ${current.schemaVersion} is newer than this build (${target})`,
    );
  }
  while (current.schemaVersion < target) {
    const from = current.schemaVersion;
    const step = migrations.find((m) => m.from === from);
    if (step === undefined) {
      throw new MigrationError(`no migration from save version ${from}`);
    }
    current = step.migrate(current);
    if (current.schemaVersion !== from + 1) {
      throw new MigrationError(
        `migration from ${from} produced version ${current.schemaVersion}`,
      );
    }
  }
  return current as unknown as SaveFile;
}
