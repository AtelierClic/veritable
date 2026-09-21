// Map projections (sphere) and the georeference that places them on a tile
// grid. No dependency: the handful of formulas needed are written here.
// Reference: Snyder, "Map Projections — A Working Manual" (USGS, 1987).

export const PROJECTION_KINDS = [
  "eqc", // equirectangular (plate carrée)
  "laea",
  "stereo",
  "lcc",
  "albers",
] as const;
export type ProjectionKind = (typeof PROJECTION_KINDS)[number];

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
