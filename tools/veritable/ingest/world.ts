import fs from "fs";
import path from "path";
import {
  CACHE_DIR,
  jsonSha256,
  Lock,
  LOCK_FILE,
  readLock,
  Series,
  sha256,
  SNAPSHOT_DIR,
  WORLD,
  WORLD_BANK_INDICATORS,
  WorldBankKey,
  worldBankSnapshot,
} from "./sources";

// Open data for every nation of the world (J6), pinned like the J2 sources:
//
//   npm run veritable:ingest -- fetch-world --scenario world-2026
//
// - World Bank Open Data (CC BY 4.0): every indicator of the sheets, for every
//   nation of the scenario and the world aggregate, as compact CSV snapshots
//   (snapshots/worldbank-world/<indicator>.csv, committed, sha256 in the
//   lock). The J2 JSON snapshots keep precedence for the nations and the
//   world aggregate they hold, so the europe-10 sheets do not move.
// - IMF World Economic Outlook, DataMapper API (all rights reserved: cache
//   outside git, sha256 in the lock, only derived figures reach the sheets):
//   gross debt, GDP in US$, general government revenue and expenditure.
// - V-Dem "Regimes of the World" as republished by Our World in Data
//   (CC BY-SA 4.0: the derived snapshot snapshots/vdem/row.csv carries its
//   own licence line, share-alike).
// - Natural Earth populated places (public domain, pinned tag): the capitals.

export const WORLD_EXTRA_INDICATORS = {
  personnel: "MS.MIL.TOTL.P1", // armed forces personnel (IISS, via the WB)
  rents: "NY.GDP.TOTL.RT.ZS", // natural resource rents, % of GDP
  oresExports: "TX.VAL.MMTL.ZS.UN", // ores and metals, % of merchandise exports
  merchandiseExports: "TX.VAL.MRCH.CD.WT", // merchandise exports, current US$
  taxRevenue: "GC.TAX.TOTL.GD.ZS", // tax revenue, % of GDP
} as const;
export type WorldExtraKey = keyof typeof WORLD_EXTRA_INDICATORS;
export type AnyWorldBankKey = WorldBankKey | WorldExtraKey;

export function indicatorOf(key: AnyWorldBankKey): string {
  return key in WORLD_BANK_INDICATORS
    ? WORLD_BANK_INDICATORS[key as WorldBankKey]
    : WORLD_EXTRA_INDICATORS[key as WorldExtraKey];
}

export const IMF_WORLD_INDICATORS = [
  "GGXWDG_NGDP", // general government gross debt, % of GDP
  "NGDPD", // GDP, current prices, bn US$
  "GGR_G01_GDP_PT", // general government revenue, % of GDP (Fiscal Monitor)
  "G_X_G01_GDP_PT", // general government expenditure, % of GDP (Fiscal Monitor)
] as const;
const IMF_WORLD_CACHE = "cache/imf-weo-world.json";

export const OWID_REGIME_URL =
  "https://ourworldindata.org/grapher/political-regime.csv?v=1&csvType=full&useColumnShortNames=true";
const OWID_REGIME_CACHE = "cache/owid-political-regime.csv";
export const VDEM_SNAPSHOT = "snapshots/vdem/row.csv";

export const NATURAL_EARTH_PLACES = {
  url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_populated_places.geojson",
  cache: "cache/ne_10m_populated_places.geojson",
};

const HERE = path.dirname(LOCK_FILE);
const worldSnapshot = (id: string) =>
  path.join(SNAPSHOT_DIR, "worldbank-world", `${id}.csv`);

async function download(url: string): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "veritable-ingest/0.2 (https://github.com/AtelierClic/veritable; open-source game data)",
        },
      });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      if (attempt >= 3 || response.status < 500) {
        throw new Error(`HTTP ${response.status} for ${url.slice(0, 80)}`);
      }
    } catch (error) {
      if (attempt >= 3) throw error;
    }
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
  }
}

export async function fetchWorld(nations: readonly string[]): Promise<void> {
  const lock = readLock();
  const wanted = new Set([...nations, WORLD]);
  fs.mkdirSync(path.join(SNAPSHOT_DIR, "worldbank-world"), { recursive: true });
  fs.mkdirSync(path.join(SNAPSHOT_DIR, "vdem"), { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const keys = [
    ...Object.keys(WORLD_BANK_INDICATORS),
    ...Object.keys(WORLD_EXTRA_INDICATORS),
  ] as AnyWorldBankKey[];
  for (const key of keys) {
    const id = indicatorOf(key);
    // Resumable: a snapshot already written is kept (delete it to refetch).
    if (fs.existsSync(worldSnapshot(id))) {
      lock[`snapshots/worldbank-world/${id}.csv`] = sha256(
        fs.readFileSync(worldSnapshot(id), "utf8"),
      );
      continue;
    }
    const url = `https://api.worldbank.org/v2/country/all/indicator/${id}?format=json&date=2010:2025&per_page=20000`;
    const [meta, rows] = JSON.parse((await download(url)).toString()) as [
      { lastupdated: string },
      { countryiso3code: string; date: string; value: number | null }[],
    ];
    const lines = rows
      .filter((r) => r.value !== null && wanted.has(r.countryiso3code))
      .map((r) => ({
        iso3: r.countryiso3code,
        year: Number(r.date),
        v: r.value,
      }))
      .sort((a, b) => a.iso3.localeCompare(b.iso3) || a.year - b.year)
      .map((r) => `${r.iso3},${r.year},${r.v}`);
    const text =
      `# World Bank Open Data ${id}, last updated ${meta.lastupdated}, CC BY 4.0\n` +
      `iso3,year,value\n${lines.join("\n")}\n`;
    fs.writeFileSync(worldSnapshot(id), text);
    lock[`snapshots/worldbank-world/${id}.csv`] = sha256(text);
    console.log(`World Bank ${id}: ${lines.length} values`);
  }

  const imf: Record<string, Record<string, Record<string, number>>> = {};
  for (const id of IMF_WORLD_INDICATORS) {
    const body = JSON.parse(
      (
        await download(`https://www.imf.org/external/datamapper/api/v1/${id}`)
      ).toString(),
    ) as { values: Record<string, Record<string, Record<string, number>>> };
    const series = body.values?.[id] ?? {};
    imf[id] = Object.fromEntries(
      Object.entries(series).filter(([iso3]) => wanted.has(iso3)),
    );
    console.log(`IMF ${id}: ${Object.keys(imf[id]).length} countries`);
  }
  const imfText =
    JSON.stringify({
      source: "IMF World Economic Outlook, DataMapper API",
      fetchedAt: new Date().toISOString().slice(0, 10),
      indicators: imf,
    }) + "\n";
  fs.writeFileSync(path.join(HERE, IMF_WORLD_CACHE), imfText);
  lock[IMF_WORLD_CACHE] = sha256(imfText);

  const regime = await download(OWID_REGIME_URL);
  fs.writeFileSync(path.join(HERE, OWID_REGIME_CACHE), regime);
  lock[OWID_REGIME_CACHE] = sha256(regime);
  // The derived snapshot: the last year of each nation of the scenario.
  const rows = regime.toString("utf8").split(/\r?\n/);
  const header = rows[0].split(",");
  const codeAt = header.indexOf("code");
  const yearAt = header.indexOf("year");
  const valueAt = header.findIndex((h) => h.startsWith("regime_row"));
  const last = new Map<string, { year: number; value: number }>();
  for (const line of rows.slice(1)) {
    const cells = line.split(",");
    const code = cells[codeAt];
    if (!wanted.has(code) || cells[valueAt] === "") continue;
    const year = Number(cells[yearAt]);
    if ((last.get(code)?.year ?? -1) < year) {
      last.set(code, { year, value: Number(cells[valueAt]) });
    }
  }
  const vdem =
    "# V-Dem Regimes of the World (v2x_regime), processed by Our World in Data: " +
    "0 closed autocracy, 1 electoral autocracy, 2 electoral democracy, 3 liberal democracy. " +
    "Licence CC BY-SA 4.0 (share-alike): Coppedge et al., V-Dem Dataset v16, Varieties of Democracy Project, doi:10.23696/vdemds26.\n" +
    "iso3,year,row\n" +
    [...last]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, v]) => `${code},${v.year},${v.value}`)
      .join("\n") +
    "\n";
  fs.writeFileSync(path.join(HERE, VDEM_SNAPSHOT), vdem);
  lock[VDEM_SNAPSHOT] = sha256(vdem);
  console.log(`V-Dem RoW: ${last.size} nations`);

  const places = await download(NATURAL_EARTH_PLACES.url);
  fs.writeFileSync(path.join(HERE, NATURAL_EARTH_PLACES.cache), places);
  lock[NATURAL_EARTH_PLACES.cache] = sha256(places);
  console.log(`Natural Earth populated places: ${places.length} bytes`);

  fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + "\n");
}

// A World Bank indicator for every nation: the J2 JSON snapshot first (the
// nations and the world aggregate it holds), the world CSV for the others.
export function loadWorldSeries(key: AnyWorldBankKey, lock: Lock): Series {
  const id = indicatorOf(key);
  const values = new Map<string, { year: number; value: number }[]>();
  const csvFile = worldSnapshot(id);
  if (fs.existsSync(csvFile)) {
    const text = fs.readFileSync(csvFile, "utf8");
    if (lock[`snapshots/worldbank-world/${id}.csv`] !== sha256(text)) {
      throw new Error(`${id}: world snapshot does not match the lock`);
    }
    for (const line of text.split(/\r?\n/)) {
      if (line === "" || line.startsWith("#") || line.startsWith("iso3"))
        continue;
      const [iso3, year, value] = line.split(",");
      if (!values.has(iso3)) values.set(iso3, []);
      values.get(iso3)!.push({ year: Number(year), value: Number(value) });
    }
  }
  let lastUpdated = "n/a";
  if (key in WORLD_BANK_INDICATORS) {
    const file = worldBankSnapshot(key as WorldBankKey);
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, "utf8");
      if (lock[`snapshots/worldbank/${id}.json`] !== jsonSha256(text)) {
        throw new Error(`${id}: snapshot does not match sources.lock.json`);
      }
      const snapshot = JSON.parse(text) as {
        lastUpdated: string;
        values: { iso3: string; year: number; value: number }[];
      };
      lastUpdated = snapshot.lastUpdated;
      const pinned = new Map<string, { year: number; value: number }[]>();
      for (const v of snapshot.values) {
        if (!pinned.has(v.iso3)) pinned.set(v.iso3, []);
        pinned.get(v.iso3)!.push({ year: v.year, value: v.value });
      }
      for (const [iso3, rows] of pinned) values.set(iso3, rows);
    }
  }
  for (const rows of values.values()) rows.sort((a, b) => a.year - b.year);
  return {
    lastUpdated,
    latest(iso3, maxYear = 9999) {
      const rows = (values.get(iso3) ?? []).filter((r) => r.year <= maxYear);
      const last = rows[rows.length - 1];
      return last === undefined ? null : { value: last.value, year: last.year };
    },
    mean(iso3, fromYear, toYear) {
      const rows = (values.get(iso3) ?? []).filter(
        (r) => r.year >= fromYear && r.year <= toYear,
      );
      return rows.length === 0
        ? null
        : rows.reduce((s, r) => s + r.value, 0) / rows.length;
    },
  };
}

export interface ImfWorld {
  fetchedAt: string;
  at(
    indicator: (typeof IMF_WORLD_INDICATORS)[number],
    iso3: string,
    year: number,
  ): { value: number; year: number } | null;
}

export function loadImfWorld(lock: Lock): ImfWorld {
  const file = path.join(HERE, IMF_WORLD_CACHE);
  if (!fs.existsSync(file)) {
    throw new Error(
      "IMF world cache missing: run `veritable:ingest -- fetch-world`",
    );
  }
  const text = fs.readFileSync(file, "utf8");
  if (lock[IMF_WORLD_CACHE] !== sha256(text)) {
    throw new Error("IMF world cache does not match sources.lock.json");
  }
  const cache = JSON.parse(text) as {
    fetchedAt: string;
    indicators: Record<string, Record<string, Record<string, number>>>;
  };
  return {
    fetchedAt: cache.fetchedAt,
    at(indicator, iso3, year) {
      const byYear = cache.indicators[indicator]?.[iso3];
      if (byYear === undefined) return null;
      for (let y = year; y >= 1980; y--) {
        const value = byYear[String(y)];
        if (value !== undefined) return { value, year: y };
      }
      return null;
    },
  };
}

// V-Dem Regimes of the World of every nation (last year known).
export function loadVdem(
  lock: Lock,
): Map<string, { year: number; row: number }> {
  const file = path.join(HERE, VDEM_SNAPSHOT);
  const text = fs.readFileSync(file, "utf8");
  if (lock[VDEM_SNAPSHOT] !== sha256(text)) {
    throw new Error("V-Dem snapshot does not match sources.lock.json");
  }
  const out = new Map<string, { year: number; row: number }>();
  for (const line of text.split(/\r?\n/)) {
    if (line === "" || line.startsWith("#") || line.startsWith("iso3"))
      continue;
    const [iso3, year, row] = line.split(",");
    out.set(iso3, { year: Number(year), row: Number(row) });
  }
  return out;
}

// Capitals of Natural Earth (FEATURECLA "Admin-0 capital"), by ADM0_A3, with
// their French name when Natural Earth has one.
export function loadCapitals(
  lock: Lock,
): Map<
  string,
  { name: string; nameFr: string | null; lon: number; lat: number }[]
> {
  const file = path.join(HERE, NATURAL_EARTH_PLACES.cache);
  const data = fs.readFileSync(file);
  if (lock[NATURAL_EARTH_PLACES.cache] !== sha256(data)) {
    throw new Error("Natural Earth places do not match sources.lock.json");
  }
  const collection = JSON.parse(data.toString("utf8")) as {
    features: { properties: Record<string, unknown> }[];
  };
  const out = new Map<
    string,
    { name: string; nameFr: string | null; lon: number; lat: number }[]
  >();
  for (const f of collection.features) {
    const p = f.properties;
    const kind = String(p.FEATURECLA ?? "");
    if (!kind.startsWith("Admin-0 capital")) continue;
    const iso3 = String(p.ADM0_A3 ?? "");
    const list = out.get(iso3) ?? [];
    list.push({
      name: String(p.NAME ?? ""),
      nameFr:
        typeof p.NAME_FR === "string" && p.NAME_FR !== "" ? p.NAME_FR : null,
      lon: Number(p.LONGITUDE),
      lat: Number(p.LATITUDE),
    });
    out.set(iso3, list);
  }
  return out;
}
