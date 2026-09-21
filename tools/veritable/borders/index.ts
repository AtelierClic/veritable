import fs from "fs";
import path from "path";
import { calibrate, loadLandMask, prepare } from "./calibrate";
import { controlImage } from "./control";
import {
  CACHE_DIR,
  clipToBox,
  loadCountries,
  NATURAL_EARTH_TAG,
  REPO_ROOT,
  SOURCES,
} from "./geodata";

// Natural Earth (de facto, 1:10m) -> tiles. Replayable:
//
//   npm run veritable:borders -- calibrate --map europe
//       fits the georeference of a map from its coastline, writes
//       data/veritable/maps/<map>.georef.json and a control image.
//
// (The `rasterize` command is added with the scenario, see README.)

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

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "calibrate":
      return runCalibrate(args);
    default:
      throw new Error("usage: veritable:borders -- calibrate --map <map>");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
