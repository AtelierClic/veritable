import { NationId } from "../../data/schemas/common";

// The people of the tiles (J7b): how many people each tile of the map holds
// (the population grid of the scenario, GHS-POP), the people each nation
// holds, and what changed hands since the simulation last took it — a
// capture, a landing, an annexation carry their share of the population and
// the production of the nation that loses them (sim: VeritableSimImpl
// applyOccupation), and the capitals and cities taken count in the war
// score. Kept by each world as owners change, like the claims; nothing of it
// is saved: the tiles of a save say who holds what. Without a grid (the
// test worlds, a scenario without one) it is off: nothing moves, the war
// score counts tiles as it did until the J7a.

export interface PeopleInput {
  // People of each tile (0: water and empty land), in the units of the
  // grid; the simulation scales them to the population of each nation.
  people: Float32Array;
  // The capitals and cities of the scenario, by tile.
  cities: readonly { tile: number; capital: boolean }[];
}

export interface PeopleMove {
  from: NationId;
  to: NationId;
  people: number; // grid units
}

export interface CityMove {
  tile: number;
  from: NationId;
  to: NationId;
  capital: boolean;
}

export interface Occupations {
  moves: PeopleMove[];
  cities: CityMove[];
}

const NOTHING: Occupations = { moves: [], cities: [] };

export class PeopleTiles {
  private live: Map<NationId, number> | null = null;
  private moves = new Map<string, PeopleMove>();
  private cityMoves: CityMove[] = [];
  private readonly cityTiles = new Map<number, boolean>();

  constructor(
    size: number,
    private readonly input: PeopleInput | null,
  ) {
    if (input !== null && input.people.length !== size) {
      throw new Error("population grid does not match the map");
    }
    for (const city of input?.cities ?? []) {
      this.cityTiles.set(city.tile, city.capital);
    }
  }

  // The world has a population grid.
  known(): boolean {
    return this.input !== null;
  }

  peopleAt(tile: number): number {
    return this.input?.people[tile] ?? 0;
  }

  // A load or the first day is no occupation: counts and moves forgotten,
  // counted again by prime() once the tiles are in place.
  load(): void {
    this.live = null;
    this.moves.clear();
    this.cityMoves = [];
  }

  prime(nationAt: (tile: number) => NationId | null): void {
    if (this.input === null) return;
    const live = new Map<NationId, number>();
    const people = this.input.people;
    for (let tile = 0; tile < people.length; tile++) {
      const p = people[tile];
      if (p <= 0) continue;
      const owner = nationAt(tile);
      if (owner === null) continue;
      live.set(owner, (live.get(owner) ?? 0) + p);
    }
    this.live = live;
  }

  ownerChanged(tile: number, from: NationId | null, to: NationId | null): void {
    if (this.live === null || from === to) return;
    const capital = this.cityTiles.get(tile);
    if (capital !== undefined && from !== null && to !== null) {
      this.cityMoves.push({ tile, from, to, capital });
    }
    const p = this.input!.people[tile];
    if (p <= 0) return;
    if (from !== null) this.live.set(from, (this.live.get(from) ?? 0) - p);
    if (to !== null) this.live.set(to, (this.live.get(to) ?? 0) + p);
    if (from === null || to === null) return;
    const key = `${from}>${to}`;
    const move = this.moves.get(key);
    if (move === undefined) this.moves.set(key, { from, to, people: p });
    else move.people += p;
  }

  // People each nation holds now (grid units); empty without a grid.
  holdings(): ReadonlyMap<NationId, number> {
    return this.live ?? new Map();
  }

  // What changed hands since the last call, in a stable order.
  take(): Occupations {
    if (this.moves.size === 0 && this.cityMoves.length === 0) return NOTHING;
    const moves = [...this.moves.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([, m]) => m);
    const cities = this.cityMoves;
    this.moves.clear();
    this.cityMoves = [];
    return { moves, cities };
  }

  // Tiles above the urban threshold defend better (J7b).
  isUrban(tile: number, threshold: number): boolean {
    return this.input !== null && this.input.people[tile] >= threshold;
  }
}
