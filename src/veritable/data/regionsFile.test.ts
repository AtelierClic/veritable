import { describe, expect, it } from "vitest";
import {
  decodeRegions,
  encodeRegions,
  RegionsFormatError,
} from "./regionsFile";

describe("regions file", () => {
  it("round-trips overlapping regions, empty ones and large gaps", () => {
    const regions = new Map<string, Uint32Array>([
      ["crimea", Uint32Array.from([3, 4, 5, 900, 70_000])],
      ["oblasts", Uint32Array.from([4, 5, 6])],
      ["empty", new Uint32Array(0)],
    ]);
    const bytes = encodeRegions({ width: 400, height: 200, regions });
    const back = decodeRegions(bytes);
    expect(back.width).toBe(400);
    expect(back.height).toBe(200);
    expect([...back.regions.keys()]).toEqual(["crimea", "oblasts", "empty"]);
    for (const [id, tiles] of regions) {
      expect(Array.from(back.regions.get(id)!)).toEqual(Array.from(tiles));
    }
    expect(encodeRegions(back)).toEqual(bytes);
  });

  it("refuses unsorted tiles, tiles off the grid and corrupt files", () => {
    expect(() =>
      encodeRegions({
        width: 10,
        height: 10,
        regions: new Map([["a", Uint32Array.from([5, 5])]]),
      }),
    ).toThrow(RegionsFormatError);
    expect(() =>
      encodeRegions({
        width: 10,
        height: 10,
        regions: new Map([["a", Uint32Array.from([100])]]),
      }),
    ).toThrow(RegionsFormatError);
    const bytes = encodeRegions({
      width: 10,
      height: 10,
      regions: new Map([["a", Uint32Array.from([1, 2, 3])]]),
    });
    expect(() => decodeRegions(bytes.subarray(0, bytes.length - 1))).toThrow(
      RegionsFormatError,
    );
    const bad = bytes.slice();
    bad[0] = 0;
    expect(() => decodeRegions(bad)).toThrow(RegionsFormatError);
  });
});
