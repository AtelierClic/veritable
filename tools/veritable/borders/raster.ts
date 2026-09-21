// Scanline polygon fill on a tile grid (even-odd rule, so holes just work when
// every ring of a polygon is passed together). A tile is inside when its
// centre (x + 0.5, y + 0.5) is inside.

export type Ring = ArrayLike<number>; // flat [x0, y0, x1, y1, ...] in tile coords

export function fillPolygon(
  rings: readonly Ring[],
  width: number,
  height: number,
  paint: (index: number) => void,
): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i += 2) {
      if (ring[i] < minY) minY = ring[i];
      if (ring[i] > maxY) maxY = ring[i];
    }
  }
  const y0 = Math.max(0, Math.floor(minY - 0.5));
  const y1 = Math.min(height - 1, Math.ceil(maxY - 0.5));
  if (y0 > y1) return;

  // Bucket edges by their first scanline to avoid scanning every edge per row.
  const rows = y1 - y0 + 1;
  const buckets: number[][] = Array.from({ length: rows }, () => []);
  const edges: number[] = []; // [xa, ya, xb, yb] with ya < yb
  for (const ring of rings) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      let xa = ring[2 * i];
      let ya = ring[2 * i + 1];
      let xb = ring[2 * j];
      let yb = ring[2 * j + 1];
      if (ya === yb) continue;
      if (ya > yb) [xa, ya, xb, yb] = [xb, yb, xa, ya];
      const first = Math.max(y0, Math.ceil(ya - 0.5));
      const last = Math.min(y1, Math.ceil(yb - 0.5) - 1);
      if (first > last) continue;
      buckets[first - y0].push(edges.length);
      edges.push(xa, ya, xb, yb, last);
    }
  }

  let active: number[] = [];
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    active = active.filter((e) => edges[e + 4] >= y);
    for (const e of buckets[y - y0]) active.push(e);
    xs.length = 0;
    for (const e of active) {
      const xa = edges[e];
      const ya = edges[e + 1];
      xs.push(xa + ((cy - ya) * (edges[e + 2] - xa)) / (edges[e + 3] - ya));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(width - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      const base = y * width;
      for (let x = from; x <= to; x++) paint(base + x);
    }
  }
}
