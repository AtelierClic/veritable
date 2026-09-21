import { Rng } from "./rng";

const draw = (rng: Rng, n: number) =>
  Array.from({ length: n }, () => rng.nextUint32());

describe("Rng", () => {
  it("gives the same sequence for the same seed", () => {
    expect(draw(new Rng(42), 50)).toEqual(draw(new Rng(42), 50));
  });

  it("gives different sequences for different seeds", () => {
    expect(draw(new Rng(42), 10)).not.toEqual(draw(new Rng(43), 10));
  });

  it("continues the same sequence after a state restore", () => {
    const rng = new Rng(2026);
    draw(rng, 137);
    const state = rng.getState();
    const expected = draw(rng, 100);

    expect(draw(Rng.fromState(state), 100)).toEqual(expected);

    // The state survives a JSON round trip (four uint32 words).
    const revived = Rng.fromState(JSON.parse(JSON.stringify(state)));
    expect(draw(revived, 100)).toEqual(expected);
  });

  it("keeps state words in uint32 range", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      rng.nextUint32();
      for (const w of rng.getState()) {
        expect(Number.isInteger(w) && w >= 0 && w <= 0xffffffff).toBe(true);
      }
    }
  });

  it("stays within bounds and looks uniform", () => {
    const rng = new Rng(1);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 20000; i++) {
      const f = rng.next();
      expect(f >= 0 && f < 1).toBe(true);
      buckets[rng.nextInt(0, 10)]++;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(1700);
      expect(count).toBeLessThan(2300);
    }
  });

  it("shuffle is a permutation and leaves the input untouched", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = new Rng(3).shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort((x, y) => x - y)).toEqual(input);
  });

  it("src/veritable never calls Math.random", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const root = path.resolve(__dirname, "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          entry.name.endsWith(".ts") &&
          !entry.name.endsWith(".test.ts")
        ) {
          const code = fs.readFileSync(full, "utf8");
          if (/Math\s*\.\s*random\s*\(/.test(code)) offenders.push(full);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
