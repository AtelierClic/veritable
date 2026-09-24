import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Open data sources of the nation sheets, pinned like Natural Earth:
//
// - World Bank Open Data (CC BY 4.0). The API is not versioned, so the raw
//   responses are COMMITTED as snapshots (small) and their sha256 recorded in
//   sources.lock.json: a rebuild never depends on the network.
// - Our World in Data, energy dataset (CC BY 4.0), pinned to a git commit; the
//   10 MB CSV is cached outside git and its sha256 is checked.
// - IMF World Economic Outlook (DataMapper API), general government gross
//   debt in % of GDP. The IMF terms of use could not be read by the tool (the
//   page is served to browsers only), so the dataset is NOT redistributed:
//   the response is cached outside git, pinned by sha256, and only the ten
//   attributed figures reach the nation sheets.
//
// `npm run veritable:ingest -- fetch` refreshes snapshots and lock;
// `npm run veritable:ingest -- fetch-imf` refreshes the IMF cache alone;
// `npm run veritable:ingest -- build` rebuilds data/veritable/ from them.

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
export const SNAPSHOT_DIR = path.join(HERE, "snapshots");
export const CACHE_DIR = path.join(HERE, "cache");
export const LOCK_FILE = path.join(HERE, "sources.lock.json");

export const OWID_ENERGY_COMMIT = "7e387a16f70a510e433f8aac7efeac6faa1e5059";
export const OWID_ENERGY_URL = `https://raw.githubusercontent.com/owid/energy-data/${OWID_ENERGY_COMMIT}/owid-energy-data.csv`;

export const WORLD_BANK_INDICATORS = {
  gdp: "NY.GDP.MKTP.CD",
  population: "SP.POP.TOTL",
  growth: "NY.GDP.MKTP.KD.ZG",
  centralDebt: "GC.DOD.TOTL.GD.ZS",
  revenue: "GC.REV.XGRT.GD.ZS",
  expense: "GC.XPN.TOTL.GD.ZS",
  military: "MS.MIL.XPND.GD.ZS",
  health: "SH.XPD.GHED.GD.ZS",
  education: "SE.XPD.TOTL.GD.ZS",
  research: "GB.XPD.RSDV.GD.ZS",
  manufacturing: "NV.IND.MANF.CD",
  services: "NV.SRV.TOTL.CD",
  highTechExports: "TX.VAL.TECH.CD",
  cereals: "AG.PRD.CREL.MT",
  trade: "NE.TRD.GNFS.ZS", // trade (exports + imports) in % of GDP
} as const;
export type WorldBankKey = keyof typeof WORLD_BANK_INDICATORS;

export const WORLD = "WLD";

export const IMF_DEBT_INDICATOR = "GGXWDG_NGDP";
export const IMF_DEBT_URL = `https://www.imf.org/external/datamapper/api/v1/${IMF_DEBT_INDICATOR}`;
const IMF_CACHE_KEY = `cache/imf-weo-${IMF_DEBT_INDICATOR}.json`;

export type Lock = Record<string, string>; // relative path -> sha256

export function sha256(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// sha256 of a JSON snapshot, independent of its formatting: the committed
// snapshots go through Prettier like any other file of the repository.
export function jsonSha256(text: string): string {
  return sha256(JSON.stringify(JSON.parse(text)));
}

export function readLock(): Lock {
  return fs.existsSync(LOCK_FILE)
    ? JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"))
    : {};
}

export function worldBankSnapshot(key: WorldBankKey): string {
  return path.join(
    SNAPSHOT_DIR,
    "worldbank",
    `${WORLD_BANK_INDICATORS[key]}.json`,
  );
}

// One World Bank indicator: snapshot rewritten, its lock entry updated, the
// other entries kept (the API is not versioned: refetching everything would
// move every figure).
export async function fetchWorldBank(
  key: WorldBankKey,
  countries: readonly string[],
): Promise<void> {
  fs.mkdirSync(path.join(SNAPSHOT_DIR, "worldbank"), { recursive: true });
  const lock = readLock();
  await fetchIndicator(key, countries, lock);
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + "\n");
}

export async function fetchAll(countries: readonly string[]): Promise<void> {
  const lock: Lock = {};
  fs.mkdirSync(path.join(SNAPSHOT_DIR, "worldbank"), { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  for (const key of Object.keys(WORLD_BANK_INDICATORS) as WorldBankKey[]) {
    await fetchIndicator(key, countries, lock);
  }
  const csv = Buffer.from(await (await fetch(OWID_ENERGY_URL)).arrayBuffer());
  fs.writeFileSync(path.join(CACHE_DIR, "owid-energy-data.csv"), csv);
  lock[`cache/owid-energy-data.csv@${OWID_ENERGY_COMMIT}`] = sha256(csv);
  console.log(`OWID energy: ${csv.length} bytes`);
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + "\n");
}

async function fetchIndicator(
  key: WorldBankKey,
  countries: readonly string[],
  lock: Lock,
): Promise<void> {
  const list = [...countries, WORLD].join(";");
  {
    const id = WORLD_BANK_INDICATORS[key];
    const url = `https://api.worldbank.org/v2/country/${list}/indicator/${id}?format=json&date=2010:2025&per_page=2000`;
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`World Bank ${id}: HTTP ${response.status}`);
    const [meta, rows] = (await response.json()) as [
      { lastupdated: string },
      { countryiso3code: string; date: string; value: number | null }[],
    ];
    // Keep only what the build needs, sorted: a stable, reviewable snapshot.
    const snapshot = {
      indicator: id,
      lastUpdated: meta.lastupdated,
      license: "CC BY 4.0, World Bank Open Data",
      values: rows
        .filter((r) => r.value !== null)
        .map((r) => ({
          iso3: r.countryiso3code,
          year: Number(r.date),
          value: r.value,
        }))
        .sort((a, b) => a.iso3.localeCompare(b.iso3) || a.year - b.year),
    };
    const text = JSON.stringify(snapshot, null, 1) + "\n";
    fs.writeFileSync(worldBankSnapshot(key), text);
    lock[`snapshots/worldbank/${id}.json`] = jsonSha256(text);
    console.log(`World Bank ${id}: ${snapshot.values.length} values`);
  }
}

// IMF WEO: one indicator, cached with the date of the extraction (the WEO
// vintage is not in the API response).
export async function fetchImf(countries: readonly string[]): Promise<void> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const url = `${IMF_DEBT_URL}/${countries.join("/")}`;
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`IMF ${IMF_DEBT_INDICATOR}: HTTP ${response.status}`);
  const body = (await response.json()) as {
    values: Record<string, Record<string, Record<string, number>>>;
  };
  const series = body.values[IMF_DEBT_INDICATOR];
  const cache = {
    indicator: IMF_DEBT_INDICATOR,
    source: "IMF World Economic Outlook, DataMapper API",
    fetchedAt: new Date().toISOString().slice(0, 10),
    values: countries.map((iso3) => ({ iso3, byYear: series[iso3] ?? {} })),
  };
  const text = JSON.stringify(cache, null, 1) + "\n";
  fs.writeFileSync(
    path.join(CACHE_DIR, `imf-weo-${IMF_DEBT_INDICATOR}.json`),
    text,
  );
  const lock = readLock();
  lock[IMF_CACHE_KEY] = sha256(text);
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + "\n");
  console.log(`IMF ${IMF_DEBT_INDICATOR}: ${cache.values.length} countries`);
}

export function loadImfDebt(lock: Lock): {
  fetchedAt: string;
  // Value of the year, or of the latest earlier year that has one.
  at(iso3: string, year: number): { value: number; year: number } | null;
} {
  const file = path.join(CACHE_DIR, `imf-weo-${IMF_DEBT_INDICATOR}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      "IMF WEO cache missing: run `veritable:ingest -- fetch-imf`",
    );
  }
  const text = fs.readFileSync(file, "utf8");
  if (lock[IMF_CACHE_KEY] !== sha256(text)) {
    throw new Error("IMF WEO cache does not match sources.lock.json");
  }
  const cache = JSON.parse(text) as {
    fetchedAt: string;
    values: { iso3: string; byYear: Record<string, number> }[];
  };
  return {
    fetchedAt: cache.fetchedAt,
    at(iso3, year) {
      const entry = cache.values.find((v) => v.iso3 === iso3);
      if (entry === undefined) return null;
      for (let y = year; y >= 1980; y--) {
        const value = entry.byYear[String(y)];
        if (value !== undefined) return { value, year: y };
      }
      return null;
    },
  };
}

export interface Series {
  lastUpdated: string;
  // Most recent non-null value at or before `maxYear`.
  latest(
    iso3: string,
    maxYear?: number,
  ): { value: number; year: number } | null;
  mean(iso3: string, fromYear: number, toYear: number): number | null;
}

export function loadWorldBank(key: WorldBankKey, lock: Lock): Series {
  const file = worldBankSnapshot(key);
  const text = fs.readFileSync(file, "utf8");
  const id = WORLD_BANK_INDICATORS[key];
  if (lock[`snapshots/worldbank/${id}.json`] !== jsonSha256(text)) {
    throw new Error(`${id}: snapshot does not match sources.lock.json`);
  }
  const snapshot = JSON.parse(text) as {
    lastUpdated: string;
    values: { iso3: string; year: number; value: number }[];
  };
  return {
    lastUpdated: snapshot.lastUpdated,
    latest(iso3, maxYear = 9999) {
      const rows = snapshot.values.filter(
        (v) => v.iso3 === iso3 && v.year <= maxYear,
      );
      const last = rows[rows.length - 1];
      return last === undefined ? null : { value: last.value, year: last.year };
    },
    mean(iso3, fromYear, toYear) {
      const rows = snapshot.values.filter(
        (v) => v.iso3 === iso3 && v.year >= fromYear && v.year <= toYear,
      );
      return rows.length === 0
        ? null
        : rows.reduce((s, r) => s + r.value, 0) / rows.length;
    },
  };
}

export type OwidRow = Record<string, number | null> & { year: number };

// Countries that OWID lists without an ISO code, by name (J6b).
const OWID_ISO_OF: Record<string, string> = { Kosovo: "XKX" };

// Latest year of the OWID energy table for which `column` is known.
export function loadOwidEnergy(lock: Lock): {
  latest(iso3: string, column: string): { value: number; year: number } | null;
} {
  const file = path.join(CACHE_DIR, "owid-energy-data.csv");
  if (!fs.existsSync(file)) {
    throw new Error(
      "OWID energy cache missing: run `veritable:ingest -- fetch`",
    );
  }
  const data = fs.readFileSync(file);
  if (
    lock[`cache/owid-energy-data.csv@${OWID_ENERGY_COMMIT}`] !== sha256(data)
  ) {
    throw new Error("OWID energy CSV does not match sources.lock.json");
  }
  const lines = data.toString("utf8").split(/\r?\n/);
  const header = lines[0].split(",");
  const isoAt = header.indexOf("iso_code");
  const countryAt = header.indexOf("country");
  const yearAt = header.indexOf("year");
  const byIso = new Map<string, string[][]>();
  for (const line of lines.slice(1)) {
    if (line === "") continue;
    const cells = line.split(",");
    // OWID has no ISO code for the world aggregate, nor for Kosovo (J6b).
    const iso =
      cells[countryAt] === "World"
        ? WORLD
        : cells[isoAt] === "" && cells[countryAt] in OWID_ISO_OF
          ? OWID_ISO_OF[cells[countryAt]]
          : cells[isoAt];
    if (iso === "") continue;
    if (!byIso.has(iso)) byIso.set(iso, []);
    byIso.get(iso)!.push(cells);
  }
  return {
    latest(iso3, column) {
      const at = header.indexOf(column);
      if (at < 0) throw new Error(`OWID: no column ${column}`);
      const rows = (byIso.get(iso3) ?? [])
        .filter((c) => c[at] !== "" && c[at] !== undefined)
        .sort((a, b) => Number(a[yearAt]) - Number(b[yearAt]));
      const last = rows[rows.length - 1];
      return last === undefined
        ? null
        : { value: Number(last[at]), year: Number(last[yearAt]) };
    },
  };
}
