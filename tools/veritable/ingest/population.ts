import crypto from "crypto";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import zlib from "zlib";
import { decodeBorders } from "../../../src/veritable/data/bordersFile";
import {
  encodePopulation,
  levelOf,
  peopleOf,
} from "../../../src/veritable/data/populationFile";
import { TILE_NATION_MASK } from "../../../src/veritable/data/schemas/saveV1";
import { loadLandMask } from "../borders/calibrate";
import { toTile } from "../borders/projections";
import { REPO_ROOT } from "./sources";

// Population of every tile of a scenario's map (J7), from the GHS-POP grid of
// the Joint Research Centre of the European Commission: GHS-POP R2023A,
// epoch 2025, 30 arc-seconds, WGS84 (Schiavina, Freire, Carioli, MacManus,
// 2023), © European Union 1995-2026, CC BY 4.0. Replayable:
//
//   npm run veritable:ingest -- population --scenario world-2026
//
// downloads the archive into the cache (outside git) if it is missing,
// checks its sha256, extracts the GeoTIFF, sums the people of every pixel
// into the tile of the map its centre falls on (the georeference of the map,
// data/veritable/maps/<map>.georef.json), moves the people the map's sea
// received to the nearest land within MAX_SHORE tiles, and writes
// data/veritable/borders/<scenario>.pop.bin (quantised, see
// src/veritable/data/populationFile.ts) and a report <scenario>.pop.json.
// The scaling to the population of each nation happens when a campaign
// loads: only this derived grid enters the repository.

export const GHS_POP = {
  url: "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/GHS_POP_E2025_GLOBE_R2023A_4326_30ss/V1-0/GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0.zip",
  zip: "GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0.zip",
  tif: "GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0.tif",
  sha256: "752626a5bbe6f9d0cf79ac33a3cac3572234952b98b5113a4cc01a6bd2d30383",
  credit:
    "GHS-POP R2023A (epoch 2025, 30 arc-seconds), European Commission, Joint Research Centre; Schiavina M., Freire S., Carioli A., MacManus K. (2023); © European Union 1995-2026, CC BY 4.0; aggregated to the tiles of the map and quantised",
};

const CACHE = path.join(REPO_ROOT, "tools/veritable/ingest/cache");
// Steps of the quantisation per doubling of the people of a tile.
const STEPS = 8;
// Sea tiles of the map that received people give them to the nearest land
// within this many tiles (coasts drawn a little differently); beyond, lost.
const MAX_SHORE = 3;
const LAND_BIT = 0x80;
const MAGNITUDE_MASK = 0x1f;

// --- the archive -----------------------------------------------------------------

async function ensureArchive(): Promise<string> {
  const target = path.join(CACHE, GHS_POP.zip);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(CACHE, { recursive: true });
    process.stdout.write(`downloading ${GHS_POP.url}\n`);
    const response = await fetch(GHS_POP.url);
    if (!response.ok || response.body === null) {
      throw new Error(`download failed: ${response.status}`);
    }
    const partial = `${target}.part`;
    await pipeline(
      response.body as unknown as NodeJS.ReadableStream,
      fs.createWriteStream(partial),
    );
    fs.renameSync(partial, target);
  }
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(target), hash);
  const digest = hash.digest("hex");
  if (digest !== GHS_POP.sha256) {
    throw new Error(`${GHS_POP.zip}: sha256 ${digest} is not the pinned one`);
  }
  return target;
}

// One entry of a ZIP archive to a file (stored or deflated; no ZIP64).
async function extractEntry(
  zipPath: string,
  name: string,
  out: string,
): Promise<void> {
  const fd = fs.openSync(zipPath, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const tailLength = Math.min(size, 65_557);
    const tail = Buffer.alloc(tailLength);
    fs.readSync(fd, tail, 0, tailLength, size - tailLength);
    let eocd = -1;
    for (let i = tailLength - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("not a zip archive");
    const entries = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);
    let at = 0;
    for (let e = 0; e < entries; e++) {
      if (cd.readUInt32LE(at) !== 0x02014b50) throw new Error("bad directory");
      const method = cd.readUInt16LE(at + 10);
      const compressed = cd.readUInt32LE(at + 20);
      const nameLength = cd.readUInt16LE(at + 28);
      const extraLength = cd.readUInt16LE(at + 30);
      const commentLength = cd.readUInt16LE(at + 32);
      const local = cd.readUInt32LE(at + 42);
      const entryName = cd.toString("utf8", at + 46, at + 46 + nameLength);
      at += 46 + nameLength + extraLength + commentLength;
      if (entryName !== name) continue;
      if (compressed === 0xffffffff || local === 0xffffffff) {
        throw new Error("ZIP64 entries are not supported");
      }
      const header = Buffer.alloc(30);
      fs.readSync(fd, header, 0, 30, local);
      if (header.readUInt32LE(0) !== 0x04034b50) throw new Error("bad entry");
      const start =
        local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      const input = fs.createReadStream(zipPath, {
        start,
        end: start + compressed - 1,
      });
      const partial = `${out}.part`;
      if (method === 0) {
        await pipeline(input, fs.createWriteStream(partial));
      } else if (method === 8) {
        await pipeline(
          input,
          zlib.createInflateRaw(),
          fs.createWriteStream(partial),
        );
      } else {
        throw new Error(`compression method ${method} not supported`);
      }
      fs.renameSync(partial, out);
      return;
    }
    throw new Error(`${name} not in ${zipPath}`);
  } finally {
    fs.closeSync(fd);
  }
}

// --- the GeoTIFF ----------------------------------------------------------------------

interface Tiff {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  offsets: number[];
  counts: number[];
  // Longitude and latitude of the top left corner, degrees per pixel.
  lon0: number;
  lat0: number;
  dLon: number;
  dLat: number;
}

// The tags the GHS-POP file uses: a tiled BigTIFF (or TIFF) of one float64
// band, LZW or uncompressed, no predictor.
export function readTiff(fd: number): Tiff {
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  if (head.toString("ascii", 0, 2) !== "II") {
    throw new Error("big-endian TIFF not supported");
  }
  const big = head.readUInt16LE(2) === 43;
  if (!big && head.readUInt16LE(2) !== 42) throw new Error("not a TIFF");
  const ifd = big ? Number(head.readBigUInt64LE(8)) : head.readUInt32LE(4);
  const countBuffer = Buffer.alloc(8);
  fs.readSync(fd, countBuffer, 0, 8, ifd);
  const count = big
    ? Number(countBuffer.readBigUInt64LE(0))
    : countBuffer.readUInt16LE(0);
  const entrySize = big ? 20 : 12;
  const table = Buffer.alloc(count * entrySize);
  fs.readSync(fd, table, 0, table.length, ifd + (big ? 8 : 2));
  const sizes: Record<number, number> = { 2: 1, 3: 2, 4: 4, 12: 8, 16: 8 };
  const values = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const e = i * entrySize;
    const tag = table.readUInt16LE(e);
    const type = table.readUInt16LE(e + 2);
    const n = big
      ? Number(table.readBigUInt64LE(e + 4))
      : table.readUInt32LE(e + 4);
    const size = sizes[type];
    if (size === undefined) continue;
    const inline = big ? 8 : 4;
    let data: Buffer;
    if (size * n <= inline) {
      data = table.subarray(e + (big ? 12 : 8), e + (big ? 12 : 8) + size * n);
    } else {
      const offset = big
        ? Number(table.readBigUInt64LE(e + 12))
        : table.readUInt32LE(e + 8);
      data = Buffer.alloc(size * n);
      fs.readSync(fd, data, 0, data.length, offset);
    }
    const list: number[] = [];
    for (let k = 0; k < n; k++) {
      const o = k * size;
      if (type === 3) list.push(data.readUInt16LE(o));
      else if (type === 4) list.push(data.readUInt32LE(o));
      else if (type === 16) list.push(Number(data.readBigUInt64LE(o)));
      else if (type === 12) list.push(data.readDoubleLE(o));
      else list.push(data[o]);
    }
    values.set(tag, list);
  }
  const one = (tag: number, fallback?: number): number => {
    const v = values.get(tag)?.[0] ?? fallback;
    if (v === undefined) throw new Error(`TIFF tag ${tag} missing`);
    return v;
  };
  if (one(258) !== 64 || one(339) !== 3) {
    throw new Error("only float64 samples are supported");
  }
  if (one(277, 1) !== 1) throw new Error("only one band is supported");
  if (![1, 5].includes(one(259))) {
    throw new Error(`compression ${one(259)} not supported`);
  }
  if (one(317, 1) !== 1) throw new Error("predictors are not supported");
  const scale = values.get(33550);
  const tie = values.get(33922);
  if (scale === undefined || tie === undefined) {
    throw new Error("GeoTIFF without pixel scale or tie point");
  }
  return {
    width: one(256),
    height: one(257),
    tileWidth: one(322),
    tileHeight: one(323),
    offsets: values.get(324) ?? [],
    counts: values.get(325) ?? [],
    lon0: tie[3] - tie[0] * scale[0],
    lat0: tie[4] + tie[1] * scale[1],
    dLon: scale[0],
    dLat: scale[1],
  };
}

// TIFF LZW (most significant bit first, codes widen one code early).
export function lzwDecode(input: Uint8Array, out: Uint8Array): number {
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const length = new Int32Array(4096);
  for (let i = 0; i < 256; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    length[i] = 1;
  }
  let next = 258;
  let bits = 9;
  let old = -1;
  let pos = 0;
  let bitPos = 0;
  const total = input.length * 8;
  const read = (): number => {
    if (bitPos + bits > total) return 257;
    let code = 0;
    for (let k = 0; k < bits; k++) {
      const byte = input[(bitPos + k) >> 3];
      code = (code << 1) | ((byte >> (7 - ((bitPos + k) & 7))) & 1);
    }
    bitPos += bits;
    return code;
  };
  const emit = (code: number): number => {
    const n = length[code];
    if (pos + n > out.length) throw new Error("LZW output overrun");
    let c = code;
    for (let k = n - 1; k >= 0; k--) {
      out[pos + k] = suffix[c];
      c = prefix[c];
    }
    pos += n;
    return out[pos - n];
  };
  for (;;) {
    let code = read();
    if (code === 257) break;
    if (code === 256) {
      next = 258;
      bits = 9;
      code = read();
      if (code === 257) break;
      emit(code);
      old = code;
      continue;
    }
    if (code < next) {
      const first = emit(code);
      if (old >= 0 && next < 4096) {
        prefix[next] = old;
        suffix[next] = first;
        length[next] = length[old] + 1;
        next++;
      }
    } else if (code === next && old >= 0) {
      const first = emit(old);
      if (pos >= out.length) throw new Error("LZW output overrun");
      out[pos++] = first;
      prefix[next] = old;
      suffix[next] = first;
      length[next] = length[old] + 1;
      next++;
    } else {
      throw new Error(`LZW code ${code} out of range`);
    }
    old = code;
    if (next + 1 >= 1 << bits && bits < 12) bits++;
  }
  return pos;
}

// --- aggregation -------------------------------------------------------------------------

interface Aggregate {
  width: number;
  height: number;
  people: Float64Array;
  total: number; // people of the grid
  outside: number; // fell outside the map
  shore: number; // moved from the map's sea to its land
  lost: number; // on the map's sea, no land near
}

function aggregate(tifPath: string, map: string): Aggregate {
  const georef = JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "data/veritable/maps", `${map}.georef.json`),
      "utf8",
    ),
  );
  const project = toTile(georef);
  const mask = loadLandMask(map);
  const { width, height } = mask;
  const people = new Float64Array(width * height);
  const fd = fs.openSync(tifPath, "r");
  let total = 0;
  let outside = 0;
  try {
    const tiff = readTiff(fd);
    const across = Math.ceil(tiff.width / tiff.tileWidth);
    const tileBytes = tiff.tileWidth * tiff.tileHeight * 8;
    const decoded = new Uint8Array(tileBytes);
    const samples = new Float64Array(decoded.buffer);
    let compressed = Buffer.alloc(0);
    for (let t = 0; t < tiff.offsets.length; t++) {
      const count = tiff.counts[t];
      if (count === 0) continue;
      if (compressed.length < count) compressed = Buffer.alloc(count);
      fs.readSync(fd, compressed, 0, count, tiff.offsets[t]);
      decoded.fill(0);
      lzwDecode(compressed.subarray(0, count), decoded);
      const col0 = (t % across) * tiff.tileWidth;
      const row0 = Math.floor(t / across) * tiff.tileHeight;
      for (let r = 0; r < tiff.tileHeight; r++) {
        const row = row0 + r;
        if (row >= tiff.height) break;
        const lat = tiff.lat0 - (row + 0.5) * tiff.dLat;
        for (let c = 0; c < tiff.tileWidth; c++) {
          const col = col0 + c;
          if (col >= tiff.width) break;
          const v = samples[r * tiff.tileWidth + c];
          if (!(v > 0)) continue;
          total += v;
          const lon = tiff.lon0 + (col + 0.5) * tiff.dLon;
          const [x, y] = project(lon, lat);
          const ix = Math.floor(x);
          const iy = Math.floor(y);
          if (ix < 0 || iy < 0 || ix >= width || iy >= height) {
            outside += v;
            continue;
          }
          people[iy * width + ix] += v;
        }
      }
      if (t % 1000 === 0) {
        process.stdout.write(`  tile ${t} / ${tiff.offsets.length}\n`);
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  // The sea of the map: to the nearest land within MAX_SHORE tiles.
  let shore = 0;
  let lost = 0;
  for (let i = 0; i < people.length; i++) {
    if (mask.land[i] || people[i] === 0) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    let best = -1;
    let bestDistance = Infinity;
    for (let dy = -MAX_SHORE; dy <= MAX_SHORE; dy++) {
      for (let dx = -MAX_SHORE; dx <= MAX_SHORE; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (!mask.land[j]) continue;
        const d = dx * dx + dy * dy;
        if (d < bestDistance) {
          bestDistance = d;
          best = j;
        }
      }
    }
    if (best >= 0) {
      people[best] += people[i];
      shore += people[i];
    } else {
      lost += people[i];
    }
    people[i] = 0;
  }
  return { width, height, people, total, outside, shore, lost };
}

// --- the command ----------------------------------------------------------------------------

export async function buildPopulation(scenarioId: string): Promise<void> {
  const scenario = JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "data/veritable/scenarios", `${scenarioId}.json`),
      "utf8",
    ),
  );
  const zip = await ensureArchive();
  const tif = path.join(CACHE, GHS_POP.tif);
  if (!fs.existsSync(tif)) {
    process.stdout.write(`extracting ${GHS_POP.tif}\n`);
    await extractEntry(zip, GHS_POP.tif, tif);
  }
  const started = Date.now();
  const agg = aggregate(tif, scenario.map);
  const levels = new Uint8Array(agg.people.length);
  for (let i = 0; i < levels.length; i++) {
    levels[i] = levelOf(agg.people[i], STEPS);
  }
  const bytes = encodePopulation({
    width: agg.width,
    height: agg.height,
    steps: STEPS,
    levels,
  });
  const out = path.join(REPO_ROOT, "data/veritable/borders");
  fs.writeFileSync(path.join(out, `${scenarioId}.pop.bin`), bytes);

  // The report: the people of each nation's first-day tiles against the
  // population of its sheet, and the density by terrain.
  const borders = decodeBorders(
    new Uint8Array(fs.readFileSync(path.join(out, `${scenarioId}.bin`))),
  );
  const terrain = fs.readFileSync(
    path.join(REPO_ROOT, "resources/maps", scenario.map, "map.bin"),
  );
  const byNation = new Map<string, number>();
  const terrainPeople = { plains: 0, highland: 0, mountain: 0 };
  const terrainTiles = { plains: 0, highland: 0, mountain: 0 };
  let onMap = 0;
  for (let i = 0; i < levels.length; i++) {
    const people = peopleOf(levels[i], STEPS);
    onMap += people;
    const owner = borders.tiles[i] & TILE_NATION_MASK;
    if (owner > 0) {
      const id = borders.nations[owner - 1];
      byNation.set(id, (byNation.get(id) ?? 0) + people);
    }
    const t = terrain[i];
    if (!(t & LAND_BIT)) continue;
    const magnitude = t & MAGNITUDE_MASK;
    const kind =
      magnitude < 10 ? "plains" : magnitude < 20 ? "highland" : "mountain";
    terrainPeople[kind] += people;
    terrainTiles[kind] += 1;
  }
  const nations: Record<string, unknown> = {};
  for (const id of scenario.nations as string[]) {
    const sheetPath = path.join(
      REPO_ROOT,
      "data/veritable/nations",
      `${id.toLowerCase()}.json`,
    );
    const sheet = fs.existsSync(sheetPath)
      ? JSON.parse(fs.readFileSync(sheetPath, "utf8"))
      : null;
    const population: number | null = sheet?.population?.value ?? null;
    const grid = Math.round(byNation.get(id) ?? 0);
    nations[id] = {
      grid,
      sheet: population,
      ratio: population ? Math.round((grid / population) * 1000) / 1000 : null,
    };
  }
  const density = (k: keyof typeof terrainPeople) =>
    terrainTiles[k] > 0 ? terrainPeople[k] / terrainTiles[k] : 0;
  const report = {
    source: GHS_POP.credit,
    url: GHS_POP.url,
    sha256: GHS_POP.sha256,
    map: scenario.map,
    steps: STEPS,
    bytes: bytes.length,
    people: {
      grid: Math.round(agg.total),
      outsideMap: Math.round(agg.outside),
      movedFromSea: Math.round(agg.shore),
      lostAtSea: Math.round(agg.lost),
      onMapQuantised: Math.round(onMap),
    },
    densityPerTile: {
      plains: Math.round(density("plains")),
      highland: Math.round(density("highland")),
      mountain: Math.round(density("mountain")),
      mountainOverPlains:
        Math.round((density("mountain") / density("plains")) * 1000) / 1000,
    },
    nations,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  fs.writeFileSync(
    path.join(out, `${scenarioId}.pop.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(
    `${scenarioId}: ${bytes.length} bytes, ${report.seconds} s, mountain/plains ${report.densityPerTile.mountainOverPlains}\n`,
  );
}
