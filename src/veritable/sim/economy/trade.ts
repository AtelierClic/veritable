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

export function allocateFlows(
  traders: readonly Trader[],
  // Multiplier of the pair (exporter, importer): distance, blocs, agreements.
  // 0 = no trade possible (embargo, not neighbours).
  affinity: (exporter: string, importer: string) => number,
  passes: number,
): FlowResult {
  const exporters = traders.filter((t) => t.surplus > 0);
  const importers = traders.filter((t) => t.deficit > 0);
  const stock = new Map(exporters.map((e) => [e.id, e.surplus]));
  const need = new Map(importers.map((i) => [i.id, i.deficit]));
  const delivered = new Map<string, Map<string, number>>(
    exporters.map((e) => [e.id, new Map()]),
  );

  for (let pass = 0; pass < passes; pass++) {
    // 1. Every importer asks.
    const asked = new Map<string, Map<string, number>>(); // e -> i -> volume
    for (const importer of importers) {
      const wanted = need.get(importer.id)!;
      if (wanted <= 1e-12) continue;
      let totalWeight = 0;
      const weights: [string, number][] = [];
      for (const exporter of exporters) {
        const left = stock.get(exporter.id)!;
        if (left <= 1e-12) continue;
        const w = left * affinity(exporter.id, importer.id);
        if (w <= 0) continue;
        weights.push([exporter.id, w]);
        totalWeight += w;
      }
      for (const [exporterId, w] of weights) {
        if (!asked.has(exporterId)) asked.set(exporterId, new Map());
        asked.get(exporterId)!.set(importer.id, (wanted * w) / totalWeight);
      }
    }
    if (asked.size === 0) break;
    // 2. Every exporter serves, pro rata when oversubscribed.
    for (const [exporterId, requests] of asked) {
      const left = stock.get(exporterId)!;
      let total = 0;
      for (const v of requests.values()) total += v;
      const ratio = total > left ? left / total : 1;
      for (const [importerId, volume] of requests) {
        const served = volume * ratio;
        const row = delivered.get(exporterId)!;
        row.set(importerId, (row.get(importerId) ?? 0) + served);
        need.set(importerId, need.get(importerId)! - served);
      }
      stock.set(exporterId, left - Math.min(left, total));
    }
  }

  const received = new Map<string, number>();
  const shipped = new Map<string, number>();
  for (const [exporterId, row] of delivered) {
    let sum = 0;
    for (const [importerId, v] of row) {
      sum += v;
      received.set(importerId, (received.get(importerId) ?? 0) + v);
    }
    shipped.set(exporterId, sum);
  }
  return { delivered, received, shipped, unsold: stock };
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
