import { Division } from "../data/schemas/save";
import { divisionsFor } from "./mapMenu";

// J7b: how many divisions "Attaquer ici" and "Percer vers ce point" send to
// the segment of the click, and from where.
function division(
  id: number,
  front: string | null,
  segment: number | null,
): Division {
  return {
    id,
    template: "infantry",
    men: 15_000,
    equipment: 1,
    training: 1,
    front,
    segment,
    posture: "defend",
  };
}

describe("the divisions the action menu sends to a segment (J7b)", () => {
  const F = "AAA|BBB";

  it("takes the reserve first, no more than the segment supplies", () => {
    const army = [
      division(1, null, null),
      division(2, null, null),
      division(3, null, null),
      division(4, F, 0),
    ];
    expect(divisionsFor(army, F, 1, 2)).toEqual({
      ids: [1, 2],
      from: "reserve",
    });
    expect(divisionsFor(army, F, 1, 10)).toEqual({
      ids: [1, 2, 3],
      from: "reserve",
    });
  });

  it("then the divisions held for the whole front, then half of the most staffed segment", () => {
    const pool = [division(1, F, null), division(2, F, 0)];
    expect(divisionsFor(pool, F, 1, 5)).toEqual({ ids: [1], from: "front" });
    const spread = [
      division(1, F, 0),
      division(2, F, 0),
      division(3, F, 0),
      division(4, F, 0),
      division(5, F, 2),
      division(6, F, 2),
      division(7, F, 1),
    ];
    expect(divisionsFor(spread, F, 1, 5)).toEqual({ ids: [1, 2], from: 0 });
    expect(divisionsFor(spread, F, 1, 1)).toEqual({ ids: [1], from: 0 });
    // A lone division is not taken from its segment.
    expect(divisionsFor([division(1, F, 0)], F, 1, 5)).toEqual({
      ids: [],
      from: null,
    });
  });

  it("sends nothing to a segment already at its supply capacity", () => {
    const army = [division(1, null, null)];
    expect(divisionsFor(army, F, 1, 0)).toEqual({ ids: [], from: "full" });
  });
});
