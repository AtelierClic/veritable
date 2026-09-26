import { NationId } from "../../data/schemas/common";
import { ContaminationEntry } from "../../data/schemas/save";
import { BlastHit } from "./blast";

// The contamination of the land (J7c): what a nuclear burst leaves on each
// tile, from 0 to 1, and the share of its people it killed. The simulation
// keeps it (sorted by tile) and hands it to the world, which takes the dead
// off its tiles, wears the divisions that fight there and shows it on the
// map; a contaminated tile produces x (1 - contamination) (the nation's
// production and GDP follow the people-weighted contamination of its land).
//
// It halves every `halfLifeYears`, up to `maxSpeedup` times as fast with the
// infrastructure spending of the nation that holds it and the aid it gets;
// the people come back on a tile (the dead share halves every
// `repopulationHalfLifeYears`) only once its contamination is at most
// `repopulationMax`.

export interface ContaminationRules {
  halfLifeYears: number;
  maxSpeedup: number;
  infrastructurePointsForMax: number;
  aidPctGdpForMax: number;
  repopulationMax: number;
  repopulationHalfLifeYears: number;
  minLevel: number;
}

const DAYS_PER_YEAR = 365.25;

// A burst's hits merged into the entries: contamination and dead shares
// compound (1 - (1 - a)(1 - b)). `deathShare` of a hit: the share of the
// people then on the tile it killed.
export function addBurst(
  entries: readonly ContaminationEntry[],
  hits: readonly (BlastHit & { deathShare: number })[],
): ContaminationEntry[] {
  const byTile = new Map(entries.map((e) => [e.tile, { ...e }]));
  for (const hit of hits) {
    const old = byTile.get(hit.tile) ?? { tile: hit.tile, level: 0, dead: 0 };
    byTile.set(hit.tile, {
      tile: hit.tile,
      level: 1 - (1 - old.level) * (1 - clamp01(hit.contamination)),
      dead: 1 - (1 - old.dead) * (1 - clamp01(hit.deathShare)),
    });
  }
  return [...byTile.values()].sort((a, b) => a.tile - b.tile);
}

// How much faster the land of a nation heals (1 to maxSpeedup): its
// infrastructure spending above its first-day share and the aid it gets,
// both in points of GDP, each half of the way at its reference.
export function healingSpeedup(
  rules: ContaminationRules,
  infrastructurePointsAbove: number,
  aidPctGdp: number,
): number {
  const infra =
    Math.max(0, infrastructurePointsAbove) / rules.infrastructurePointsForMax;
  const aid = Math.max(0, aidPctGdp) / rules.aidPctGdpForMax;
  const t = Math.min(1, 0.5 * infra + 0.5 * aid);
  return 1 + (rules.maxSpeedup - 1) * t;
}

// `days` of healing: each tile by the speed-up of the nation that holds it
// (1 without an owner). Entries under `minLevel` with their dead come back
// are dropped.
export function healContamination(
  entries: readonly ContaminationEntry[],
  days: number,
  rules: ContaminationRules,
  speedupOf: (tile: number) => number,
): ContaminationEntry[] {
  if (days <= 0 || entries.length === 0) return [...entries];
  const out: ContaminationEntry[] = [];
  const repopulation = days / (rules.repopulationHalfLifeYears * DAYS_PER_YEAR);
  for (const e of entries) {
    const years = (days * speedupOf(e.tile)) / DAYS_PER_YEAR;
    const level = e.level * Math.pow(0.5, years / rules.halfLifeYears);
    const dead =
      level <= rules.repopulationMax
        ? e.dead * Math.pow(0.5, repopulation)
        : e.dead;
    if (level < rules.minLevel && dead < rules.minLevel) continue;
    out.push({ tile: e.tile, level, dead });
  }
  return out;
}

// Deaths of a burst by nation (units of the population grid), from the hits
// and the owners of their tiles.
export function deathsByNation(
  hits: readonly BlastHit[],
  ownerOf: (tile: number) => NationId | null,
): Map<NationId, number> {
  const out = new Map<NationId, number>();
  for (const hit of hits) {
    if (hit.deaths <= 0) continue;
    const owner = ownerOf(hit.tile);
    if (owner === null) continue;
    out.set(owner, (out.get(owner) ?? 0) + hit.deaths);
  }
  return out;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// The contamination as a world keeps it (CoreBridge, the test worlds): the
// level of each tile, the dead off the people of its tiles, the mean of a
// segment of a front, the people-weighted share of each nation's land.
export class ContaminationTiles {
  private levels = new Map<number, number>();
  private shares: Map<NationId, number> | null = null;
  // Bumped at every change (the map asks for the tiles only when it moved).
  version = 0;

  set(
    entries: readonly ContaminationEntry[],
    people: {
      setDead(
        shares: ReadonlyMap<number, number>,
        ownerOf: (tile: number) => NationId | null,
      ): void;
    },
    ownerOf: (tile: number) => NationId | null,
  ): void {
    this.levels = new Map(entries.map((e) => [e.tile, e.level]));
    this.version++;
    people.setDead(new Map(entries.map((e) => [e.tile, e.dead])), ownerOf);
    this.shares = null;
  }

  levelAt(tile: number): number {
    return this.levels.get(tile) ?? 0;
  }

  // The owner of a contaminated tile changed: the shares are counted again.
  ownerChanged(tile: number): void {
    if (this.shares !== null && this.levels.has(tile)) this.shares = null;
  }

  // Mean contamination of a segment of a front (0 when clean).
  meanOf(tiles: readonly number[]): number {
    if (this.levels.size === 0 || tiles.length === 0) return 0;
    let sum = 0;
    for (const tile of tiles) sum += this.levels.get(tile) ?? 0;
    return sum / tiles.length;
  }

  // Share of each nation's land that is contaminated, weighted by the
  // people of its tiles (`weightOf`), over `totalOf` (its people or tiles).
  sharesOf(
    ownerOf: (tile: number) => NationId | null,
    weightOf: (tile: number) => number,
    totalOf: (nation: NationId) => number,
  ): ReadonlyMap<NationId, number> {
    if (this.shares !== null) return this.shares;
    const sums = new Map<NationId, number>();
    for (const [tile, level] of this.levels) {
      const owner = ownerOf(tile);
      if (owner === null) continue;
      sums.set(owner, (sums.get(owner) ?? 0) + level * weightOf(tile));
    }
    const shares = new Map<NationId, number>();
    for (const [nation, sum] of sums) {
      const total = totalOf(nation);
      if (total > 0) shares.set(nation, Math.min(1, sum / total));
    }
    this.shares = shares;
    return shares;
  }

  // The contaminated tiles and their levels, 0..255 (the map).
  packed(): { tiles: Uint32Array; levels: Uint8Array } {
    const entries = [...this.levels.entries()].sort((a, b) => a[0] - b[0]);
    return {
      tiles: Uint32Array.from(entries.map((e) => e[0])),
      levels: Uint8Array.from(entries.map((e) => Math.round(e[1] * 255))),
    };
  }
}
