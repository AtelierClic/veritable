import fs from "fs";
import path from "path";
import { decodeBorders } from "../../../src/veritable/data/bordersFile";
import { TILE_NATION_MASK } from "../../../src/veritable/data/schemas/saveV1";
import { loadLandMask } from "./calibrate";
import { fetchSource, NATURAL_EARTH_TAG, REPO_ROOT, SOURCES } from "./geodata";
import { toTile } from "./projections";

// The cities of a scenario (J7): for each nation, the three largest
// populated places of Natural Earth (public domain; POP_MAX, French names by
// NAME_FR) on its land of 1 January 2026, and its capital when it is not
// one of them. A city belongs to the de facto owner of its tile on the
// first day, whatever country Natural Earth files it under (Donetsk is
// Russian in 2026). Replayable:
//
//   npm run veritable:borders -- cities --scenario world-2026
//
// writes data/veritable/cities/<scenario>.json, the names in i18n/fr.json
// (city.<id>) and a report: the share of the cities that fall on land, those
// moved to the nearest land (MAX_SHORE tiles at most), and those whose owner
// differs from the country of Natural Earth (to validate by hand).

const PER_NATION = 3;
const MAX_SHORE = 2;
// A capital the sea or a neighbour covers at the scale of the map (Dakar on
// its point, Malabo on its island) goes a little further, and is reported.
const MAX_CAPITAL_SHORE = 4;
// A place of Natural Earth is the capital of a sheet when it lies within
// this many degrees of the capital of the sheet.
const CAPITAL_DEGREES = 0.5;

export interface CityData {
  id: string;
  nation: string;
  name: string; // i18n key
  tile: number;
  x: number;
  y: number;
  population: number;
  capital: boolean;
  source: string;
}

interface Place {
  neId: number;
  name: string;
  ascii: string;
  country: string; // ADM0_A3 of Natural Earth
  lon: number;
  lat: number;
  population: number;
  capital: boolean;
}

// Two places of the same name within this many degrees are one.
const SAME_PLACE_DEGREES = 0.2;

function dedupe(places: Place[]): Place[] {
  const better = (a: Place, b: Place) =>
    Number(b.capital) - Number(a.capital) ||
    b.population - a.population ||
    a.neId - b.neId;
  const sorted = [...places].sort(better);
  const kept: Place[] = [];
  const byName = new Map<string, Place[]>();
  for (const place of sorted) {
    const key = slug(place.ascii);
    const same = byName.get(key) ?? [];
    if (
      same.some(
        (p) =>
          Math.abs(p.lon - place.lon) <= SAME_PLACE_DEGREES &&
          Math.abs(p.lat - place.lat) <= SAME_PLACE_DEGREES,
      )
    ) {
      continue;
    }
    same.push(place);
    byName.set(key, same);
    kept.push(place);
  }
  return kept.sort((a, b) => a.neId - b.neId);
}

function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function buildCities(scenarioId: string): Promise<void> {
  const scenario = JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "data/veritable/scenarios", `${scenarioId}.json`),
      "utf8",
    ),
  );
  const georef = JSON.parse(
    fs.readFileSync(
      path.join(
        REPO_ROOT,
        "data/veritable/maps",
        `${scenario.map}.georef.json`,
      ),
      "utf8",
    ),
  );
  const project = toTile(georef);
  const mask = loadLandMask(scenario.map);
  const borders = decodeBorders(
    new Uint8Array(
      fs.readFileSync(
        path.join(REPO_ROOT, "data/veritable/borders", `${scenarioId}.bin`),
      ),
    ),
  );
  const attachmentsPath = path.join(
    REPO_ROOT,
    "data/veritable/borders/attachments.world.json",
  );
  const attach: Record<string, string> =
    scenarioId === "world-2026" && fs.existsSync(attachmentsPath)
      ? JSON.parse(fs.readFileSync(attachmentsPath, "utf8")).attach
      : {};
  // Codes of Natural Earth that are not the ids of the scenario.
  const expected = (country: string): string =>
    attach[country] ?? (country === "KOS" ? "XKX" : country);

  const file = await fetchSource("places");
  const collection = JSON.parse(fs.readFileSync(file, "utf8"));
  const listed: Place[] = collection.features.map(
    (f: {
      properties: Record<string, unknown>;
      geometry: { coordinates: number[] };
    }) => ({
      neId: Number(f.properties.NE_ID),
      name: String(f.properties.NAME_FR ?? "") || String(f.properties.NAME),
      ascii: String(f.properties.NAMEASCII ?? f.properties.NAME),
      country: String(f.properties.ADM0_A3),
      lon: Number(f.properties.LONGITUDE ?? f.geometry.coordinates[0]),
      lat: Number(f.properties.LATITUDE ?? f.geometry.coordinates[1]),
      population: Number(f.properties.POP_MAX ?? 0),
      capital: Number(f.properties.ADM0CAP ?? 0) === 1,
    }),
  );

  // One city listed under two countries (Jerusalem, filed under Israel and
  // under Palestine) is one place: the capital, else the most populous.
  const places = dedupe(listed);

  const { width, height } = mask;
  // The tile of a place: its own when it is land, else the nearest land
  // within MAX_SHORE tiles; null beyond, or off the map.
  const placeTile = (
    lon: number,
    lat: number,
  ): { tile: number; moved: boolean } | null => {
    const [fx, fy] = project(lon, lat);
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    if (mask.land[y * width + x]) return { tile: y * width + x, moved: false };
    let best = -1;
    let bestD = Infinity;
    for (let dy = -MAX_SHORE; dy <= MAX_SHORE; dy++) {
      for (let dx = -MAX_SHORE; dx <= MAX_SHORE; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (!mask.land[ny * width + nx]) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = ny * width + nx;
        }
      }
    }
    return best < 0 ? null : { tile: best, moved: true };
  };
  const ownerOf = (tile: number): string | null => {
    const owner = borders.tiles[tile] & TILE_NATION_MASK;
    return owner === 0 ? null : borders.nations[owner - 1];
  };
  // The tile of a capital: its own when the nation holds it, else the
  // nearest tile of the nation within MAX_CAPITAL_SHORE tiles (Nicosia at
  // the edge of the north, Dakar on its point); null beyond.
  const farCapitals: string[] = [];
  const capitalTile = (
    nation: string,
    lon: number,
    lat: number,
  ): { tile: number; moved: boolean } | null => {
    const [fx, fy] = project(lon, lat);
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    if (ownerOf(y * width + x) === nation) {
      return { tile: y * width + x, moved: false };
    }
    let best = -1;
    let bestD = Infinity;
    for (let dy = -MAX_CAPITAL_SHORE; dy <= MAX_CAPITAL_SHORE; dy++) {
      for (let dx = -MAX_CAPITAL_SHORE; dx <= MAX_CAPITAL_SHORE; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (ownerOf(ny * width + nx) !== nation) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = ny * width + nx;
        }
      }
    }
    if (best >= 0 && bestD > MAX_SHORE * MAX_SHORE) {
      farCapitals.push(`${nation} (${Math.sqrt(bestD).toFixed(1)} tuiles)`);
    }
    return best < 0 ? null : { tile: best, moved: true };
  };

  // Every place on the land of a nation of the scenario.
  const byNation = new Map<
    string,
    (Place & { tile: number; moved: boolean })[]
  >();
  for (const place of places) {
    const at = placeTile(place.lon, place.lat);
    if (at === null) continue;
    const owner = ownerOf(at.tile);
    if (owner === null) continue;
    const list = byNation.get(owner) ?? [];
    list.push({ ...place, ...at });
    byNation.set(owner, list);
  }

  const i18nFile = path.join(REPO_ROOT, "data/veritable/i18n/fr.json");
  const i18n = JSON.parse(fs.readFileSync(i18nFile, "utf8")) as Record<
    string,
    string
  >;
  const cities: CityData[] = [];
  const mismatches: string[] = [];
  const noCity: string[] = [];
  let moved = 0;
  const source = `natural-earth ${NATURAL_EARTH_TAG} ${SOURCES.places.file}`;
  const sheetOf = (nation: string) =>
    JSON.parse(
      fs.readFileSync(
        path.join(
          REPO_ROOT,
          "data/veritable/nations",
          `${nation.toLowerCase()}.json`,
        ),
        "utf8",
      ),
    );
  // The capital of each sheet: the place of Natural Earth nearest to it
  // (whoever holds its tile), on the nearest land of the nation. A place
  // that is the capital of one nation is no city of another (Jerusalem,
  // on the line between Israel and the West Bank at the scale of the map).
  const capitals = new Map<string, Place | undefined>();
  for (const nation of scenario.nations as string[]) {
    const sheet = sheetOf(nation);
    capitals.set(
      nation,
      places
        .map((c) => ({
          c,
          d: Math.hypot(c.lon - sheet.capital.lon, c.lat - sheet.capital.lat),
        }))
        .filter((x) => x.d <= CAPITAL_DEGREES)
        .sort((a, b) => a.d - b.d)[0]?.c,
    );
  }
  const capitalIds = new Set(
    [...capitals.values()].flatMap((p) => (p === undefined ? [] : [p.neId])),
  );
  for (const nation of scenario.nations as string[]) {
    const sheet = sheetOf(nation);
    const nearest = capitals.get(nation);
    const candidates = (byNation.get(nation) ?? [])
      .filter((c) => !capitalIds.has(c.neId) || c.neId === nearest?.neId)
      .sort((a, b) => b.population - a.population || a.neId - b.neId);
    const capitalPlace =
      nearest === undefined
        ? undefined
        : candidates.find((c) => c.neId === nearest.neId);
    const chosen = candidates
      .filter((c) => c !== capitalPlace)
      .slice(0, PER_NATION);
    // Among the three largest when it is one of them.
    if (
      capitalPlace !== undefined &&
      candidates.indexOf(capitalPlace) < PER_NATION
    ) {
      chosen.splice(PER_NATION - 1, 1);
    }
    const list: {
      place: Place | null;
      at: { tile: number; moved: boolean } | null;
      capital: boolean;
    }[] = chosen.map((place) => ({ place, at: place, capital: false }));
    list.push({
      place: nearest ?? null,
      at:
        nearest === undefined
          ? capitalTile(nation, sheet.capital.lon, sheet.capital.lat)
          : capitalTile(nation, nearest.lon, nearest.lat),
      capital: true,
    });
    for (const { place, at, capital: isCapital } of list) {
      if (at === null) continue;
      const tile = at.tile;
      if (at.moved) moved++;
      let population: number;
      let id: string;
      let name: string;
      if (place === null) {
        population = 0;
        id = `${nation.toLowerCase()}-capital`;
        name = i18n[sheet.capital.name] ?? sheet.capital.name;
      } else {
        population = place.population;
        id = `${nation.toLowerCase()}-${slug(place.ascii)}`;
        name = place.name;
        if (!isCapital && expected(place.country) !== nation) {
          mismatches.push(
            `${place.name} (${place.country} dans Natural Earth, ${nation} de facto)`,
          );
        }
      }
      i18n[`city.${id}`] = name;
      cities.push({
        id,
        nation,
        name: `city.${id}`,
        tile,
        x: tile % width,
        y: Math.floor(tile / width),
        population,
        capital: isCapital,
        source:
          place === null
            ? `sheet capital (${sheet.capital.source})`
            : `${source} NE_ID=${place.neId}`,
      });
    }
    if (!cities.some((c) => c.nation === nation)) noCity.push(nation);
  }
  const outDir = path.join(REPO_ROOT, "data/veritable/cities");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `${scenarioId}.json`),
    `${JSON.stringify(
      {
        scenario: scenarioId,
        map: scenario.map,
        source: `Natural Earth ${NATURAL_EARTH_TAG}, populated places (public domain); de facto owner of the tile on ${scenario.startDate}`,
        cities,
      },
      null,
      2,
    )}\n`,
  );
  // The names of cities no scenario lists any more go.
  const named = new Set<string>();
  for (const f of fs.readdirSync(outDir)) {
    if (!f.endsWith(".json") || f.endsWith(".report.json")) continue;
    const other = JSON.parse(fs.readFileSync(path.join(outDir, f), "utf8"));
    for (const c of other.cities as CityData[]) named.add(c.name);
  }
  for (const key of Object.keys(i18n)) {
    if (key.startsWith("city.") && !named.has(key)) delete i18n[key];
  }
  fs.writeFileSync(i18nFile, JSON.stringify(i18n, null, 2) + "\n");
  const onLand = cities.length === 0 ? 0 : 1 - moved / cities.length;
  const report = {
    cities: cities.length,
    capitals: cities.filter((c) => c.capital).length,
    onLandShare: Math.round(onLand * 1000) / 1000,
    moved,
    nationsWithoutCity: noCity,
    capitalsMovedBeyondTwoTiles: farCapitals,
    ownerDiffersFromNaturalEarth: mismatches,
  };
  fs.writeFileSync(
    path.join(outDir, `${scenarioId}.report.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    `${scenarioId}: ${cities.length} cities, ${Math.round(onLand * 1000) / 10} % on land, ${mismatches.length} owners to validate, ${noCity.length} nations without a city`,
  );
}
