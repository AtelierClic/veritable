// Tile block of a save file: run-length encoding of the 16-bit tile grid.
// Territory is made of long horizontal runs of the same owner, so RLE alone
// gets a world map down to a few hundred kB. Pure, synchronous, deterministic:
// the same grid always gives the same bytes.
//
// Layout: repeated (varint value, varint runLength), LEB128.

export class TileBlockError extends Error {}

function pushVarint(out: number[], value: number): void {
  while (value >= 0x80) {
    out.push((value % 0x80) | 0x80);
    value = Math.floor(value / 0x80);
  }
  out.push(value);
}

export function encodeTiles(tiles: Uint16Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < tiles.length) {
    const value = tiles[i];
    let run = 1;
    while (i + run < tiles.length && tiles[i + run] === value) run++;
    pushVarint(out, value);
    pushVarint(out, run);
    i += run;
  }
  return Uint8Array.from(out);
}

export function decodeTiles(bytes: Uint8Array, tileCount: number): Uint16Array {
  const tiles = new Uint16Array(tileCount);
  let pos = 0;
  const readVarint = (): number => {
    let result = 0;
    let scale = 1;
    for (let n = 0; n < 8; n++) {
      if (pos >= bytes.length) throw new TileBlockError("truncated tile block");
      const byte = bytes[pos++];
      result += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) return result;
      scale *= 0x80;
    }
    throw new TileBlockError("varint too long in tile block");
  };

  let filled = 0;
  while (pos < bytes.length) {
    const value = readVarint();
    const run = readVarint();
    if (value > 0xffff) throw new TileBlockError("tile value out of range");
    if (run === 0 || filled + run > tileCount) {
      throw new TileBlockError("tile block does not match the grid size");
    }
    tiles.fill(value, filled, filled + run);
    filled += run;
  }
  if (filled !== tileCount) {
    throw new TileBlockError("tile block does not match the grid size");
  }
  return tiles;
}
