import { NationId } from "../../data/schemas/common";

// The place of a border (J7, the journal): walking the straight line from
// the capital of `a` to that of `b`, the first tile of `b` met right after a
// tile of `a`; the capital of `b` when the line crosses no common border (a
// sea, a third nation between them).
export function borderAlong(
  width: number,
  from: number,
  to: number,
  ownerOf: (tile: number) => NationId | null,
  a: NationId,
  b: NationId,
): number {
  const x0 = from % width;
  const y0 = Math.floor(from / width);
  const x1 = to % width;
  const y1 = Math.floor(to / width);
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  let previous: NationId | null = null;
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const tile = y * width + x;
    const owner = ownerOf(tile);
    if (owner === b && previous === a) return tile;
    previous = owner;
  }
  return to;
}
