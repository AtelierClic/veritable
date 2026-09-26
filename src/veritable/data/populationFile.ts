// Population of every tile of a scenario's map (J7), produced by
// tools/veritable/ingest (command `population`) from the GHS-POP grid of the
// JRC (CC BY 4.0) and read by the scenario loader. Only this derived grid
// enters the repository; the loader scales it to the population of each
// nation on the first day.
//
//   "VPOP"  u8 version  u32 width  u32 height  u8 steps
//   u32 byteLength + block
//
// One byte per tile: q = round(steps x log2(1 + people)), 0 for water and
// empty land, so that people = 2^(q / steps) - 1 within 2^(1 / (2 steps)).
// The block alternates a run of zeros and a run of literal bytes, each
// preceded by its length (LEB128): zeros, literals, zeros, literals... up to
// the last tile. The sea is long runs of zeros; land is stored as it is.

export const POPULATION_MAGIC = "VPOP";
export const POPULATION_VERSION = 1;

export interface PopulationGrid {
  width: number;
  height: number;
  // Steps per doubling of the quantisation (8: a 9 % step).
  steps: number;
  // The quantised people of every tile (see above).
  levels: Uint8Array;
}

export class PopulationFormatError extends Error {}

// People of a tile from its level.
export function peopleOf(level: number, steps: number): number {
  return level === 0 ? 0 : Math.pow(2, level / steps) - 1;
}

// Level of a tile from its people.
export function levelOf(people: number, steps: number): number {
  if (!(people > 0)) return 0;
  return Math.min(255, Math.round(steps * Math.log2(1 + people)));
}

function writeVarint(out: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

function readVarint(bytes: Uint8Array, at: { i: number }): number {
  let value = 0;
  let scale = 1;
  for (;;) {
    if (at.i >= bytes.length) {
      throw new PopulationFormatError("truncated block");
    }
    const b = bytes[at.i++];
    value += (b & 0x7f) * scale;
    if (b < 0x80) return value;
    scale *= 128;
  }
}

export function encodePopulation(grid: PopulationGrid): Uint8Array {
  const { width, height, steps, levels } = grid;
  if (levels.length !== width * height) {
    throw new PopulationFormatError("level grid does not match width x height");
  }
  if (!Number.isInteger(steps) || steps < 1 || steps > 255) {
    throw new PopulationFormatError(`steps out of range: ${steps}`);
  }
  const block: number[] = [];
  let i = 0;
  const n = levels.length;
  while (i < n) {
    let zeros = 0;
    while (i + zeros < n && levels[i + zeros] === 0) zeros++;
    i += zeros;
    let literals = 0;
    while (i + literals < n && levels[i + literals] !== 0) literals++;
    writeVarint(block, zeros);
    writeVarint(block, literals);
    for (let k = 0; k < literals; k++) block.push(levels[i + k]);
    i += literals;
  }
  const bytes = new Uint8Array(4 + 1 + 4 + 4 + 1 + 4 + block.length);
  const view = new DataView(bytes.buffer);
  for (let k = 0; k < 4; k++) bytes[k] = POPULATION_MAGIC.charCodeAt(k);
  bytes[4] = POPULATION_VERSION;
  view.setUint32(5, width, true);
  view.setUint32(9, height, true);
  bytes[13] = steps;
  view.setUint32(14, block.length, true);
  bytes.set(block, 18);
  return bytes;
}

export function decodePopulation(bytes: Uint8Array): PopulationGrid {
  if (bytes.length < 18) throw new PopulationFormatError("file too short");
  for (let k = 0; k < 4; k++) {
    if (bytes[k] !== POPULATION_MAGIC.charCodeAt(k)) {
      throw new PopulationFormatError("not a population file");
    }
  }
  if (bytes[4] !== POPULATION_VERSION) {
    throw new PopulationFormatError(`unsupported population version ${bytes[4]}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(5, true);
  const height = view.getUint32(9, true);
  const steps = bytes[13];
  const length = view.getUint32(14, true);
  if (18 + length > bytes.length) {
    throw new PopulationFormatError("block longer than the file");
  }
  const block = bytes.subarray(18, 18 + length);
  const levels = new Uint8Array(width * height);
  const at = { i: 0 };
  let tile = 0;
  while (at.i < block.length) {
    tile += readVarint(block, at);
    const literals = readVarint(block, at);
    if (tile + literals > levels.length || at.i + literals > block.length) {
      throw new PopulationFormatError("block overruns the grid");
    }
    levels.set(block.subarray(at.i, at.i + literals), tile);
    at.i += literals;
    tile += literals;
  }
  if (tile !== levels.length) {
    throw new PopulationFormatError("block does not cover the grid");
  }
  return { width, height, steps, levels };
}
