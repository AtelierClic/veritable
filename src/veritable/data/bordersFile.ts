import { decodeTiles, encodeTiles } from "../save/tiles";
import { TILE_NATION_MASK } from "./schemas/saveV1";

// Rasterized borders of a scenario (data/veritable/borders/<scenario>.bin),
// produced by tools/veritable/borders and read by the scenario loader.
//
//   "VBRD"  u8 version  u32 width  u32 height  u16 nationCount
//   nationCount x (u8 length + ASCII nation id)
//   u32 byteLength + RLE tile block (same codec as the save file)
//
// One value per tile: index of the nation in the list + 1, 0 = no nation
// (water, or land outside the scenario: neutral).

export const BORDERS_MAGIC = "VBRD";
export const BORDERS_VERSION = 1;

export interface Borders {
  width: number;
  height: number;
  nations: string[];
  tiles: Uint16Array;
}

export class BordersFormatError extends Error {}

export function encodeBorders(borders: Borders): Uint8Array {
  const { width, height, nations, tiles } = borders;
  if (tiles.length !== width * height) {
    throw new BordersFormatError("tile grid does not match width x height");
  }
  const ids = nations.map((id) => {
    if (!/^[\x21-\x7e]{1,255}$/.test(id)) {
      throw new BordersFormatError(`nation id not encodable: ${id}`);
    }
    return Uint8Array.from(id, (c) => c.charCodeAt(0));
  });
  const block = encodeTiles(tiles);
  const size =
    4 +
    1 +
    4 +
    4 +
    2 +
    ids.reduce((s, b) => s + 1 + b.length, 0) +
    4 +
    block.length;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let at = 0;
  for (let i = 0; i < 4; i++) bytes[at++] = BORDERS_MAGIC.charCodeAt(i);
  bytes[at++] = BORDERS_VERSION;
  view.setUint32(at, width, true);
  view.setUint32(at + 4, height, true);
  view.setUint16(at + 8, nations.length, true);
  at += 10;
  for (const id of ids) {
    bytes[at++] = id.length;
    bytes.set(id, at);
    at += id.length;
  }
  view.setUint32(at, block.length, true);
  bytes.set(block, at + 4);
  return bytes;
}

export function decodeBorders(bytes: Uint8Array): Borders {
  const fail = (message: string): never => {
    throw new BordersFormatError(message);
  };
  if (bytes.length < 19) fail("file too short to be a borders file");
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== BORDERS_MAGIC.charCodeAt(i)) fail("bad magic");
  }
  if (bytes[4] !== BORDERS_VERSION) fail(`unknown borders version ${bytes[4]}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const width = view.getUint32(5, true);
  const height = view.getUint32(9, true);
  const count = view.getUint16(13, true);
  let at = 15;
  const nations: string[] = [];
  for (let n = 0; n < count; n++) {
    if (at >= bytes.length) fail("truncated nation table");
    const length = bytes[at++];
    if (at + length > bytes.length) fail("truncated nation table");
    nations.push(String.fromCharCode(...bytes.subarray(at, at + length)));
    at += length;
  }
  if (at + 4 > bytes.length) fail("truncated tile block");
  const blockLength = view.getUint32(at, true);
  if (at + 4 + blockLength !== bytes.length) fail("truncated tile block");
  const tiles = decodeTiles(bytes.subarray(at + 4), width * height);
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] > count) fail(`tile ${i} references an unknown nation`);
  }
  return { width, height, nations, tiles };
}

// Tiles of each nation in the borders (the first day of the scenario).
export function bordersTileCounts(borders: Borders): Record<string, number> {
  const totals = new Array<number>(borders.nations.length + 1).fill(0);
  for (const value of borders.tiles) totals[value & TILE_NATION_MASK]++;
  return Object.fromEntries(
    borders.nations.map((id, i) => [id, totals[i + 1]]),
  );
}
