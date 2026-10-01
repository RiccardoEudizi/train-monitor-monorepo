import { inArray, sql } from "drizzle-orm";
import { stations, stops } from "~/db/schema";
import type { RegionStat, TrainStato } from "~/lib/api-types";
import { statoFor } from "~/lib/api-types";
import type { LiveCounts, LiveTrain } from "~/lib/map/interpolate";
import { periodSinceDate } from "~/server/period";
import { aggregateByRegion, type PerRunRegion } from "~/lib/region-agg";
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

/** All regions with delay aggregates for the choropleth (no top-N slice). */
export async function fetchMapRegions(period: string): Promise<MapRegionsRes> {
  const database = db();
  if (!database) return { period, dbConfigured: false, regions: [] };

  const sinceDate = periodSinceDate(period);

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

  const regions = aggregateByRegion(perRun);

  return { period, dbConfigured: true, regions };
}

/**
 * Counts derived from the SAME `trains` array that becomes the 3D map's
 * dots, so `total` is by construction the number of dots drawn and the
 * homepage hero can never disagree with /map. See LiveCounts in
 * ~/lib/map/interpolate (shared by client and server).
 */
function countTrains(trains: LiveTrain[]): LiveCounts {
  const byStato: Record<TrainStato, number> = {
    ok: 0,
    delayed: 0,
    "heavily-delayed": 0,
    cancelled: 0,
    partial: 0,
    nodata: 0,
  };
  for (const t of trains) {
    const k = t.stato as TrainStato;
    byStato[k] = (byStato[k] ?? 0) + 1;
  }
  return {
    total: trains.length,
    inRitardo: byStato.delayed + byStato["heavily-delayed"],
    byStato,
  };
}

export interface LiveTrainsRes {
  updatedAt: string;
  dbConfigured: boolean;
  counts: LiveCounts;
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
 * TTL for the live snapshot cache. The poller only refreshes circulating
 * trains every ACTIVE_INTERVAL_SECONDS (40s), so 10s is well inside one
 * source update: the cache can never serve data the poller had already
 * replaced, it only collapses repeated reads of the same snapshot.
 */
const LIVE_TTL_MS = 10_000;

let liveCache: { at: number; res: LiveTrainsRes } | null = null;
let liveInFlight: Promise<LiveTrainsRes> | null = null;

/**
 * Every currently traveling train, memoized for LIVE_TTL_MS.
 *
 * This is the heaviest read in the app (up to 2000 runs + every stop of each
 * + station coords) and it has two callers that want the SAME snapshot: the
 * /map 12s poll and the homepage hero (SSR + revalidated on the SSE tick).
 * Without the cache each caller scans independently, and after a TTL expiry
 * a burst of concurrent requests would fan out into N identical scans — so
 * misses are single-flighted through `liveInFlight` as well.
 *
 * Failures are never cached: `.then` stores the value only on success, and
 * `.finally` drops the in-flight handle either way.
 */
export function fetchLiveTrains(): Promise<LiveTrainsRes> {
  const hit = liveCache;
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return Promise.resolve(hit.res);
  liveInFlight ??= computeLiveTrains()
    .then((res) => {
      liveCache = { at: Date.now(), res };
      return res;
    })
    .finally(() => {
      liveInFlight = null;
    });
  return liveInFlight;
}

/**
 * Every currently traveling train with prev/next anchors for the
 * interpolation formula (see ~/lib/map/interpolate.ts):
 * prev = last stop with actual arr/dep (or origin departure),
 * next = first upcoming stop (scheduled time).
 */
async function computeLiveTrains(): Promise<LiveTrainsRes> {
  const updatedAt = new Date().toISOString();
  const database = db();
  if (!database) {
    return { updatedAt, dbConfigured: false, counts: countTrains([]), trains: [] };
  }

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
  if (runs.length === 0) {
    return { updatedAt, dbConfigured: true, counts: countTrains([]), trains: [] };
  }

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

  return { updatedAt, dbConfigured: true, counts: countTrains(trains), trains };
}
