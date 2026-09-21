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
//
// Encoding is deterministic: the same SaveFile always gives the same bytes.

export const SAVE_MAGIC = "VRTB";
export const SAVE_FILE_EXTENSION = ".vsave";
const PREAMBLE_BYTES = 4 + 2 + 4;

export class SaveFormatError extends Error {}

export interface EncodedSaveStats {
  totalBytes: number;
  headerBytes: number;
  tileBytes: number;
  rawTileBytes: number;
}

export function encodeSave(save: SaveFile): Uint8Array {
  return encodeSaveWithStats(save).bytes;
}

export function encodeSaveWithStats(save: SaveFile): {
  bytes: Uint8Array;
  stats: EncodedSaveStats;
} {
  const { tiles, ...header } = save;
  if (tiles.length !== header.tilesInfo.width * header.tilesInfo.height) {
    throw new SaveFormatError("tile grid does not match tilesInfo");
  }
  const headerBytes = SaveHeaderSchema.serialize(header);
  const tileBytes = encodeTiles(tiles);

  const bytes = new Uint8Array(
    PREAMBLE_BYTES + headerBytes.length + 4 + tileBytes.length,
  );
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 4; i++) bytes[i] = SAVE_MAGIC.charCodeAt(i);
  view.setUint16(4, SAVE_SCHEMA_VERSION, true);
  view.setUint32(6, headerBytes.length, true);
  bytes.set(headerBytes, PREAMBLE_BYTES);
  view.setUint32(PREAMBLE_BYTES + headerBytes.length, tileBytes.length, true);
  bytes.set(tileBytes, PREAMBLE_BYTES + headerBytes.length + 4);

  return {
    bytes,
    stats: {
      totalBytes: bytes.length,
      headerBytes: headerBytes.length,
      tileBytes: tileBytes.length,
      rawTileBytes: tiles.byteLength,
    },
  };
}

export interface DecodeOptions {
  migrations?: readonly Migration[];
  codecs?: Record<number, HeaderCodec>;
  targetVersion?: number;
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
  if (tilesLengthAt + 4 + tilesLength !== bytes.length) {
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
  const tiles = decodeTiles(
    bytes.subarray(tilesLengthAt + 4),
    header.tilesInfo.width * header.tilesInfo.height,
  );

  const save = migrateToCurrent(
    { ...header, tiles },
    options.migrations ?? MIGRATIONS,
    options.targetVersion ?? SAVE_SCHEMA_VERSION,
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
