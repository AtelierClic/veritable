import { NationId } from "../../data/schemas/common";
import { Rng } from "../rng";
import { ClaimTiles, ClaimTilesInput } from "./claimTiles";

// J6c: a world that reports every change of owner keeps the claim counts
// up to date tile by tile; they must equal a full count at every moment.

const SIZE = 400;
const NATIONS: NationId[] = ["AAA", "BBB", "CCC"];

function input(): ClaimTilesInput {
  const firstDay = new Uint16Array(SIZE);
  for (let tile = 0; tile < SIZE; tile++) {
    // A strip of sea (0) between three homelands.
    firstDay[tile] = tile % 20 === 0 ? 0 : 1 + Math.floor(tile / 134);
  }
  const regions = new Map<string, Uint32Array>([
    ["north", Uint32Array.from({ length: 100 }, (_, k) => k + 50)],
    ["overlap", Uint32Array.from({ length: 60 }, (_, k) => k + 120)],
  ]);
  return { regions, firstDay, nations: NATIONS };
}

function counts(
  claims: ClaimTiles,
  nationAt: (tile: number) => NationId | null,
) {
  const out: Record<string, Record<string, number>> = {};
  for (const region of [
    "homeland:AAA",
    "homeland:BBB",
    "homeland:CCC",
    "north",
    "overlap",
  ]) {
    out[region] = Object.fromEntries(
      [...claims.holders(region, "k", nationAt)].sort(),
    );
  }
  return out;
}

describe("claim tiles counted live (J6c)", () => {
  it("equal a full count after every change of owner and every treaty", () => {
    const owners: (NationId | null)[] = [];
    const data = input();
    for (let tile = 0; tile < SIZE; tile++) {
      const first = data.firstDay[tile];
      owners.push(first === 0 ? null : NATIONS[first - 1]);
    }
    const nationAt = (tile: number) => owners[tile];
    const live = new ClaimTiles(SIZE, data);
    live.track();
    counts(live, nationAt); // the first full count
    const rng = new Rng(7);
    for (let step = 0; step < 2000; step++) {
      const tile = rng.nextInt(0, SIZE);
      const from = owners[tile];
      const roll = rng.nextInt(0, 4);
      const to = roll === 3 ? null : NATIONS[roll];
      owners[tile] = to;
      live.ownerChanged(tile, from, to);
      if (step % 500 === 499) {
        live.settle("AAA", "BBB", ["north"], nationAt);
      }
      if (step % 97 === 0) {
        // A world without the listener counts everything each time: the
        // same settled tiles, a key that never matches.
        const full = new ClaimTiles(SIZE, data);
        const settled = new Uint16Array(SIZE);
        live.write(settled);
        full.load(settled);
        expect(counts(live, nationAt)).toEqual(counts(full, nationAt));
      }
    }
  });

  it("count again from the tiles after a load", () => {
    const data = input();
    const owners = Array.from({ length: SIZE }, () => "CCC" as NationId);
    const live = new ClaimTiles(SIZE, data);
    live.track();
    expect(live.holders("north", "k", (t) => owners[t]).get("CCC")).toBe(100);
    owners.fill("AAA");
    live.load(new Uint16Array(SIZE)); // a restore: no report of the changes
    expect(live.holders("north", "k", (t) => owners[t]).get("AAA")).toBe(100);
  });
});
