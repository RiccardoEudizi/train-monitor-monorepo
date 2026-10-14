import { inArray, sql } from "drizzle-orm";
import { stations, stops } from "~/db/schema";
import type { RegionStat, TrainStato } from "~/lib/api-types";
import { statoFor } from "~/lib/api-types";
import type { LiveCounts, LiveTrain } from "~/lib/map/interpolate";
import type {
  DayReplay,
  DayReplayRun,
  ReplayDaysRes,
} from "~/lib/map/replay";
import { db } from "~/server/db";
import { fetchRegionStats } from "~/server/data";

/** neon-http `db.execute()` returns `{ rows }`; plain arrays elsewhere. */
function rowsOf<T>(raw: unknown): T[] {
  return Array.isArray(raw) ? (raw as T[]) : ((raw as { rows?: T[] }).rows ?? []);
}

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

  const regions = await fetchRegionStats(period);

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
  origine: string | null;
  destinazione: string | null;
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
           r.origine AS "origine",
           r.destinazione AS "destinazione",
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
  const coordByCode = new Map<
    string,
    { lat: number; lon: number; name: string }
  >();
  if (codes.length > 0) {
    // Chunk the IN list: traveling trains can touch hundreds of stations.
    for (let i = 0; i < codes.length; i += 500) {
      const chunk = codes.slice(i, i + 500);
      const stationRows = await database
        .select({
          code: stations.code,
          lat: stations.lat,
          lon: stations.lon,
          name: stations.name,
        })
        .from(stations)
        .where(inArray(stations.code, chunk));
      for (const r of stationRows) {
        if (r.lat != null && r.lon != null) {
          coordByCode.set(r.code, { lat: r.lat, lon: r.lon, name: r.name });
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
      prev: { lat: prevCoord.lat, lon: prevCoord.lon, t: prevT },
      next: { lat: nextCoord.lat, lon: nextCoord.lon, t: nextT },
      updatedAt,
      origine: run.origine ?? "",
      destinazione: run.destinazione ?? "",
      nextStation: nextCoord.name,
    });
  }

  return { updatedAt, dbConfigured: true, counts: countTrains(trains), trains };
}

// ---------------------------------------------------------------------------
// Historical day replay
//
// Replay reads the 30-day hot window (train_runs + stops with per-stop
// scheduled/actual times). Older days only survive as `daily_*_stats`
// rollups, which carry no times or coords, so they are not replayable.
//
// The payload is compact for the client: times are integer MINUTES since the
// Europe/Rome midnight of `data_partenza`, and stations are dense-ranked by
// code (runs reference them by index). ~9.5k runs ≈ 1.9 MB raw JSON.
// ---------------------------------------------------------------------------

/** Days that have per-stop replay data, newest first. */
export async function fetchReplayDays(): Promise<ReplayDaysRes> {
  const database = db();
  if (!database) return { dbConfigured: false, days: [] };

  const rows = rowsOf<{ date: string; runs: number | string }>(
    await database.execute(sql`
      SELECT to_char(data_partenza, 'YYYY-MM-DD') AS "date",
             count(*)::int AS "runs"
      FROM train_runs
      GROUP BY data_partenza
      ORDER BY data_partenza DESC
    `),
  );
  return {
    dbConfigured: true,
    days: rows.map((r) => ({ date: r.date, runs: Number(r.runs) })),
  };
}

const DAY_TTL_MS = 5 * 60_000;
const DAY_CACHE_MAX = 4;
/** Runs per Neon round-trip (keeps each response small enough to be reliable). */
const DAY_CHUNK_RUNS = 2500;
const DAY_MAX_CHUNKS = 6;
/** Neon HTTP streams occasionally abort on large responses — retry. */
const DAY_ATTEMPTS = 3;
/** Per-date dataset cache (small LRU) + single-flight. */
const dayCache = new Map<string, { at: number; res: DayReplay }>();
const dayInFlight = new Map<string, Promise<DayReplay>>();

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < DAY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < DAY_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

/** Whole-day trajectory dataset, memoized per date. */
export function fetchDayReplay(date: string): Promise<DayReplay> {
  const key = date.trim();
  const hit = dayCache.get(key);
  if (hit && Date.now() - hit.at < DAY_TTL_MS) {
    dayCache.delete(key); // refresh LRU recency
    dayCache.set(key, hit);
    return Promise.resolve(hit.res);
  }
  const inflight = dayInFlight.get(key);
  if (inflight) return inflight;

  const p = computeDayReplay(key)
    .then((res) => {
      dayCache.set(key, { at: Date.now(), res });
      while (dayCache.size > DAY_CACHE_MAX) {
        const oldest = dayCache.keys().next().value;
        if (oldest === undefined) break;
        dayCache.delete(oldest);
      }
      return res;
    })
    .finally(() => {
      dayInFlight.delete(key);
    });
  dayInFlight.set(key, p);
  return p;
}

function emptyDay(date: string, dbConfigured: boolean): DayReplay {
  return {
    date,
    dbConfigured,
    midnightMs: 0,
    minMin: 0,
    maxMin: 0,
    stations: [],
    runs: [],
  };
}

async function computeDayReplay(date: string): Promise<DayReplay> {
  const database = db();
  if (!database) return emptyDay(date, false);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return emptyDay(date, true);

  const [stationRaw, midRaw, infoRaw] = await Promise.all([
    // Station dictionary with a GLOBAL rank over every geolocated station, so
    // the index is identical no matter how the runs are chunked below.
    withRetry(() =>
      database.execute(sql`
        SELECT st.lat AS "lat", st.lon AS "lon", st.name AS "name",
               (dense_rank() OVER (ORDER BY st.code COLLATE "C") - 1)::int AS "si"
        FROM stations st
        WHERE st.lat IS NOT NULL AND st.lon IS NOT NULL
        ORDER BY "si"
      `),
    ),
    withRetry(() =>
      database.execute(sql`
        SELECT (EXTRACT(EPOCH FROM (${date}::date::timestamp AT TIME ZONE 'Europe/Rome')) * 1000)::bigint AS "midnightMs"
      `),
    ),
    withRetry(() =>
      database.execute(sql`
        SELECT COALESCE(min(id), 0)::int AS "lo",
               COALESCE(max(id), 0)::int AS "hi",
               count(*)::int AS "n"
        FROM train_runs
        WHERE data_partenza = ${date}::date
      `),
    ),
  ]);

  const stations: Array<[number, number, string]> = rowsOf<{
    lat: number;
    lon: number;
    name: string;
  }>(stationRaw).map((s) => [s.lat, s.lon, s.name]);

  const midnightMs = Number(
    rowsOf<{ midnightMs: number | string }>(midRaw)[0]?.midnightMs ?? 0,
  );

  const info = rowsOf<{ lo: number; hi: number; n: number }>(infoRaw)[0];
  const total = Number(info?.n ?? 0);
  if (total === 0) return emptyDay(date, true);

  const lo = Number(info?.lo ?? 0);
  const hi = Number(info?.hi ?? 0);
  const span = Math.max(hi - lo + 1, 1);
  const chunks = Math.min(
    DAY_MAX_CHUNKS,
    Math.max(1, Math.ceil(total / DAY_CHUNK_RUNS)),
  );

  // Chunk by run-id ranges: a whole day aggregates to ~2–3.5 MB in one
  // response, which Neon's HTTP endpoint sometimes aborts. Smaller chunks
  // (fetched in parallel) are reliable; the global station rank keeps the
  // `si` indices consistent across them.
  const chunkRaws = await Promise.all(
    Array.from({ length: chunks }, (_, i) => {
      const a = lo + Math.floor((span * i) / chunks);
      const b =
        i === chunks - 1 ? hi : lo + Math.floor((span * (i + 1)) / chunks) - 1;
      return withRetry(() =>
        database.execute(sql`
          WITH mid AS (
            SELECT (${date}::date::timestamp AT TIME ZONE 'Europe/Rome') AS m
          ),
          strank AS (
            SELECT st.code,
                   (dense_rank() OVER (ORDER BY st.code COLLATE "C") - 1)::int AS si
            FROM stations st
            WHERE st.lat IS NOT NULL AND st.lon IS NOT NULL
          )
          SELECT r.id AS "runId", r.numero, r.categoria, r.origine,
                 r.destinazione,
                 COALESCE(r.provvedimento, 0) AS provvedimento,
                 COALESCE(r.max_delay, 0) AS "delay",
                 jsonb_agg(
                   jsonb_build_array(
                     sr.si,
                     round((EXTRACT(EPOCH FROM (COALESCE(s.actual_arr, s.programmata_arr) - m.m)) / 60))::int,
                     round((EXTRACT(EPOCH FROM (COALESCE(s.actual_dep, s.programmata_dep) - m.m)) / 60))::int,
                     GREATEST(COALESCE(s.delay_arr, 0), COALESCE(s.delay_dep, 0))
                   )
                   ORDER BY s.order_idx, sr.si
                 ) AS tl
          FROM train_runs r
          JOIN stops s ON s.run_id = r.id
          JOIN strank sr ON sr.code = s.station_code
          CROSS JOIN mid m
          WHERE r.data_partenza = ${date}::date
            AND r.id BETWEEN ${a} AND ${b}
            AND COALESCE(s.actual_arr, s.programmata_arr,
                         s.actual_dep, s.programmata_dep) IS NOT NULL
          GROUP BY r.id, r.numero, r.categoria, r.origine, r.destinazione,
                   r.provvedimento, r.max_delay
          HAVING count(*) >= 2
          ORDER BY r.id
        `),
      );
    }),
  );

  const runs: DayReplayRun[] = [];
  let minMin = Infinity;
  let maxMin = -Infinity;
  for (const raw of chunkRaws) {
    for (const r of rowsOf<{
      runId: number;
      numero: string;
      categoria: string | null;
      origine: string | null;
      destinazione: string | null;
      provvedimento: number;
      delay: number;
      tl: number[][] | null;
    }>(raw)) {
      const tl = r.tl ?? [];
      if (tl.length < 2) continue;
      runs.push({
        runId: r.runId,
        numero: r.numero,
        categoria: r.categoria ?? "",
        origine: r.origine ?? "",
        destinazione: r.destinazione ?? "",
        provvedimento: r.provvedimento ?? 0,
        delay: r.delay ?? 0,
        tl,
      });
      for (const e of tl) {
        for (const v of [e[1], e[2]]) {
          if (v == null) continue;
          if (v < minMin) minMin = v;
          if (v > maxMin) maxMin = v;
        }
      }
    }
  }

  if (!Number.isFinite(minMin)) {
    minMin = 0;
    maxMin = 0;
  }
  return { date, dbConfigured: true, midnightMs, minMin, maxMin, stations, runs };
}
