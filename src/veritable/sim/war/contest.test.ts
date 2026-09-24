import { TILE_CONTESTED_BIT, TILE_NATION_MASK } from "../../data/schemas/save";
import { CONTEST_CEDED_BIT, ContestLedger, monthIndex } from "./contest";

describe("contest of the tiles (J5)", () => {
  it("counts calendar months from the start of the campaign", () => {
    expect(monthIndex("2026-01-01", "2026-01-31")).toBe(0);
    expect(monthIndex("2026-01-01", "2026-02-01")).toBe(1);
    expect(monthIndex("2026-01-01", "2031-01-01")).toBe(60);
  });

  it("a tile taken in war stays contested ten years after its last capture", () => {
    const ledger = new ContestLedger(4);
    const owned = () => true;
    ledger.setMonth(3);
    ledger.mark(0);
    ledger.setMonth(10);
    ledger.mark(1); // taken later
    ledger.setMonth(3 + 119);
    expect(ledger.settle(120, 60, owned)).toBe(0);
    ledger.setMonth(3 + 120);
    expect(ledger.settle(120, 60, owned)).toBe(1);
    expect(ledger.isContested(0)).toBe(false);
    expect(ledger.isContested(1)).toBe(true);
    // Taken back and forth: the clock restarts at the last capture.
    ledger.mark(1);
    ledger.setMonth(10 + 120);
    expect(ledger.settle(120, 60, owned)).toBe(0);
  });

  it("a treaty cedes the contested tiles of the winner: five years from the treaty", () => {
    const ledger = new ContestLedger(3);
    ledger.setMonth(2);
    ledger.mark(0);
    ledger.mark(1);
    ledger.mark(2);
    const owner = ["W", "W", "L"];
    ledger.setMonth(12);
    expect(ledger.cede((t) => owner[t] === "W")).toBe(2);
    expect(ledger.values[0] & CONTEST_CEDED_BIT).not.toBe(0);
    expect(ledger.values[2] & CONTEST_CEDED_BIT).toBe(0);
    ledger.setMonth(12 + 59);
    expect(ledger.settle(120, 60, () => true)).toBe(0);
    ledger.setMonth(12 + 60);
    expect(ledger.settle(120, 60, () => true)).toBe(2);
    expect(ledger.isContested(2)).toBe(true);
    expect(Object.fromEntries(ledger.counts((t) => owner[t]))).toEqual({
      L: 1,
    });
  });

  it("land nobody holds is no longer contested", () => {
    const ledger = new ContestLedger(2);
    ledger.mark(0);
    ledger.mark(1);
    expect(ledger.settle(120, 60, (t) => t === 0)).toBe(1);
    expect([...ledger.tiles()]).toEqual([0]);
  });

  it("loads the contest block of a v5 save, or dates the contested bit of an older one from the current month", () => {
    const tiles = new Uint16Array([1 | TILE_CONTESTED_BIT, 2, 0]);
    const ledger = new ContestLedger(3);
    ledger.setMonth(7);
    ledger.load(tiles, undefined);
    expect([...ledger.values]).toEqual([8, 0, 0]);
    const contest = new Uint16Array([5 | CONTEST_CEDED_BIT, 3, 9]);
    ledger.load(tiles, contest);
    // Unowned land (tile 2) never keeps a contest.
    expect([...ledger.values]).toEqual([5 | CONTEST_CEDED_BIT, 3, 0]);
    expect(tiles[0] & TILE_NATION_MASK).toBe(1);
  });
});
