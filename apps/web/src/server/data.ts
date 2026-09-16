import { and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { infoNews, stations, stops, trainRuns } from "~/db/schema";
import type {
  BoardRes,
  DelaysRes,
  NewsRes,
  PeriodStats,
  StationItem,
  TrainDetail,
} from "~/lib/api-types";
import { statoFor, temporalStatus } from "~/lib/api-types";
import { searchSeed, seedByCode } from "~/lib/stations-seed";
import { db, dbConfigured } from "~/server/db";

/**
 * Shared data access used by BOTH the /api/* route adapters and the
 * `query()` server functions. Returns plain JSON-safe objects (ISO date
 * strings, never Date instances) so shapes are identical over HTTP and RPC.
 */

export async function searchStations(q: string): Promise<{
  stations: StationItem[];
  dbConfigured: boolean;
  degraded?: boolean;
}> {
  const query = q.trim();
  if (query.length < 2) return { stations: [], dbConfigured: dbConfigured() };
  const database = db();
  if (!database) {
    return { stations: searchSeed(query), dbConfigured: false };
  }
  try {
    const rows = await database
      .select()
      .from(stations)
      .where(
        or(
          ilike(stations.name, `%${query}%`),
          ilike(stations.city, `%${query}%`),
        ),
      )
      .limit(8);
    return {
      stations: rows.map((r) => ({
        code: r.code,
        name: r.name,
        city: r.city,
        region: r.regionId,
        major: r.isMajor,
      })),
      dbConfigured: true,
    };
  } catch (e) {
    console.error("stations query failed", e);
    return { stations: searchSeed(query), dbConfigured: true, degraded: true };
  }
}

export async function fetchBoard(code: string): Promise<BoardRes & { dbConfigured: boolean }> {
  const database = db();
  if (!database) {
    const seed = seedByCode(code);
    return {
      station: seed ?? { code, name: code, city: null, region: null, major: false },
      updatedAt: new Date().toISOString(),
      trains: [],
      dbConfigured: false,
    };
  }
  const [stationRow] = await database
    .select()
    .from(stations)
    .where(eq(stations.code, code))
    .limit(1);

  const rows = await database
    .select({
      runId: trainRuns.id,
      numero: trainRuns.numero,
      categoria: trainRuns.categoria,
      origine: trainRuns.origine,
      destinazione: trainRuns.destinazione,
      dataPartenza: trainRuns.dataPartenza,
      provvedimento: trainRuns.provvedimento,
      lastRilevamentoAt: trainRuns.lastRilevamentoAt,
      lastRilevamentoStazione: trainRuns.lastRilevamentoStazione,
      orarioPartenza: trainRuns.orarioPartenza,
      orarioArrivo: trainRuns.orarioArrivo,
      progArr: stops.programmataArr,
      progDep: stops.programmataDep,
      actualArr: stops.actualArr,
      actualDep: stops.actualDep,
      delayArr: stops.delayArr,
      delayDep: stops.delayDep,
      binarioProg: stops.binarioProg,
      binarioReal: stops.binarioReal,
      tipoFermata: stops.tipoFermata,
    })
    .from(stops)
    .innerJoin(trainRuns, eq(stops.runId, trainRuns.id))
    .where(eq(stops.stationCode, code))
    .orderBy(desc(stops.programmataDep))
    .limit(60);

  const now = new Date();
  const trains: BoardRes["trains"] = rows.map((r) => {
    const isOrigin = r.tipoFermata === "P";
    const delay = isOrigin ? (r.delayDep ?? 0) : (r.delayArr ?? 0);
    const scheduled = (isOrigin ? r.progDep : r.progArr)?.toISOString() ?? null;
    const expected =
      (isOrigin ? r.actualDep : r.actualArr)?.toISOString() ?? scheduled;
    const delayStato = statoFor(delay, r.provvedimento ?? 0);
    const temporal = temporalStatus(r.orarioPartenza?.toISOString() ?? null, r.orarioArrivo?.toISOString() ?? null, now);
    return {
      runId: r.runId,
      numero: r.numero,
      categoria: r.categoria ?? "",
      origine: r.origine ?? "",
      destinazione: r.destinazione ?? "",
      dataPartenza: r.dataPartenza,
      scheduled,
      expected,
      delay,
      binarioProg: r.binarioProg,
      binarioReal: r.binarioReal,
      stato: delayStato,
      temporalStatus: temporal,
      orarioPartenza: r.orarioPartenza?.toISOString() ?? null,
      orarioArrivo: r.orarioArrivo?.toISOString() ?? null,
      lastRilevamento: r.lastRilevamentoAt?.toISOString() ?? null,
      lastRilevamentoStazione: r.lastRilevamentoStazione,
    };
  });
  trains.sort(
    (a, b) =>
      b.delay - a.delay || (a.scheduled ?? "").localeCompare(b.scheduled ?? ""),
  );

  return {
    station: stationRow
      ? {
          code: stationRow.code,
          name: stationRow.name,
          city: stationRow.city,
          region: stationRow.regionId,
          major: stationRow.isMajor,
        }
      : (seedByCode(code) ?? {
          code,
          name: code,
          city: null,
          region: null,
          major: false,
        }),
    updatedAt: new Date().toISOString(),
    trains,
    dbConfigured: true,
  };
}

export async function fetchTrain(
  n: string,
  origine?: string,
  date?: string,
): Promise<TrainDetail & { dbConfigured: boolean }> {
  const empty: TrainDetail & { dbConfigured: boolean } = {
    candidates: [],
    live: null,
    stops: [],
    dbConfigured: dbConfigured(),
  };
  const database = db();
  if (!database) return empty;

  const runs = await database
    .select()
    .from(trainRuns)
    .where(eq(trainRuns.numero, n))
    .orderBy(desc(trainRuns.dataPartenza))
    .limit(10);

  if (runs.length === 0) {
    return { ...empty, dbConfigured: true };
  }

  const run =
    runs.find(
      (r) =>
        (!origine || r.origineCode === origine) &&
        (!date || r.dataPartenza === date),
    ) ?? runs[0];

  const stopRows = await database
    .select()
    .from(stops)
    .where(eq(stops.runId, run.id))
    .orderBy(stops.orderIdx);

  const delay = run.lastDelay ?? 0;
  const delayStato = statoFor(delay, run.provvedimento ?? 0);
  const temporal = temporalStatus(run.orarioPartenza?.toISOString() ?? null, run.orarioArrivo?.toISOString() ?? null);
  return {
    candidates: runs.map((r) => ({
      numero: r.numero,
      origine: r.origine ?? "",
      origineCode: r.origineCode,
      dataPartenza: r.dataPartenza,
    })),
    live: {
      runId: run.id,
      numero: run.numero,
      categoria: run.categoria ?? "",
      origine: run.origine ?? "",
      destinazione: run.destinazione ?? "",
      dataPartenza: run.dataPartenza,
      scheduled: run.orarioPartenza?.toISOString() ?? null,
      expected: run.orarioArrivo?.toISOString() ?? null,
      delay,
      binarioProg: null,
      binarioReal: null,
      stato: delayStato,
      temporalStatus: temporal,
      orarioPartenza: run.orarioPartenza?.toISOString() ?? null,
      orarioArrivo: run.orarioArrivo?.toISOString() ?? null,
      lastRilevamento: run.lastRilevamentoAt?.toISOString() ?? null,
      lastRilevamentoStazione: run.lastRilevamentoStazione,
    },
    stops: stopRows.map((s, i) => ({
      station: s.stationCode,
      code: s.stationCode,
      order: s.orderIdx ?? i,
      tipoFermata: s.tipoFermata,
      scheduledArr: s.programmataArr?.toISOString() ?? null,
      scheduledDep: s.programmataDep?.toISOString() ?? null,
      actualArr: s.actualArr?.toISOString() ?? null,
      actualDep: s.actualDep?.toISOString() ?? null,
      delayArr: s.delayArr ?? 0,
      delayDep: s.delayDep ?? 0,
      status:
        s.actualType === 3
          ? ("skipped" as const)
          : s.actualArr || s.actualDep
            ? ("done" as const)
            : ("upcoming" as const),
    })),
    dbConfigured: true,
  };
}

export async function fetchDelays(
  min: number,
  cats: string[],
  limit: number,
): Promise<DelaysRes & { dbConfigured: boolean }> {
  const database = db();
  if (!database) {
    return {
      updatedAt: new Date().toISOString(),
      totalCircolanti: 0,
      items: [],
      dbConfigured: false,
    };
  }
  const conditions = [gte(trainRuns.lastDelay, min)];
  if (cats.length > 0) {
    conditions.push(sql`${trainRuns.categoria} IN ${cats}`);
  }
  const rows = await database
    .select()
    .from(trainRuns)
    .where(sql.join(conditions, sql` AND `))
    .orderBy(desc(trainRuns.lastDelay))
    .limit(limit);

  let totalCircolanti = rows.length;
  try {
    const [row] = await database
      .select()
      .from(infoNews)
      .where(eq(infoNews.kind, "stats"))
      .limit(1);
    const payload = row?.payload as { treniCircolanti?: number } | undefined;
    if (payload?.treniCircolanti) totalCircolanti = payload.treniCircolanti;
  } catch {
    /* keep fallback */
  }

  return {
    updatedAt: new Date().toISOString(),
    totalCircolanti,
    items: rows.map((r) => {
      const delayStato = statoFor(r.lastDelay ?? 0, r.provvedimento ?? 0);
      const temporal = temporalStatus(r.orarioPartenza?.toISOString() ?? null, r.orarioArrivo?.toISOString() ?? null);
      return {
        runId: r.id,
        numero: r.numero,
        categoria: r.categoria ?? "",
        origine: r.origine ?? "",
        destinazione: r.destinazione ?? "",
        dataPartenza: r.dataPartenza,
        scheduled: r.orarioPartenza?.toISOString() ?? null,
        expected: r.orarioArrivo?.toISOString() ?? null,
        delay: r.lastDelay ?? 0,
        binarioProg: null,
        binarioReal: null,
        stato: delayStato,
        temporalStatus: temporal,
        orarioPartenza: r.orarioPartenza?.toISOString() ?? null,
        orarioArrivo: r.orarioArrivo?.toISOString() ?? null,
        lastRilevamento: r.lastRilevamentoAt?.toISOString() ?? null,
        lastRilevamentoStazione: r.lastRilevamentoStazione,
      };
    }),
    dbConfigured: true,
  };
}

const emptyStats: PeriodStats = {
  runs: 0,
  avgFinal: 0,
  p95Final: 0,
  maxFinal: 0,
  avgMaxEnroute: 0,
  avgRecupero: 0,
  cancellRate: 0,
  series: [],
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

export async function fetchStats(
  scope: string,
  id: string,
  period: string,
): Promise<PeriodStats & { dbConfigured: boolean; period: string }> {
  const days = period === "24h" ? 1 : period === "7d" ? 7 : 30;
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const sinceDate = since.toISOString().slice(0, 10);

  const database = db();
  if (!database) {
    return { ...emptyStats, dbConfigured: false, period };
  }

  if (scope === "station" && id) {
    const { dailyStopStats } = await import("~/db/schema");
    const rows = await database
      .select()
      .from(dailyStopStats)
      .where(
        and(
          eq(dailyStopStats.stationCode, id),
          gte(dailyStopStats.runDate, sinceDate),
        ),
      );
    const finals = rows.map((r) => r.delayArrFinal ?? 0).sort((a, b) => a - b);
    const maxes = rows.map((r) => r.delayMax ?? 0);
    const cancelled = rows.filter((r) => r.cancelled).length;
    const byDay = new Map<string, { sum: number; max: number; n: number }>();
    for (const r of rows) {
      const d = byDay.get(r.runDate) ?? { sum: 0, max: 0, n: 0 };
      d.sum += r.delayArrFinal ?? 0;
      d.max = Math.max(d.max, r.delayMax ?? 0);
      d.n += 1;
      byDay.set(r.runDate, d);
    }
    return {
      runs: rows.length,
      avgFinal: avg(finals),
      p95Final: percentile(finals, 95),
      maxFinal: maxes.length ? Math.max(...maxes) : 0,
      avgMaxEnroute: 0,
      avgRecupero: 0,
      cancellRate: rows.length ? Math.round((cancelled / rows.length) * 1000) / 10 : 0,
      series: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, d]) => ({
          date,
          avgFinal: d.n ? Math.round((d.sum / d.n) * 10) / 10 : 0,
          maxFinal: d.max,
          runs: d.n,
        })),
      dbConfigured: true,
      period,
    };
  }

  const conds = [gte(trainRuns.dataPartenza, sinceDate)];
  if (scope === "train" && id) conds.push(eq(trainRuns.numero, id));
  const rows = await database
    .select({
      lastDelay: trainRuns.lastDelay,
      maxDelay: trainRuns.maxDelay,
      provvedimento: trainRuns.provvedimento,
      dataPartenza: trainRuns.dataPartenza,
    })
    .from(trainRuns)
    .where(and(...conds));

  const finals = rows.map((r) => r.lastDelay ?? 0).sort((a, b) => a - b);
  const maxes = rows.map((r) => r.maxDelay ?? r.lastDelay ?? 0);
  const cancelled = rows.filter((r) => (r.provvedimento ?? 0) === 1).length;
  const recupero =
    rows.length > 0 ? avg(maxes) - avg(finals) : 0;

  const byDay = new Map<string, { sum: number; max: number; n: number }>();
  for (const r of rows) {
    const d = byDay.get(r.dataPartenza) ?? { sum: 0, max: 0, n: 0 };
    d.sum += r.lastDelay ?? 0;
    d.max = Math.max(d.max, r.lastDelay ?? 0);
    d.n += 1;
    byDay.set(r.dataPartenza, d);
  }
  return {
    runs: rows.length,
    avgFinal: avg(finals),
    p95Final: percentile(finals, 95),
    maxFinal: finals.length ? Math.max(...finals) : 0,
    avgMaxEnroute: avg(maxes),
    avgRecupero: Math.round(recupero * 10) / 10,
    cancellRate: rows.length ? Math.round((cancelled / rows.length) * 1000) / 10 : 0,
    series: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        avgFinal: d.n ? Math.round((d.sum / d.n) * 10) / 10 : 0,
        maxFinal: d.max,
        runs: d.n,
      })),
    dbConfigured: true,
    period,
  };
}

export async function fetchNews(): Promise<
  NewsRes & { lavori?: unknown; dbConfigured: boolean }
> {
  const database = db();
  if (!database) {
    return {
      ticker: [],
      news: [],
      updatedAt: new Date().toISOString(),
      dbConfigured: false,
    };
  }
  const rows = await database.select().from(infoNews);
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  const get = (k: string, fb: unknown) => (byKind.get(k)?.payload as unknown) ?? fb;
  const rawTicker = get("ticker", []);
  // The poller used to store {html} objects; current shape is string[].
  const ticker = Array.isArray(rawTicker) ? (rawTicker as string[]) : [];
  return {
    ticker,
    news: get("news", []),
    lavori: get("lavori", []),
    updatedAt:
      byKind.get("ticker")?.fetchedAt?.toISOString() ?? new Date().toISOString(),
    dbConfigured: true,
  };
}
