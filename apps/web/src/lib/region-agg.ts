import type { RegionStat } from "~/lib/api-types";
import { DELAY_THRESHOLD } from "~/lib/thresholds";
import { resolveRegion, regionName } from "~/lib/regions";

export interface PerRunRegion {
  lastDelay: number | null;
  regionId: number | null;
  stationCode: string | null;
}

/** Aggregate per-run delays into RegionStat[] sorted by total delay.
 * Excludes unknown regions (NULL) and the elencoStazioni/0 "principali"
 * bucket (resolveRegion maps 0 → null): they stay in national totals only.
 */
export function aggregateByRegion(rows: PerRunRegion[]): RegionStat[] {
  const byRegion = new Map<
    number,
    { regionId: number; runs: number; delayed: number; total: number; max: number }
  >();
  for (const row of rows) {
    const delay = row.lastDelay ?? 0;
    const regionId = resolveRegion(row.stationCode, row.regionId);
    if (regionId == null) continue;
    const agg = byRegion.get(regionId) ?? {
      regionId,
      runs: 0,
      delayed: 0,
      total: 0,
      max: 0,
    };
    agg.runs += 1;
    agg.total += delay;
    if (delay > DELAY_THRESHOLD) agg.delayed += 1;
    if (delay > agg.max) agg.max = delay;
    byRegion.set(regionId, agg);
  }

  return [...byRegion.values()]
    .map((a) => ({
      regionId: a.regionId,
      name: regionName(a.regionId),
      runs: a.runs,
      delayedCount: a.delayed,
      totalDelay: a.total,
      avgDelay: a.runs ? Math.round((a.total / a.runs) * 10) / 10 : 0,
      maxDelay: a.max,
    }))
    .sort((a, b) => b.totalDelay - a.totalDelay || b.delayedCount - a.delayedCount);
}
