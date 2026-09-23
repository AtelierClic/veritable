import {
  SAVE_SCHEMA_VERSION,
  SaveFile,
  SaveHeaderSchema,
  TILE_NATION_MASK,
} from "../data/schemas/save";
import {
  HEADER_CODECS,
  HeaderCodec,
  migrateToCurrent,
  Migration,
  MigrationContext,
  MIGRATIONS,
} from "./migrations";
import { decodeTiles, encodeTiles } from "./tiles";

// The .vsave container. One file:
//
//   "VRTB"                 4 bytes  magic
//   schemaVersion          u16 LE   read BEFORE any schema-dependent decoding
//   headerLength           u32 LE
//   header                 zbin bytes of the SaveHeader of that version
//   tilesLength            u32 LE
//   tiles                  RLE tile block (see tiles.ts)
//   contestLength          u32 LE   since v5
//   contest                RLE block of the contest of each tile (v5,
//                          sim/war/contest.ts)
//
// Encoding is deterministic: the same SaveFile always gives the same bytes.

export const SAVE_MAGIC = "VRTB";
export const SAVE_FILE_EXTENSION = ".vsave";
const PREAMBLE_BYTES = 4 + 2 + 4;
// First version whose file carries the contest block after the tiles.
const CONTEST_BLOCK_SINCE = 5;

export class SaveFormatError extends Error {}

export interface EncodedSaveStats {
  totalBytes: number;
  headerBytes: number;
  tileBytes: number;
  contestBytes: number;
  rawTileBytes: number;
}

export function encodeSave(save: SaveFile): Uint8Array {
  return encodeSaveWithStats(save).bytes;
}

export function encodeSaveWithStats(save: SaveFile): {
  bytes: Uint8Array;
  stats: EncodedSaveStats;
} {
  const { tiles, contest, ...header } = save;
  const size = header.tilesInfo.width * header.tilesInfo.height;
  if (tiles.length !== size || contest.length !== size) {
    throw new SaveFormatError("tile grid does not match tilesInfo");
  }
  const headerBytes = SaveHeaderSchema.serialize(header);
  const tileBytes = encodeTiles(tiles);
  const contestBytes = encodeTiles(contest);

  const bytes = new Uint8Array(
    PREAMBLE_BYTES +
      headerBytes.length +
      4 +
      tileBytes.length +
      4 +
      contestBytes.length,
  );
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 4; i++) bytes[i] = SAVE_MAGIC.charCodeAt(i);
  view.setUint16(4, SAVE_SCHEMA_VERSION, true);
  view.setUint32(6, headerBytes.length, true);
  bytes.set(headerBytes, PREAMBLE_BYTES);
  view.setUint32(PREAMBLE_BYTES + headerBytes.length, tileBytes.length, true);
  bytes.set(tileBytes, PREAMBLE_BYTES + headerBytes.length + 4);
  const contestAt = PREAMBLE_BYTES + headerBytes.length + 4 + tileBytes.length;
  view.setUint32(contestAt, contestBytes.length, true);
  bytes.set(contestBytes, contestAt + 4);

  return {
    bytes,
    stats: {
      totalBytes: bytes.length,
      headerBytes: headerBytes.length,
      tileBytes: tileBytes.length,
      contestBytes: contestBytes.length,
      rawTileBytes: tiles.byteLength,
    },
  };
}

export interface DecodeOptions {
  migrations?: readonly Migration[];
  codecs?: Record<number, HeaderCodec>;
  targetVersion?: number;
  // Campaign data, needed by migrations that build new state (v1 -> v2).
  context?: MigrationContext;
}

export function peekSchemaVersion(bytes: Uint8Array): number {
  if (bytes.length < PREAMBLE_BYTES) {
    throw new SaveFormatError("file too short to be a Véritable save");
  }
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== SAVE_MAGIC.charCodeAt(i)) {
      throw new SaveFormatError("not a Véritable save (bad magic)");
    }
  }
  return new DataView(bytes.buffer, bytes.byteOffset).getUint16(4, true);
}

// `world.coreStart` of a save of any version, WITHOUT migrating it: what
// recreates the core game, and which scenario the campaign data comes from.
export function peekCoreStart(bytes: Uint8Array): unknown {
  const version = peekSchemaVersion(bytes);
  const codec = HEADER_CODECS[version];
  if (codec === undefined) {
    throw new SaveFormatError(`unknown save schemaVersion ${version}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const headerLength = view.getUint32(6, true);
  const header = codec.parseBytes(
    bytes.subarray(PREAMBLE_BYTES, PREAMBLE_BYTES + headerLength),
  ) as { world?: { coreStart?: unknown } };
  return header.world?.coreStart;
}

// Reads a save of ANY known version and returns it migrated to the current one.
export function decodeSave(
  bytes: Uint8Array,
  options: DecodeOptions = {},
): SaveFile {
  const version = peekSchemaVersion(bytes);
  const codec = (options.codecs ?? HEADER_CODECS)[version];
  if (codec === undefined) {
    throw new SaveFormatError(`unknown save schemaVersion ${version}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const headerLength = view.getUint32(6, true);
  const tilesLengthAt = PREAMBLE_BYTES + headerLength;
  if (tilesLengthAt + 4 > bytes.length) {
    throw new SaveFormatError("truncated save (header)");
  }
  const tilesLength = view.getUint32(tilesLengthAt, true);
  const tilesEnd = tilesLengthAt + 4 + tilesLength;
  let contestAt = -1;
  if (version >= CONTEST_BLOCK_SINCE) {
    if (tilesEnd + 4 > bytes.length) {
      throw new SaveFormatError("truncated save (tiles)");
    }
    contestAt = tilesEnd;
    const contestLength = view.getUint32(contestAt, true);
    if (contestAt + 4 + contestLength !== bytes.length) {
      throw new SaveFormatError("truncated save (contest)");
    }
  } else if (tilesEnd !== bytes.length) {
    throw new SaveFormatError("truncated save (tiles)");
  }

  const header = codec.parseBytes(
    bytes.subarray(PREAMBLE_BYTES, tilesLengthAt),
  ) as { schemaVersion: number; tilesInfo?: { width: number; height: number } };
  if (header.schemaVersion !== version) {
    throw new SaveFormatError("schemaVersion mismatch between file and header");
  }
  if (header.tilesInfo === undefined) {
    throw new SaveFormatError("save header has no tilesInfo");
  }
  const size = header.tilesInfo.width * header.tilesInfo.height;
  const tiles = decodeTiles(bytes.subarray(tilesLengthAt + 4, tilesEnd), size);
  const contest =
    contestAt < 0
      ? undefined
      : decodeTiles(bytes.subarray(contestAt + 4), size);

  const save = migrateToCurrent(
    contest === undefined ? { ...header, tiles } : { ...header, tiles, contest },
    options.migrations ?? MIGRATIONS,
    options.targetVersion ?? SAVE_SCHEMA_VERSION,
    options.context,
  );
  assertTilesReferenceNations(save);
  return save;
}

function assertTilesReferenceNations(save: SaveFile): void {
  const max = save.nations.length;
  for (let i = 0; i < save.tiles.length; i++) {
    if ((save.tiles[i] & TILE_NATION_MASK) > max) {
      throw new SaveFormatError(`tile ${i} references an unknown nation`);
    }
  }
}
