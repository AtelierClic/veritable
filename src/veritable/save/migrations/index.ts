import { NationId } from "../../data/schemas/common";
import { VeritableConfig } from "../../data/schemas/config";
import { NationData } from "../../data/schemas/nation";
import {
  SAVE_SCHEMA_VERSION,
  SaveFile,
  SaveHeaderV4Schema,
} from "../../data/schemas/save";
import { SaveFileV1, SaveHeaderV1Schema } from "../../data/schemas/saveV1";
import { SaveFileV2, SaveHeaderV2Schema } from "../../data/schemas/saveV2";
import { SaveFileV3, SaveHeaderV3Schema } from "../../data/schemas/saveV3";
import { Scenario } from "../../data/schemas/scenario";
import { SimData } from "../../sim/economy/context";
import { v1ToV2 } from "./v1-to-v2";
import { v2ToV3 } from "./v2-to-v3";
import { v3ToV4 } from "./v3-to-v4";

// A save as read from disk, before migration: the header decoded with the
// frozen schema of ITS version, plus the raw tile grid.
export interface VersionedSave {
  schemaVersion: number;
  [field: string]: unknown;
  tiles: Uint16Array;
}

// What a migration may need to build the state a newer version adds: the
// data of the campaign (the same objects the simulation receives).
export interface MigrationContext {
  config: VeritableConfig;
  data: SimData;
  nationData: (id: NationId) => NationData | undefined;
  // The scenario of the campaign (its wars and contested regions), when the
  // caller knows it.
  scenario?: Scenario;
}

// One entry per change of shape of the save: `from` N produces N + 1.
// File naming: migrations/v1-to-v2.ts exports `(save: SaveV1, ctx) => SaveV2`.
export interface Migration {
  from: number;
  migrate(
    save: VersionedSave,
    context: MigrationContext | undefined,
  ): VersionedSave;
}

// Frozen header codec of every version ever shipped. zbin has no version byte:
// a v1 file can only be decoded by the v1 schema, forever.
export interface HeaderCodec {
  parseBytes(bytes: Uint8Array): { schemaVersion: number };
}
export const HEADER_CODECS: Record<number, HeaderCodec> = {
  1: SaveHeaderV1Schema,
  2: SaveHeaderV2Schema,
  3: SaveHeaderV3Schema,
  4: SaveHeaderV4Schema,
};

export class MigrationError extends Error {}

export const MIGRATIONS: Migration[] = [
  {
    from: 1,
    migrate(save, context) {
      if (context === undefined) {
        throw new MigrationError(
          "migration v1 -> v2 needs the campaign data (MigrationContext)",
        );
      }
      return v1ToV2(save as unknown as SaveFileV1, context) as VersionedSave;
    },
  },
  {
    from: 2,
    migrate(save, context) {
      if (context === undefined) {
        throw new MigrationError(
          "migration v2 -> v3 needs the campaign data (MigrationContext)",
        );
      }
      return v2ToV3(save as unknown as SaveFileV2, context) as VersionedSave;
    },
  },
  {
    from: 3,
    migrate(save, context) {
      if (context === undefined) {
        throw new MigrationError(
          "migration v3 -> v4 needs the campaign data (MigrationContext)",
        );
      }
      return v3ToV4(save as unknown as SaveFileV3, context) as VersionedSave;
    },
  },
];

export function migrateToCurrent(
  save: VersionedSave,
  migrations: readonly Migration[] = MIGRATIONS,
  target: number = SAVE_SCHEMA_VERSION,
  context?: MigrationContext,
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
    current = step.migrate(current, context);
    if (current.schemaVersion !== from + 1) {
      throw new MigrationError(
        `migration from ${from} produced version ${current.schemaVersion}`,
      );
    }
  }
  return current as unknown as SaveFile;
}
