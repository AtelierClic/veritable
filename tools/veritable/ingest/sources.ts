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
//
// `npm run veritable:ingest -- fetch` refreshes snapshots and lock;
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
} as const;
export type WorldBankKey = keyof typeof WORLD_BANK_INDICATORS;

export const WORLD = "WLD";

export type Lock = Record<string, string>; // relative path -> sha256

export function sha256(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
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

export async function fetchAll(countries: readonly string[]): Promise<void> {
  const lock: Lock = {};
  fs.mkdirSync(path.join(SNAPSHOT_DIR, "worldbank"), { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const list = [...countries, WORLD].join(";");
  for (const key of Object.keys(WORLD_BANK_INDICATORS) as WorldBankKey[]) {
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
    lock[`snapshots/worldbank/${id}.json`] = sha256(text);
    console.log(`World Bank ${id}: ${snapshot.values.length} values`);
  }
  const csv = Buffer.from(await (await fetch(OWID_ENERGY_URL)).arrayBuffer());
  fs.writeFileSync(path.join(CACHE_DIR, "owid-energy-data.csv"), csv);
  lock[`cache/owid-energy-data.csv@${OWID_ENERGY_COMMIT}`] = sha256(csv);
  console.log(`OWID energy: ${csv.length} bytes`);
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + "\n");
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
  if (lock[`snapshots/worldbank/${id}.json`] !== sha256(text)) {
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
    // OWID has no ISO code for the world aggregate.
    const iso = cells[countryAt] === "World" ? WORLD : cells[isoAt];
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
