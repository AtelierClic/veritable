// Contested regions of a scenario (data/veritable/borders/<scenario>.regions.bin),
// produced by tools/veritable/borders (command `rasterize`) from the
// override polygons of the map, and read by the scenario loader (J6: claims).
//
//   "VREG"  u8 version  u32 width  u32 height  u16 regionCount
//   regionCount x (u8 length + ASCII region id
//                  u32 tileCount  u32 byteLength
//                  tile indices, ascending, as LEB128 varints of the gap to
//                  the previous one)
//
// Regions may overlap (a claimed province and the part of it under
// occupation): each keeps its own list of land tiles.

export const REGIONS_MAGIC = "VREG";
export const REGIONS_VERSION = 1;

export interface Regions {
  width: number;
  height: number;
  regions: Map<string, Uint32Array>;
}

export class RegionsFormatError extends Error {}

function varints(tiles: Uint32Array): Uint8Array {
  const out: number[] = [];
  let previous = 0;
  for (let i = 0; i < tiles.length; i++) {
    let gap = tiles[i] - previous;
    if (i > 0 && gap <= 0) {
      throw new RegionsFormatError("region tiles must be strictly ascending");
    }
    previous = tiles[i];
    while (gap >= 0x80) {
      out.push((gap & 0x7f) | 0x80);
      gap = Math.floor(gap / 0x80);
    }
    out.push(gap);
  }
  return Uint8Array.from(out);
}

export function encodeRegions(regions: Regions): Uint8Array {
  const { width, height } = regions;
  const size = width * height;
  const parts: { id: Uint8Array; count: number; body: Uint8Array }[] = [];
  for (const [id, tiles] of regions.regions) {
    if (!/^[\x21-\x7e]{1,255}$/.test(id)) {
      throw new RegionsFormatError(`region id not encodable: ${id}`);
    }
    if (tiles.length > 0 && tiles[tiles.length - 1] >= size) {
      throw new RegionsFormatError(`region ${id}: tile outside the grid`);
    }
    parts.push({
      id: Uint8Array.from(id, (c) => c.charCodeAt(0)),
      count: tiles.length,
      body: varints(tiles),
    });
  }
  const total =
    4 +
    1 +
    8 +
    2 +
    parts.reduce((s, p) => s + 1 + p.id.length + 8 + p.body.length, 0);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  let at = 0;
  for (let i = 0; i < 4; i++) bytes[at++] = REGIONS_MAGIC.charCodeAt(i);
  bytes[at++] = REGIONS_VERSION;
  view.setUint32(at, width, true);
  view.setUint32(at + 4, height, true);
  view.setUint16(at + 8, parts.length, true);
  at += 10;
  for (const p of parts) {
    bytes[at++] = p.id.length;
    bytes.set(p.id, at);
    at += p.id.length;
    view.setUint32(at, p.count, true);
    view.setUint32(at + 4, p.body.length, true);
    at += 8;
    bytes.set(p.body, at);
    at += p.body.length;
  }
  return bytes;
}

export function decodeRegions(bytes: Uint8Array): Regions {
  const fail = (message: string): never => {
    throw new RegionsFormatError(message);
  };
  if (bytes.length < 15) fail("file too short to be a regions file");
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== REGIONS_MAGIC.charCodeAt(i)) fail("not a regions file");
  }
  if (bytes[4] !== REGIONS_VERSION) fail(`unknown version ${bytes[4]}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const width = view.getUint32(5, true);
  const height = view.getUint32(9, true);
  const count = view.getUint16(13, true);
  const size = width * height;
  let at = 15;
  const regions = new Map<string, Uint32Array>();
  for (let r = 0; r < count; r++) {
    if (at >= bytes.length) fail("truncated regions file");
    const length = bytes[at++];
    const id = String.fromCharCode(...bytes.subarray(at, at + length));
    at += length;
    if (at + 8 > bytes.length) fail("truncated regions file");
    const tileCount = view.getUint32(at, true);
    const byteLength = view.getUint32(at + 4, true);
    at += 8;
    const end = at + byteLength;
    if (end > bytes.length) fail(`region ${id}: truncated`);
    const tiles = new Uint32Array(tileCount);
    let previous = 0;
    for (let i = 0; i < tileCount; i++) {
      let gap = 0;
      let scale = 1;
      for (;;) {
        if (at >= end) fail(`region ${id}: truncated`);
        const b = bytes[at++];
        gap += (b & 0x7f) * scale;
        if ((b & 0x80) === 0) break;
        scale *= 0x80;
      }
      previous += gap;
      if (previous >= size) fail(`region ${id}: tile outside the grid`);
      tiles[i] = previous;
    }
    if (at !== end) fail(`region ${id}: bad length`);
    if (regions.has(id)) fail(`duplicate region ${id}`);
    regions.set(id, tiles);
  }
  if (at !== bytes.length) fail("trailing bytes in regions file");
  return { width, height, regions };
}
