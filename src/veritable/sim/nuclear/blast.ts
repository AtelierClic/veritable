// What a nuclear burst does to the land and the people around it (J7c): the
// deaths and the contamination of each tile, from the people the tile holds
// and its distance to the burst in kilometres. A shot never changes the owner
// or the nature of a tile.
//
// Two radii a weapon (config.nuclear.weapons): destruction and contamination.
// In the disc of destruction the lethality falls from `centerLethality` at
// ground zero to 0 at its edge as 1 - (d / r)², half of it on average over an
// evenly peopled disc — the rule of thumb of the Office of Technology
// Assessment (The Effects of Nuclear War, 1979: about half killed within the
// 5 psi ring, where the radii of the config fall for an airburst, after
// Glasstone and Dolan, The Effects of Nuclear Weapons, 1977); between the
// two radii, `contaminatedLethality`. The contamination is 1 in the disc of
// destruction and falls linearly to `contaminationEdge` at the outer radius.
//
// A tile is a disc of its area centred on its centre. Its people are spread
// over it, unless it is urban (more than `urbanDensityKm2` people a km²):
// then they stand in a disc around its town at `coreDensityKm2` (never wider
// than the tile), so that a burst smaller than a tile of the world map
// (9 km) kills the people it covers, not a share of the tile's.

export interface BlastWeapon {
  destructionKm: number;
  contaminationKm: number;
}

export interface BlastRules {
  rings: number;
  centerLethality: number;
  contaminatedLethality: number;
  contaminationEdge: number;
  urbanDensityKm2: number;
  coreDensityKm2: number;
}

export interface BlastTile {
  tile: number;
  // Centre of the tile from the burst, km.
  dxKm: number;
  dyKm: number;
  areaKm2: number;
  people: number;
}

export interface BlastHit {
  tile: number;
  deaths: number;
  contamination: number;
}

// Area of the intersection of two discs of radii r1 and r2 whose centres are
// d apart.
export function circleOverlap(d: number, r1: number, r2: number): number {
  if (r1 <= 0 || r2 <= 0 || d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const a =
    r1 * r1 * Math.acos(clamp((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)));
  const b =
    r2 * r2 * Math.acos(clamp((d * d + r2 * r2 - r1 * r1) / (2 * d * r2)));
  const c =
    0.5 *
    Math.sqrt(
      Math.max(
        0,
        (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2),
      ),
    );
  return a + b - c;
}

// Share of a disc of radius `own`, `d` from the burst, within `r` of it.
function within(d: number, r: number, own: number): number {
  if (own <= 0) return d <= r ? 1 : 0;
  return Math.min(1, circleOverlap(d, r, own) / (Math.PI * own * own));
}

// Mean of 1 - (x / r)² over the ring [a, b] of a disc, weighted by area.
function lethalityOfRing(a: number, b: number, r: number): number {
  return 1 - (a * a + b * b) / (2 * r * r);
}

// Mean distance from the centre over the ring [a, b], weighted by area.
function meanRadius(a: number, b: number): number {
  return (2 / 3) * ((b ** 3 - a ** 3) / (b * b - a * a));
}

export function blastHits(
  tiles: readonly BlastTile[],
  weapon: BlastWeapon,
  rules: BlastRules,
): BlastHit[] {
  const rd = weapon.destructionKm;
  const rc = Math.max(rd, weapon.contaminationKm);
  const rings = Math.max(1, Math.round(rules.rings));
  const out: BlastHit[] = [];
  for (const t of tiles) {
    const d = Math.hypot(t.dxKm, t.dyKm);
    const land = Math.sqrt(t.areaKm2 / Math.PI);
    if (d - land >= rc) continue;
    // The land: 1 in the disc of destruction, then linear to the edge.
    let contamination = within(d, rd, land);
    for (let k = 0; k < rings; k++) {
      const a = rd + ((rc - rd) * k) / rings;
      const b = rd + ((rc - rd) * (k + 1)) / rings;
      if (b <= a) continue;
      const share = within(d, b, land) - within(d, a, land);
      if (share <= 0) continue;
      const x = (meanRadius(a, b) - rd) / (rc - rd);
      contamination += share * (1 - (1 - rules.contaminationEdge) * x);
    }
    // The people.
    let deaths = 0;
    if (t.people > 0) {
      const urban = t.people / t.areaKm2 >= rules.urbanDensityKm2;
      const area = urban
        ? Math.min(t.areaKm2, t.people / rules.coreDensityKm2)
        : t.areaKm2;
      const own = Math.sqrt(area / Math.PI);
      let lethal = 0;
      for (let k = 0; k < rings; k++) {
        const a = (rd * k) / rings;
        const b = (rd * (k + 1)) / rings;
        const share = within(d, b, own) - within(d, a, own);
        if (share <= 0) continue;
        lethal += share * rules.centerLethality * lethalityOfRing(a, b, rd);
      }
      lethal +=
        rules.contaminatedLethality * (within(d, rc, own) - within(d, rd, own));
      deaths = t.people * Math.min(1, Math.max(0, lethal));
    }
    contamination = Math.min(1, Math.max(0, contamination));
    if (deaths <= 0 && contamination <= 0) continue;
    out.push({ tile: t.tile, deaths, contamination });
  }
  return out;
}
