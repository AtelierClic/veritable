import { decodeTiles, encodeTiles } from "../save/tiles";

// Maritime zones of a scenario (data/veritable/borders/<scenario>.zones.bin),
// produced by tools/veritable/borders (command `zones`) from the sea seeds of
// data/veritable/maps/<map>.seas.json, and read by the scenario loader.
//
//   "VZON"  u8 version  u32 width  u32 height  u16 zoneCount
//   zoneCount x (u8 length + ASCII zone id)
//   u32 byteLength + RLE tile block (same codec as the save file)
//
// One value per tile: index of the zone in the list + 1; 0 = land, or water
// no seed reaches (lakes, inland seas the seeds do not touch).

export const ZONES_MAGIC = "VZON";
export const ZONES_VERSION = 1;

export interface Zones {
  width: number;
  height: number;
  zones: string[];
  tiles: Uint16Array;
}

export class ZonesFormatError extends Error {}

export function encodeZones(zones: Zones): Uint8Array {
  const { width, height, tiles } = zones;
  if (tiles.length !== width * height) {
    throw new ZonesFormatError("tile grid does not match width x height");
  }
  const ids = zones.zones.map((id) => {
    if (!/^[\x21-\x7e]{1,255}$/.test(id)) {
      throw new ZonesFormatError(`zone id not encodable: ${id}`);
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
  for (let i = 0; i < 4; i++) bytes[at++] = ZONES_MAGIC.charCodeAt(i);
  bytes[at++] = ZONES_VERSION;
  view.setUint32(at, width, true);
  view.setUint32(at + 4, height, true);
  view.setUint16(at + 8, ids.length, true);
  at += 10;
  for (const id of ids) {
    bytes[at++] = id.length;
    bytes.set(id, at);
    at += id.length;
  }
  view.setUint32(at, block.length, true);
  at += 4;
  bytes.set(block, at);
  return bytes;
}

export function decodeZones(bytes: Uint8Array): Zones {
  if (bytes.length < 15) throw new ZonesFormatError("file too short");
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== ZONES_MAGIC.charCodeAt(i)) {
      throw new ZonesFormatError("not a zones file");
    }
  }
  if (bytes[4] !== ZONES_VERSION) {
    throw new ZonesFormatError(`unsupported zones version ${bytes[4]}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(5, true);
  const height = view.getUint32(9, true);
  const count = view.getUint16(13, true);
  let at = 15;
  const zones: string[] = [];
  for (let i = 0; i < count; i++) {
    const length = bytes[at++];
    zones.push(String.fromCharCode(...bytes.subarray(at, at + length)));
    at += length;
  }
  const blockLength = view.getUint32(at, true);
  at += 4;
  const tiles = decodeTiles(
    bytes.subarray(at, at + blockLength),
    width * height,
  );
  return { width, height, zones, tiles };
}
