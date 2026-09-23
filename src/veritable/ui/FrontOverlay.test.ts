import { SegmentView } from "../sim/VeritableSim";
import { segmentStyle } from "./FrontOverlay";

function segment(attacker: string | null, attackRatio: number): SegmentView {
  return {
    index: 0,
    tiles: 200,
    terrain: { plains: 1, highland: 0, mountain: 0 },
    sides: {},
    ratio: 1,
    attacker,
    attackRatio,
    movedTo: null,
  };
}

const front = { id: "AAA|BBB", a: "AAA", b: "BBB", segments: [] };

describe("colour of a front segment on the map (J5)", () => {
  it("is quiet and dashed when nobody attacks", () => {
    const style = segmentStyle(front, segment(null, 0), "AAA", 1.2);
    expect(style.dashed).toBe(true);
  });

  it("tells the player who advances, and a wider margin draws a wider line", () => {
    const mine = segmentStyle(front, segment("AAA", 2), "AAA", 1.2);
    const theirs = segmentStyle(front, segment("BBB", 2), "AAA", 1.2);
    const contained = segmentStyle(front, segment("AAA", 1.1), "AAA", 1.2);
    const crushing = segmentStyle(front, segment("AAA", 3), "AAA", 1.2);
    expect(new Set([mine.color, theirs.color, contained.color]).size).toBe(3);
    expect(crushing.width).toBeGreaterThan(mine.width);
    expect(mine.width).toBeGreaterThan(contained.width);
  });

  it("colours a front between two other nations by the side that advances", () => {
    const a = segmentStyle(front, segment("AAA", 2), "CCC", 1.2);
    const b = segmentStyle(front, segment("BBB", 2), "CCC", 1.2);
    const stalled = segmentStyle(front, segment("BBB", 1), "CCC", 1.2);
    expect(a.color).not.toBe(b.color);
    expect(stalled.dashed).toBe(false);
  });
});
