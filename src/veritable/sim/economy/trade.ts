// Bilateral flows of ONE good for one month.
//
// Each participant has a surplus X (exporter) or a deficit M (importer).
// Weight of exporter e for importer i:
//
//   w(e, i) = X_e x exp(-distance(e, i) / D0) x blocBonus x agreementBonus
//             x (embargo ? 0 : 1)
//
// Every importer spreads its deficit over the exporters in proportion to the
// weights. An exporter asked for more than it has serves everyone pro rata;
// what importers did not get is asked again, to the exporters that still have
// something, for a fixed number of passes. Coverage = obtained / needed.
//
// J6c: the participants are indices and the pairs flat arrays (M x M,
// exporter-major): at 208 nations the maps and string keys of the J2 cost
// several hundred milliseconds a month.

export interface Trader {
  id: string;
  surplus: number; // per year; 0 for an importer
  deficit: number; // per year; 0 for an exporter
}

export interface FlowResult {
  // delivered[e][i] = volume from exporter e to importer i
  delivered: Map<string, Map<string, number>>;
  received: Map<string, number>; // by importer
  shipped: Map<string, number>; // by exporter
  unsold: Map<string, number>; // surplus left to each exporter
}

export interface IndexedFlows {
  delivered: Float64Array; // M x M, exporter-major
  received: Float64Array; // by importer
  shipped: Float64Array; // by exporter
  unsold: Float64Array; // surplus left to each exporter
}

// Arrays of an allocation, reused from one good to the next (J6c: a month
// of trade at 208 nations allocated megabytes of them).
export interface FlowBuffers extends IndexedFlows {
  asked: Float64Array;
  askedBy: Uint8Array;
}

export function flowBuffers(m: number): FlowBuffers {
  return {
    delivered: new Float64Array(m * m),
    received: new Float64Array(m),
    shipped: new Float64Array(m),
    unsold: new Float64Array(m),
    asked: new Float64Array(m * m),
    askedBy: new Uint8Array(m),
  };
}

// The allocation on indices. `affinity[e * M + i]` is the multiplier of the
// pair (distance, blocs, agreements), 0 when no trade is possible (not
// neighbours, the same participant); `blocked[e * M + i]` is 1 for an
// embargoed pair. The result lives in `buffers` until the next call.
export function allocateFlowsIndexed(
  surplus: Float64Array,
  deficit: Float64Array,
  affinity: Float64Array,
  passes: number,
  blocked: Uint8Array | undefined = undefined,
  buffers: FlowBuffers = flowBuffers(surplus.length),
): IndexedFlows {
  const m = surplus.length;
  const exporters: number[] = [];
  const importers: number[] = [];
  for (let k = 0; k < m; k++) {
    if (surplus[k] > 0) exporters.push(k);
    if (deficit[k] > 0) importers.push(k);
  }
  const { delivered, asked, askedBy } = buffers;
  const stock = buffers.unsold;
  stock.fill(0);
  for (const e of exporters) stock[e] = surplus[e];
  const need = new Float64Array(m);
  for (const i of importers) need[i] = deficit[i];
  delivered.fill(0);
  asked.fill(0);

  for (let pass = 0; pass < passes; pass++) {
    // 1. Every importer asks.
    let any = false;
    askedBy.fill(0);
    for (const i of importers) {
      const wanted = need[i];
      if (wanted <= 1e-12) continue;
      let totalWeight = 0;
      for (const e of exporters) {
        const left = stock[e];
        if (left <= 1e-12) continue;
        if (blocked !== undefined && blocked[e * m + i] === 1) continue;
        const w = left * affinity[e * m + i];
        if (w <= 0) continue;
        totalWeight += w;
      }
      if (totalWeight <= 0) continue;
      for (const e of exporters) {
        const left = stock[e];
        if (left <= 1e-12) continue;
        if (blocked !== undefined && blocked[e * m + i] === 1) continue;
        const w = left * affinity[e * m + i];
        if (w <= 0) continue;
        asked[e * m + i] = (wanted * w) / totalWeight;
        askedBy[e] = 1;
        any = true;
      }
    }
    if (!any) break;
    // 2. Every exporter serves, pro rata when oversubscribed.
    for (const e of exporters) {
      if (askedBy[e] === 0) continue;
      const left = stock[e];
      const row = e * m;
      let total = 0;
      for (const i of importers) total += asked[row + i];
      const ratio = total > left ? left / total : 1;
      for (const i of importers) {
        const volume = asked[row + i];
        if (volume === 0) continue;
        const served = volume * ratio;
        delivered[row + i] += served;
        need[i] -= served;
        asked[row + i] = 0;
      }
      stock[e] = left - Math.min(left, total);
    }
  }

  const { received, shipped } = buffers;
  received.fill(0);
  shipped.fill(0);
  for (const e of exporters) {
    const row = e * m;
    let sum = 0;
    for (const i of importers) {
      const v = delivered[row + i];
      if (v === 0) continue;
      sum += v;
      received[i] += v;
    }
    shipped[e] = sum;
  }
  return { delivered, received, shipped, unsold: stock };
}

// The allocation on named traders (the J2 interface, kept for the tests and
// for callers outside the monthly step).
export function allocateFlows(
  traders: readonly Trader[],
  // Multiplier of the pair (exporter, importer): distance, blocs, agreements.
  // 0 = no trade possible (embargo, not neighbours).
  affinity: (exporter: string, importer: string) => number,
  passes: number,
): FlowResult {
  const m = traders.length;
  const surplus = new Float64Array(m);
  const deficit = new Float64Array(m);
  const pairs = new Float64Array(m * m);
  traders.forEach((t, k) => {
    surplus[k] = t.surplus;
    deficit[k] = t.deficit;
  });
  for (let e = 0; e < m; e++) {
    if (surplus[e] <= 0) continue;
    for (let i = 0; i < m; i++) {
      if (deficit[i] > 0 && i !== e) {
        pairs[e * m + i] = affinity(traders[e].id, traders[i].id);
      }
    }
  }
  const flows = allocateFlowsIndexed(surplus, deficit, pairs, passes);
  const delivered = new Map<string, Map<string, number>>();
  const received = new Map<string, number>();
  const shipped = new Map<string, number>();
  const unsold = new Map<string, number>();
  traders.forEach((t, e) => {
    if (surplus[e] <= 0) return;
    const row = new Map<string, number>();
    for (let i = 0; i < m; i++) {
      const v = flows.delivered[e * m + i];
      if (v > 0) row.set(traders[i].id, v);
    }
    delivered.set(t.id, row);
    shipped.set(t.id, flows.shipped[e]);
    unsold.set(t.id, flows.unsold[e]);
  });
  traders.forEach((t, i) => {
    if (flows.received[i] > 0) received.set(t.id, flows.received[i]);
  });
  return { delivered, received, shipped, unsold };
}

const EARTH_RADIUS_KM = 6371;

// Great-circle distance between two points given in degrees.
export function greatCircleKm(
  lonA: number,
  latA: number,
  lonB: number,
  latB: number,
): number {
  const rad = Math.PI / 180;
  const dLat = (latB - latA) * rad;
  const dLon = (lonB - lonA) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA * rad) * Math.cos(latB * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
