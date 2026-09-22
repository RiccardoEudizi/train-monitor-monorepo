import type { PeriodStats } from "~/lib/api-types";

/** Shared math for fetchStats / fetchOverview series. */

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

export function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

export function rate(count: number, total: number): number {
  return total ? Math.round((count / total) * 1000) / 10 : 0;
}

type DayBucket = { sum: number; max: number; n: number };

export function emptyDayBucket(): DayBucket {
  return { sum: 0, max: 0, n: 0 };
}

export function toSeries(byDay: Map<string, DayBucket>): PeriodStats["series"] {
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      avgFinal: d.n ? Math.round((d.sum / d.n) * 10) / 10 : 0,
      maxFinal: d.max,
      runs: d.n,
    }));
}

export const emptyStats: PeriodStats = {
  runs: 0,
  avgFinal: 0,
  p95Final: 0,
  maxFinal: 0,
  avgMaxEnroute: 0,
  avgRecupero: 0,
  cancellRate: 0,
  delayedCount: 0,
  delayedRate: 0,
  totalDelay: 0,
  worstTrain: null,
  series: [],
};
