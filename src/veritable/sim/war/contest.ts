import { NationId } from "../../data/schemas/common";
import { TILE_CONTESTED_BIT, TILE_NATION_MASK } from "../../data/schemas/save";

// Contest of each tile (J5). A tile taken by war is contested: it is worth a
// share of an average tile until its contest settles, 5 years after a
// cession by treaty or 10 years after its last capture without one (the
// durations are config.war.contest). Each world keeps one ledger; the
// simulation sets its month and asks it to settle once a month.
//
// Encoding, one u16 per tile (also the second tile block of a v5 save):
//   0                     not contested
//   bits 0-14             month of the last capture, counted from the start
//                         of the campaign, + 1
//   bit 15                ceded by treaty (the month is then the treaty's)

export const CONTEST_CEDED_BIT = 1 << 15;
const MONTH_MASK = 0x7fff;

// Months elapsed from the start date to a date (calendar months).
export function monthIndex(startDate: string, date: string): number {
  const [y0, m0] = startDate.split("-").map(Number);
  const [y, m] = date.split("-").map(Number);
  return (y - y0) * 12 + (m - m0);
}

export class ContestLedger {
  private month = 0;
  // Bumped at every change: readers cache what they derive from the ledger.
  private changes = 0;
  readonly values: Uint16Array;
  // The tiles under contest (J6c): the monthly settle, the counts and the
  // overlay walk them instead of the 8 million tiles of the world map.
  private readonly contested = new Set<number>();

  constructor(size: number) {
    this.values = new Uint16Array(size);
  }

  setMonth(month: number): void {
    this.month = Math.max(0, Math.min(MONTH_MASK - 1, month));
  }

  currentMonth(): number {
    return this.month;
  }

  version(): number {
    return this.changes;
  }

  // A tile changes hands in a war (or a landing, an annexation).
  mark(tile: number): void {
    this.values[tile] = this.month + 1;
    this.contested.add(tile);
    this.changes++;
  }

  clear(tile: number): void {
    if (this.values[tile] !== 0) this.changes++;
    this.values[tile] = 0;
    this.contested.delete(tile);
  }

  isContested(tile: number): boolean {
    return this.values[tile] !== 0;
  }

  // A treaty cedes to `owns` its contested tiles: their clock restarts at
  // the treaty, with the (shorter) cession delay.
  cede(owns: (tile: number) => boolean): number {
    let ceded = 0;
    for (const tile of this.contested) {
      if (!owns(tile)) continue;
      this.values[tile] = (this.month + 1) | CONTEST_CEDED_BIT;
      ceded++;
    }
    if (ceded > 0) this.changes++;
    return ceded;
  }

  // Contests old enough (or on land nobody holds any more) end.
  settle(
    warMonths: number,
    cessionMonths: number,
    owned: (tile: number) => boolean,
  ): number {
    let cleared = 0;
    for (const tile of this.contested) {
      const value = this.values[tile];
      const since = (value & MONTH_MASK) - 1;
      const limit =
        (value & CONTEST_CEDED_BIT) !== 0 ? cessionMonths : warMonths;
      if (!owned(tile) || this.month - since >= limit) {
        this.values[tile] = 0;
        this.contested.delete(tile); // safe while iterating a Set
        cleared++;
      }
    }
    if (cleared > 0) this.changes++;
    return cleared;
  }

  counts(ownerOf: (tile: number) => NationId | null): Map<NationId, number> {
    const counts = new Map<NationId, number>();
    for (const tile of this.contested) {
      const owner = ownerOf(tile);
      if (owner !== null) counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    return counts;
  }

  // Tile indices under contest (for the map overlay).
  tiles(): Uint32Array {
    return Uint32Array.from(this.contested).sort();
  }

  copy(): Uint16Array {
    return this.values.slice();
  }

  // From a saved grid: the contest block when there is one, else the
  // contested bit of the tiles (v4 and older), dated from the current month.
  load(tiles: Uint16Array, contest: Uint16Array | undefined): void {
    this.changes++;
    this.contested.clear();
    for (let tile = 0; tile < this.values.length; tile++) {
      const owned = (tiles[tile] & TILE_NATION_MASK) !== 0;
      if (!owned) {
        this.values[tile] = 0;
      } else if (contest !== undefined) {
        this.values[tile] = contest[tile];
      } else {
        this.values[tile] =
          (tiles[tile] & TILE_CONTESTED_BIT) !== 0 ? this.month + 1 : 0;
      }
      if (this.values[tile] !== 0) this.contested.add(tile);
    }
  }
}
