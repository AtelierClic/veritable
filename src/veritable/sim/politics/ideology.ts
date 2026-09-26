import { LawWindow } from "../../data/schemas/laws";
import { IDEOLOGY_AXES, Ideology } from "../../data/schemas/politics";

// Ideological geometry (J4): three axes in [-1, 1].

// Euclidean distance between two ideologies; at most MAX_DISTANCE.
export function ideologyDistance(a: Ideology, b: Ideology): number {
  let sum = 0;
  for (const axis of IDEOLOGY_AXES) sum += (a[axis] - b[axis]) ** 2;
  return Math.sqrt(sum);
}
export const MAX_IDEOLOGY_DISTANCE = Math.sqrt(3 * 2 ** 2);

// Affinity of a group for a party: exp(-d^2 / sigma^2) x (1 + charisma).
export function affinity(
  group: Ideology,
  party: Ideology,
  charisma: number,
  sigma: number,
): number {
  const d = ideologyDistance(group, party);
  return Math.exp(-(d * d) / (sigma * sigma)) * (1 + charisma);
}

// Weighted mean of ideologies (weights need not sum to 1).
export function meanIdeology(
  items: readonly { ideology: Ideology; weight: number }[],
): Ideology {
  const out: Ideology = { economic: 0, authority: 0, sovereignty: 0 };
  let total = 0;
  for (const item of items) total += item.weight;
  if (total <= 0) return out;
  for (const item of items) {
    for (const axis of IDEOLOGY_AXES) {
      out[axis] += (item.ideology[axis] * item.weight) / total;
    }
  }
  return out;
}

export function insideWindow(window: LawWindow, ideology: Ideology): boolean {
  return IDEOLOGY_AXES.every(
    (axis) =>
      ideology[axis] >= window[axis][0] && ideology[axis] <= window[axis][1],
  );
}

// How far an ideology stands outside a window (0 inside): the sum over the
// axes of the distance to the nearest bound (J7, the choice of a
// government that finds no option inside its window).
export function windowDistance(window: LawWindow, ideology: Ideology): number {
  let d = 0;
  for (const axis of IDEOLOGY_AXES) {
    const [lo, hi] = window[axis];
    d += Math.max(0, lo - ideology[axis], ideology[axis] - hi);
  }
  return d;
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const clampAxis = (v: number) => Math.max(-1, Math.min(1, v));
