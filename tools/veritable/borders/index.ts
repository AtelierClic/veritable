import fs from "fs";
import path from "path";
import {
  Borders,
  encodeBorders,
} from "../../../src/veritable/data/bordersFile";
import { buildBorders, Inset, Override } from "./buildBorders";
import { calibrate, loadLandMask, prepare } from "./calibrate";
import { bordersImage, controlImage } from "./control";
import {
  CACHE_DIR,
  clipToBox,
  loadCountries,
  NATURAL_EARTH_TAG,
  parseFeatures,
  REPO_ROOT,
  SOURCES,
} from "./geodata";
import { toTile } from "./projections";

// Natural Earth (de facto, 1:10m) -> tiles. Replayable:
//
//   npm run veritable:borders -- calibrate --map europe
//       fits the georeference of a map from its coastline, writes
//       data/veritable/maps/<map>.georef.json and a control image.
//
//   npm run veritable:borders -- rasterize --scenario europe-10
//       rasterizes the nations of a scenario on its map, writes
//       data/veritable/borders/<scenario>.bin, a report and a control image.

function option(args: string[], name: string, fallback?: string): string {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] !== undefined) return args[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

export function georefPath(map: string): string {
  return path.join(REPO_ROOT, "data/veritable/maps", `${map}.georef.json`);
}

async function runCalibrate(args: string[]): Promise<void> {
  const map = option(args, "map");
  const mask = loadLandMask(map);
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "resources/maps", map, "manifest.json"),
      "utf8",
    ),
  );
  const countries = await loadCountries();

  // Starting point: the hand-placed nations of the map manifest, matched by
  // name to Natural Earth label points. Crude, only used to seed the search.
  const byName = new Map(countries.map((c) => [c.name.toLowerCase(), c]));
  const anchors = (
    manifest.nations as { name: string; coordinates?: number[] }[]
  ).flatMap((n) => {
    const country = byName.get(n.name.toLowerCase());
    if (!country?.label || !n.coordinates) return [];
    const [lon, lat] = country.label;
    return [{ lon, lat, x: n.coordinates[0], y: n.coordinates[1] }];
  });
  if (anchors.length < 6) {
    throw new Error(
      `only ${anchors.length} manifest nations match Natural Earth`,
    );
  }
  console.log(
    `${map}: ${mask.width}x${mask.height}, ${anchors.length} seed anchors`,
  );

  const lons = anchors.map((a) => a.lon);
  const lats = anchors.map((a) => a.lat);
  const box = {
    west: Math.min(...lons) - 40,
    east: Math.max(...lons) + 40,
    south: Math.max(-85, Math.min(...lats) - 25),
    north: Math.min(89, Math.max(...lats) + 25),
  };
  const land = prepare(clipToBox(countries, box));

  const started = Date.now();
  const result = calibrate(mask, land, anchors, (line) => console.log(line));
  console.log(
    `retained ${result.georef.projection}, IoU ${result.iou.toFixed(4)} at full resolution (${Math.round((Date.now() - started) / 1000)} s)`,
  );

  const round = (v: number, digits: number) => Number(v.toFixed(digits));
  const g = result.georef;
  const file = georefPath(map);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const previous = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : {};
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        map,
        width: mask.width,
        height: mask.height,
        projection: g.projection,
        lon0: round(g.lon0, 4),
        lat0: round(g.lat0, 4),
        lat1: round(g.lat1, 4),
        lat2: round(g.lat2, 4),
        scale: round(g.scale, 4),
        aspect: round(g.aspect, 5),
        rotation: round(g.rotation, 4),
        tx: round(g.tx, 3),
        ty: round(g.ty, 3),
        fit: {
          method: "coastline-iou",
          iou: round(result.iou, 4),
          candidates: result.candidates.map((c) => ({
            projection: c.projection,
            iouAtQuarterResolution: round(c.iou, 4),
          })),
          source: `natural-earth ${NATURAL_EARTH_TAG} ${SOURCES.countries.file}`,
          sha256: SOURCES.countries.sha256,
        },
        controlPoints: [],
        // Hand-maintained: kept across re-calibrations.
        insets: previous.insets ?? [],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`wrote ${path.relative(REPO_ROOT, file)}`);

  const image = path.join(CACHE_DIR, `${map}-calibration.png`);
  fs.writeFileSync(image, controlImage(mask, land, g));
  console.log(`wrote ${path.relative(REPO_ROOT, image)}`);
}

// Land borders read off the raster: two nations are neighbours when two of
// their tiles touch; a nation borders neutral land when one of its tiles
// touches a land tile that belongs to no nation of the scenario (that is how
// it trades electricity with the rest of the world).
export function landAdjacency(
  borders: Borders,
  land: Uint8Array,
): { landNeighbours: [string, string][]; bordersNeutralLand: string[] } {
  const { width, height, tiles, nations } = borders;
  const pairs = new Set<string>();
  const neutral = new Set<number>();
  const visit = (a: number, b: number) => {
    const va = tiles[a];
    const vb = tiles[b];
    if (va === vb) return;
    if (va !== 0 && vb !== 0) {
      pairs.add(va < vb ? `${va}:${vb}` : `${vb}:${va}`);
    } else if (va !== 0 && land[b] === 1) neutral.add(va);
    else if (vb !== 0 && land[a] === 1) neutral.add(vb);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x + 1 < width) visit(i, i + 1);
      if (y + 1 < height) visit(i, i + width);
    }
  }
  return {
    landNeighbours: [...pairs]
      .map((pair) => pair.split(":").map(Number))
      .sort((p, q) => p[0] - q[0] || p[1] - q[1])
      .map(([a, b]) => [nations[a - 1], nations[b - 1]] as [string, string]),
    bordersNeutralLand: [...neutral]
      .sort((a, b) => a - b)
      .map((v) => nations[v - 1]),
  };
}

// Closest tile owned by `value`, searching growing squares around (x, y).
export function nearestTileOf(
  borders: Borders,
  value: number,
  x: number,
  y: number,
): [number, number] {
  const { width, height, tiles } = borders;
  for (let r = 0; r < Math.max(width, height); r++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
        if (tiles[ty * width + tx] !== value) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = [tx, ty];
        }
      }
    }
    if (best !== null) return best;
  }
  throw new Error(`nation ${value} owns no tile`);
}

// Orphan land further than this from any Natural Earth country stays neutral.
const MAX_ORPHAN_DISTANCE_TILES = 60;

async function runRasterize(args: string[]): Promise<void> {
  const scenarioId = option(args, "scenario");
  const data = path.join(REPO_ROOT, "data/veritable");
  const scenario = JSON.parse(
    fs.readFileSync(path.join(data, "scenarios", `${scenarioId}.json`), "utf8"),
  );
  const map: string = scenario.map;
  const stored = JSON.parse(fs.readFileSync(georefPath(map), "utf8"));
  const insets: Inset[] = stored.insets ?? [];
  const mask = loadLandMask(map);
  if (stored.width !== mask.width || stored.height !== mask.height) {
    throw new Error(`${map}: georeference does not match the map size`);
  }

  const countries = await loadCountries();
  const overridesFile = path.join(data, "borders/overrides", `${map}.geojson`);
  const overrides: Override[] = fs.existsSync(overridesFile)
    ? parseFeatures(fs.readFileSync(overridesFile, "utf8"), "id", "id").map(
        (feature, i) => {
          const p = JSON.parse(fs.readFileSync(overridesFile, "utf8")).features[
            i
          ].properties;
          return { id: p.id, controller: p.controller, from: p.from, feature };
        },
      )
    : [];

  const { borders, report } = buildBorders(
    mask,
    stored,
    countries,
    overrides,
    insets,
    scenario.nations,
    MAX_ORPHAN_DISTANCE_TILES,
  );

  const bin = path.join(data, scenario.borders.rasterized);
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  const bytes = encodeBorders(borders);
  fs.writeFileSync(bin, bytes);
  const reportFile = bin.replace(/\.bin$/, ".report.json");
  fs.writeFileSync(
    reportFile,
    JSON.stringify(
      {
        scenario: scenarioId,
        map,
        source: `natural-earth ${NATURAL_EARTH_TAG}`,
        sha256: { countries: SOURCES.countries.sha256 },
        maxOrphanDistanceTiles: MAX_ORPHAN_DISTANCE_TILES,
        fileBytes: bytes.length,
        ...report,
      },
      null,
      2,
    ) + "\n",
  );
  // Capital tiles: lon/lat of the nation sheet -> nearest tile of the nation.
  const project = toTile(stored);
  const capitals: Record<string, [number, number]> = {};
  scenario.nations.forEach((id: string, n: number) => {
    const sheet = JSON.parse(
      fs.readFileSync(
        path.join(data, "nations", `${id.toLowerCase()}.json`),
        "utf8",
      ),
    );
    const [x, y] = project(sheet.capital.lon, sheet.capital.lat);
    capitals[id] = nearestTileOf(borders, n + 1, Math.floor(x), Math.floor(y));
  });
  fs.writeFileSync(
    bin.replace(/\.bin$/, ".meta.json"),
    JSON.stringify(
      {
        scenario: scenarioId,
        map,
        width: borders.width,
        height: borders.height,
        capitals,
        ...landAdjacency(borders, mask.land),
      },
      null,
      2,
    ) + "\n",
  );

  console.table(report.nations);
  console.log({ ...report, nations: undefined, fileBytes: bytes.length });

  const image = path.join(CACHE_DIR, `${scenarioId}-borders.png`);
  fs.writeFileSync(
    image,
    bordersImage(
      mask,
      borders,
      stored,
      prepare(overrides.map((o) => o.feature)),
    ),
  );
  console.log(
    `wrote ${path.relative(REPO_ROOT, bin)}, its report and ${path.relative(REPO_ROOT, image)}`,
  );

  // Zoom on every override marked approximate: those are checked by eye.
  overrides.forEach((o, i) => {
    const raw = JSON.parse(fs.readFileSync(overridesFile, "utf8")).features[i];
    if (raw.properties.status !== "approximate") return;
    const lons = o.feature.polygons.flat(2).map((p) => p[0]);
    const lats = o.feature.polygons.flat(2).map((p) => p[1]);
    const zoomFile = path.join(CACHE_DIR, `${scenarioId}-${o.id}.png`);
    fs.writeFileSync(
      zoomFile,
      bordersImage(mask, borders, stored, prepare([o.feature]), {
        west: Math.min(...lons) - 3,
        east: Math.max(...lons) + 0.5,
        south: Math.min(...lats) - 0.5,
        north: Math.max(...lats) + 0.5,
        factor: 3,
      }),
    );
    console.log(`wrote ${path.relative(REPO_ROOT, zoomFile)}`);
  });
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "calibrate":
      return runCalibrate(args);
    case "rasterize":
      return runRasterize(args);
    default:
      throw new Error(
        "usage: veritable:borders -- calibrate --map <map> | rasterize --scenario <id>",
      );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
