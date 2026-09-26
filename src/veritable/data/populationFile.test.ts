import {
  decodePopulation,
  encodePopulation,
  levelOf,
  peopleOf,
  PopulationFormatError,
} from "./populationFile";

describe("population grid file (J7)", () => {
  it("gives back every level, sea runs and land alike", () => {
    const width = 7;
    const height = 5;
    const levels = new Uint8Array(width * height);
    levels.set([0, 0, 12, 200, 0, 1, 255], 0);
    levels.set([9, 9, 9], 20);
    levels[width * height - 1] = 42;
    const bytes = encodePopulation({ width, height, steps: 8, levels });
    const back = decodePopulation(bytes);
    expect(back.width).toBe(width);
    expect(back.height).toBe(height);
    expect(back.steps).toBe(8);
    expect(Array.from(back.levels)).toEqual(Array.from(levels));
  });

  it("stores a sea of zeros in a few bytes", () => {
    const levels = new Uint8Array(1_000_000);
    levels[500_000] = 3;
    const bytes = encodePopulation({
      width: 1000,
      height: 1000,
      steps: 8,
      levels,
    });
    expect(bytes.length).toBeLessThan(40);
    expect(decodePopulation(bytes).levels[500_000]).toBe(3);
  });

  it("quantises people within half a step", () => {
    for (const people of [1, 10, 1234, 98_765, 3_500_000]) {
      const back = peopleOf(levelOf(people, 8), 8);
      expect(Math.abs(Math.log2(1 + back) - Math.log2(1 + people))).toBeLessThanOrEqual(
        1 / 16 + 1e-9,
      );
    }
    expect(levelOf(0, 8)).toBe(0);
    expect(peopleOf(0, 8)).toBe(0);
  });

  it("refuses what is not a population file", () => {
    expect(() => decodePopulation(new Uint8Array(20))).toThrow(
      PopulationFormatError,
    );
  });
});
