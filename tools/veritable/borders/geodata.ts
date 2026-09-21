import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Natural Earth input: pinned tag, checked sha256, cached outside git.
// Public domain. Re-running the tool re-downloads whatever is missing.

export const NATURAL_EARTH_TAG = "v5.1.2";
const BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NATURAL_EARTH_TAG}/geojson`;

export const SOURCES = {
  countries: {
    file: "ne_10m_admin_0_countries.geojson",
    sha256: "239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255",
  },
  disputed: {
    file: "ne_10m_admin_0_disputed_areas.geojson",
    sha256: "9cafef8b7dfb6b164dc58f218f981f4ace9f716f6c03795d4c62d1ac9f3d50f5",
  },
} as const;

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
export const CACHE_DIR = path.join(HERE, "cache");

export interface Feature {
  id: string; // ADM0_A3 for countries
  name: string;
  label: [number, number] | null; // Natural Earth label point, lon/lat
  polygons: number[][][][]; // polygon -> ring -> [lon, lat]
}

export async function fetchSource(key: keyof typeof SOURCES): Promise<string> {
  const { file, sha256 } = SOURCES[key];
  const target = path.join(CACHE_DIR, file);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const response = await fetch(`${BASE}/${file}`);
    if (!response.ok) throw new Error(`download failed: ${file}`);
    fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  }
  const digest = crypto
    .createHash("sha256")
    .update(fs.readFileSync(target))
    .digest("hex");
  if (digest !== sha256) {
    throw new Error(`${file}: sha256 ${digest} does not match the pinned one`);
  }
  return target;
}

export function parseFeatures(
  geojsonText: string,
  idProperty: string,
  nameProperty: string,
): Feature[] {
  const collection = JSON.parse(geojsonText);
  const features: Feature[] = [];
  for (const f of collection.features) {
    const geometry = f.geometry;
    if (geometry === null) continue;
    const polygons: number[][][][] =
      geometry.type === "Polygon"
        ? [geometry.coordinates]
        : geometry.type === "MultiPolygon"
          ? geometry.coordinates
          : [];
    features.push({
      id: String(f.properties[idProperty]),
      name: String(f.properties[nameProperty] ?? f.properties[idProperty]),
      label:
        typeof f.properties.LABEL_X === "number" &&
        typeof f.properties.LABEL_Y === "number"
          ? [f.properties.LABEL_X, f.properties.LABEL_Y]
          : null,
      polygons,
    });
  }
  return features;
}

export async function loadCountries(): Promise<Feature[]> {
  const file = await fetchSource("countries");
  return parseFeatures(fs.readFileSync(file, "utf8"), "ADM0_A3", "ADMIN");
}

export interface LonLatBox {
  west: number;
  east: number;
  south: number;
  north: number;
}

// Keeps the polygons that touch the box: the rest can never reach the map.
export function clipToBox(features: Feature[], box: LonLatBox): Feature[] {
  return features
    .map((f) => ({
      ...f,
      polygons: f.polygons.filter((polygon) =>
        polygon[0].some(
          ([lon, lat]) =>
            lon >= box.west &&
            lon <= box.east &&
            lat >= box.south &&
            lat <= box.north,
        ),
      ),
    }))
    .filter((f) => f.polygons.length > 0);
}
