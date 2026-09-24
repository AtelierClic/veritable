// Map projections (sphere) and the georeference that places them on a tile
// grid. No dependency: the handful of formulas needed are written here.
// Reference: Snyder, "Map Projections — A Working Manual" (USGS, 1987).

export const PROJECTION_KINDS = [
  "eqc", // equirectangular (plate carrée)
  "laea",
  "stereo",
  "lcc",
  "albers",
  // World maps (J6): cylindrical and pseudo-cylindrical, with a seam at the
  // meridian opposite lon0 (see WORLD_PROJECTIONS).
  "mercator",
  "miller",
  "equalearth",
  "robinson",
  "naturalearth",
] as const;
export type ProjectionKind = (typeof PROJECTION_KINDS)[number];

// Projections of a whole world: longitudes are taken relative to lon0 in
// [-180, 180], and the rasterizer cuts every ring at the seam (lon0 + 180).
export const WORLD_PROJECTIONS: readonly ProjectionKind[] = [
  "mercator",
  "miller",
  "equalearth",
  "robinson",
  "naturalearth",
];

// Robinson's table (Snyder p. 257): X and Y factors every 5 degrees.
const ROBINSON_X = [
  1.0, 0.9986, 0.9954, 0.99, 0.9822, 0.973, 0.96, 0.9427, 0.9216, 0.8962,
  0.8679, 0.835, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322,
];
const ROBINSON_Y = [
  0.0, 0.062, 0.124, 0.186, 0.248, 0.31, 0.372, 0.434, 0.4958, 0.5571, 0.6176,
  0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1.0,
];
function robinsonAt(table: number[], absLatDeg: number): number {
  const at = Math.min(17.999999, absLatDeg / 5);
  const i = Math.floor(at);
  return table[i] + (table[i + 1] - table[i]) * (at - i);
}

// A georeference: projection + similarity transform to tile coordinates.
// Stored in data/veritable/maps/<map>.georef.json.
export interface Georef {
  projection: ProjectionKind;
  lon0: number; // degrees, projection centre
  lat0: number;
  lat1: number; // degrees, standard parallels (conics only)
  lat2: number;
  scale: number; // tiles per unit-sphere length
  aspect: number; // extra horizontal stretch (1 = none), applied before rotation
  rotation: number; // degrees, counter-clockwise
  tx: number; // tile coordinates of the projection origin
  ty: number;
}

const RAD = Math.PI / 180;

export type Forward = (lonDeg: number, latDeg: number) => [number, number];

// Unit-sphere forward projection, x east / y north.
export function forwardProjection(g: Georef): Forward {
  const lon0 = g.lon0 * RAD;
  const lat0 = g.lat0 * RAD;
  const sin0 = Math.sin(lat0);
  const cos0 = Math.cos(lat0);

  switch (g.projection) {
    case "eqc":
      return (lonDeg, latDeg) => [lonDeg * RAD - lon0, latDeg * RAD - lat0];
    case "laea":
      return (lonDeg, latDeg) => {
        const lat = latDeg * RAD;
        const dl = lonDeg * RAD - lon0;
        const sin = Math.sin(lat);
        const cos = Math.cos(lat);
        const d = 1 + sin0 * sin + cos0 * cos * Math.cos(dl);
        const k = Math.sqrt(2 / Math.max(d, 1e-12));
        return [
          k * cos * Math.sin(dl),
          k * (cos0 * sin - sin0 * cos * Math.cos(dl)),
        ];
      };
    case "stereo":
      return (lonDeg, latDeg) => {
        const lat = latDeg * RAD;
        const dl = lonDeg * RAD - lon0;
        const sin = Math.sin(lat);
        const cos = Math.cos(lat);
        const d = 1 + sin0 * sin + cos0 * cos * Math.cos(dl);
        const k = 2 / Math.max(d, 1e-12);
        return [
          k * cos * Math.sin(dl),
          k * (cos0 * sin - sin0 * cos * Math.cos(dl)),
        ];
      };
    case "lcc": {
      const p1 = g.lat1 * RAD;
      const p2 = g.lat2 * RAD;
      const t = (p: number) => Math.tan(Math.PI / 4 + p / 2);
      const n =
        Math.abs(p1 - p2) < 1e-9
          ? Math.sin(p1)
          : Math.log(Math.cos(p1) / Math.cos(p2)) / Math.log(t(p2) / t(p1));
      const f = (Math.cos(p1) * Math.pow(t(p1), n)) / n;
      const rho0 = f / Math.pow(t(lat0), n);
      return (lonDeg, latDeg) => {
        const lat = Math.max(-89.9, Math.min(89.9, latDeg)) * RAD;
        const rho = f / Math.pow(t(lat), n);
        const theta = n * (lonDeg * RAD - lon0);
        return [rho * Math.sin(theta), rho0 - rho * Math.cos(theta)];
      };
    }
    // World projections: lon is relative to lon0, already within [-180, 180]
    // (the rasterizer cuts rings at the seam).
    case "mercator":
      return (lonDeg, latDeg) => {
        const lat = Math.max(-85, Math.min(85, latDeg)) * RAD;
        return [
          (lonDeg - g.lon0) * RAD,
          Math.log(Math.tan(Math.PI / 4 + lat / 2)),
        ];
      };
    case "miller":
      return (lonDeg, latDeg) => [
        (lonDeg - g.lon0) * RAD,
        1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * latDeg * RAD)),
      ];
    case "equalearth": {
      // Savric, Patterson, Jenny (2018).
      const A1 = 1.340264;
      const A2 = -0.081106;
      const A3 = 0.000893;
      const A4 = 0.003796;
      const M = Math.sqrt(3) / 2;
      return (lonDeg, latDeg) => {
        const theta = Math.asin(M * Math.sin(latDeg * RAD));
        const t2 = theta * theta;
        const t6 = t2 * t2 * t2;
        const x =
          ((lonDeg - g.lon0) * RAD * Math.cos(theta)) /
          (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
        const y = theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
        return [x, y];
      };
    }
    case "robinson":
      return (lonDeg, latDeg) => {
        const a = Math.abs(latDeg);
        return [
          0.8487 * robinsonAt(ROBINSON_X, a) * (lonDeg - g.lon0) * RAD,
          1.3523 * robinsonAt(ROBINSON_Y, a) * Math.sign(latDeg),
        ];
      };
    case "naturalearth":
      // Natural Earth I (Savric et al. 2011), polynomial form.
      return (lonDeg, latDeg) => {
        const p = latDeg * RAD;
        const p2 = p * p;
        const p4 = p2 * p2;
        return [
          (lonDeg - g.lon0) *
            RAD *
            (0.8707 -
              0.131979 * p2 +
              p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))),
          p *
            (1.007226 +
              p2 *
                (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))),
        ];
      };
    case "albers": {
      const p1 = g.lat1 * RAD;
      const p2 = g.lat2 * RAD;
      const n = (Math.sin(p1) + Math.sin(p2)) / 2;
      const c = Math.cos(p1) ** 2 + 2 * n * Math.sin(p1);
      const rho0 = Math.sqrt(Math.max(c - 2 * n * sin0, 0)) / n;
      return (lonDeg, latDeg) => {
        const rho =
          Math.sqrt(Math.max(c - 2 * n * Math.sin(latDeg * RAD), 0)) / n;
        const theta = n * (lonDeg * RAD - lon0);
        return [rho * Math.sin(theta), rho0 - rho * Math.cos(theta)];
      };
    }
  }
}

export type ToTile = (lonDeg: number, latDeg: number) => [number, number];

// lon/lat -> continuous tile coordinates (x right, y DOWN).
export function toTile(g: Georef): ToTile {
  const forward = forwardProjection(g);
  const cos = Math.cos(g.rotation * RAD) * g.scale;
  const sin = Math.sin(g.rotation * RAD) * g.scale;
  return (lonDeg, latDeg) => {
    const [px, y] = forward(lonDeg, latDeg);
    const x = px * g.aspect;
    return [g.tx + cos * x - sin * y, g.ty - (sin * x + cos * y)];
  };
}
