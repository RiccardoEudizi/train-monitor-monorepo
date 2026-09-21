import { inArray, sql } from "drizzle-orm";
import { stations, stops } from "~/db/schema";
import type { RegionStat } from "~/lib/api-types";
import { statoFor } from "~/lib/api-types";
import type { LiveTrain } from "~/lib/map/interpolate";
import { normalizePeriodDays, DELAY_THRESHOLD } from "~/server/data";
import { resolveRegion, regionName } from "~/lib/regions";
import { db } from "~/server/db";

/**
 * Map data layer for /map. Thin over the same tables as ~/server/data;
 * shapes are map-ready (coords, anchors) instead of UI-ready cards.
 */

export interface MapRegionsRes {
  period: string;
  dbConfigured: boolean;
  regions: RegionStat[];
}

interface PerRunRegion {
  lastDelay: number | null;
  regionId: number | null;
  stationCode: string | null;
}

/** All regions with delay aggregates for the choropleth (no top-N slice). */
export async function fetchMapRegions(period: string): Promise<MapRegionsRes> {
  const database = db();
  if (!database) return { period, dbConfigured: false, regions: [] };

  const days = normalizePeriodDays(period);
  const sinceDate =
    days == null
      ? null
      : new Date(Date.now() - days * 24 * 3600 * 1000)
          .toISOString()
          .slice(0, 10);

  const raw = (await database.execute(sql`
    SELECT r.last_delay AS "lastDelay",
           COALESCE(sl.region_id, so.region_id) AS "regionId",
           COALESCE(sl.code, so.code) AS "stationCode"
    FROM train_runs r
    LEFT JOIN LATERAL (
      SELECT stat.region_id AS region_id, st.station_code AS code
      FROM stops st
      LEFT JOIN stations stat ON stat.code = st.station_code
      WHERE st.run_id = r.id
        AND (st.actual_arr IS NOT NULL OR st.actual_dep IS NOT NULL)
      ORDER BY st.order_idx DESC
      LIMIT 1
    ) sl ON true
    LEFT JOIN stations so ON so.code = r.origine_code
    ${sinceDate ? sql`WHERE r.data_partenza >= ${sinceDate}` : sql``}
  `)) as unknown as PerRunRegion[] | { rows: PerRunRegion[] };
  const perRun = Array.isArray(raw) ? raw : (raw.rows ?? []);

  const byRegion = new Map<
    string,
    { regionId: number | null; runs: number; delayed: number; total: number; max: number }
  >();
  for (const row of perRun) {
    const delay = row.lastDelay ?? 0;
    const regionId = resolveRegion(row.stationCode, row.regionId);
    const key = regionId == null ? "null" : String(regionId);
    const agg = byRegion.get(key) ?? {
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
    byRegion.set(key, agg);
  }

  const regions: RegionStat[] = [...byRegion.values()]
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

  return { period, dbConfigured: true, regions };
}

export interface LiveTrainsRes {
  updatedAt: string;
  dbConfigured: boolean;
  trains: LiveTrain[];
}

interface RunRow {
  id: number;
  numero: string;
  categoria: string | null;
  lastDelay: number | null;
  provvedimento: number | null;
  orarioPartenza: unknown;
  orarioArrivo: unknown;
}

/** neon-http may hand back Date objects or ISO strings — normalize. */
function toISO(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && v) {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? v : null;
  }
  return null;
}

/**
 * Every currently traveling train with prev/next anchors for the
 * interpolation formula (see ~/lib/map/interpolate.ts):
 * prev = last stop with actual arr/dep (or origin departure),
 * next = first upcoming stop (scheduled time).
 */
export async function fetchLiveTrains(): Promise<LiveTrainsRes> {
  const updatedAt = new Date().toISOString();
  const database = db();
  if (!database) return { updatedAt, dbConfigured: false, trains: [] };

  const rawRuns = (await database.execute(sql`
    SELECT r.id AS "id",
           r.numero AS "numero",
           r.categoria AS "categoria",
           r.last_delay AS "lastDelay",
           r.provvedimento AS "provvedimento",
           r.orario_partenza AS "orarioPartenza",
           r.orario_arrivo AS "orarioArrivo"
    FROM train_runs r
    WHERE r.orario_partenza <= NOW()
      AND r.orario_arrivo + make_interval(mins => GREATEST(COALESCE(r.last_delay, 0), 0)) > NOW() - INTERVAL '3 minutes'
    LIMIT 2000
  `)) as unknown as RunRow[] | { rows: RunRow[] };
  const runs = (Array.isArray(rawRuns) ? rawRuns : (rawRuns.rows ?? [])).map(
    (r) => ({
      ...r,
      orarioPartenza: toISO(r.orarioPartenza),
      orarioArrivo: toISO(r.orarioArrivo),
    }),
  );
  if (runs.length === 0) return { updatedAt, dbConfigured: true, trains: [] };

  const runIds = runs.map((r) => r.id);
  const stopRows = await database
    .select({
      runId: stops.runId,
      stationCode: stops.stationCode,
      orderIdx: stops.orderIdx,
      programmataArr: stops.programmataArr,
      programmataDep: stops.programmataDep,
      actualArr: stops.actualArr,
      actualDep: stops.actualDep,
    })
    .from(stops)
    .where(inArray(stops.runId, runIds));

  const byRun = new Map<number, typeof stopRows>();
  for (const s of stopRows) {
    const list = byRun.get(s.runId) ?? [];
    list.push(s);
    byRun.set(s.runId, list);
  }
  for (const list of byRun.values()) {
    list.sort((a, b) => (a.orderIdx ?? 0) - (b.orderIdx ?? 0));
  }

  const codes = [...new Set(stopRows.map((s) => s.stationCode))];
  const coordByCode = new Map<string, { lat: number; lon: number }>();
  if (codes.length > 0) {
    // Chunk the IN list: traveling trains can touch hundreds of stations.
    for (let i = 0; i < codes.length; i += 500) {
      const chunk = codes.slice(i, i + 500);
      const stationRows = await database
        .select({ code: stations.code, lat: stations.lat, lon: stations.lon })
        .from(stations)
        .where(inArray(stations.code, chunk));
      for (const r of stationRows) {
        if (r.lat != null && r.lon != null) {
          coordByCode.set(r.code, { lat: r.lat, lon: r.lon });
        }
      }
    }
  }

  const ms = (d: Date | null | undefined, fallback: string | null): number | null => {
    if (d) return new Date(d).getTime();
    if (fallback) {
      const t = new Date(fallback).getTime();
      return Number.isFinite(t) ? t : null;
    }
    return null;
  };

  const trains: LiveTrain[] = [];
  for (const run of runs) {
    const list = (byRun.get(run.id) ?? []).filter((s) =>
      coordByCode.has(s.stationCode),
    );
    if (list.length < 2) continue;

    let prevIdx = -1;
    for (let i = 0; i < list.length; i++) {
      if (list[i].actualArr || list[i].actualDep) prevIdx = i;
    }

    let prevStop: (typeof list)[number];
    let nextStop: (typeof list)[number];
    if (prevIdx === -1) {
      // No rilevamento yet: pin between origin departure and first stop.
      prevStop = list[0];
      nextStop = list[1];
    } else if (prevIdx >= list.length - 1) {
      // At the last stop already: pin to the final leg.
      prevStop = list[list.length - 2];
      nextStop = list[list.length - 1];
    } else {
      prevStop = list[prevIdx];
      nextStop = list[prevIdx + 1];
    }

    const prevCoord = coordByCode.get(prevStop.stationCode);
    const nextCoord = coordByCode.get(nextStop.stationCode);
    if (!prevCoord || !nextCoord) continue;

    const prevT =
      ms(prevStop.actualDep, null) ??
      ms(prevStop.actualArr, null) ??
      ms(prevStop.programmataDep, run.orarioPartenza) ??
      ms(prevStop.programmataArr, run.orarioPartenza);
    const nextT =
      ms(nextStop.programmataArr, null) ??
      ms(nextStop.programmataDep, null) ??
      ms(null, run.orarioArrivo);
    if (prevT == null || nextT == null || !(nextT > prevT)) continue;

    const delay = run.lastDelay ?? 0;
    trains.push({
      runId: run.id,
      numero: run.numero,
      categoria: run.categoria ?? "",
      delay,
      stato: statoFor(delay, run.provvedimento ?? 0),
      prev: { ...prevCoord, t: prevT },
      next: { ...nextCoord, t: nextT },
      updatedAt,
    });
  }

  return { updatedAt, dbConfigured: true, trains };
}
