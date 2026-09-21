// Seeded random number generator of the Véritable simulation (sfc32).
// Every random draw in src/veritable/ goes through an injected Rng; its state
// is part of the save file, so a reloaded campaign continues the same sequence.
// The global, unseeded generator is forbidden (ARCHITECTURE.md, invariant 5).

export type RngState = [number, number, number, number];

export class Rng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  constructor(seed: number) {
    // splitmix32 expansion of the seed into the four state words.
    let s = seed >>> 0;
    const split = (): number => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.a = split();
    this.b = split();
    this.c = split();
    this.d = 1;
    for (let i = 0; i < 12; i++) this.nextUint32();
  }

  static fromState(state: RngState): Rng {
    const rng = new Rng(0);
    rng.setState(state);
    return rng;
  }

  getState(): RngState {
    return [this.a, this.b, this.c, this.d];
  }

  setState(state: RngState): void {
    [this.a, this.b, this.c, this.d] = state.map((w) => w >>> 0);
  }

  nextUint32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = (this.b ^ (this.b >>> 9)) >>> 0;
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  // Uniform in [0, 1).
  next(): number {
    return this.nextUint32() / 0x100000000;
  }

  // Uniform integer in [min, max).
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min));
  }

  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  // Standard normal draw (Box-Muller; always consumes two draws).
  nextGaussian(): number {
    const u = 1 - this.next(); // (0, 1]
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // True with the given probability (0..1).
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick on an empty array");
    return items[this.nextInt(0, items.length)];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}
