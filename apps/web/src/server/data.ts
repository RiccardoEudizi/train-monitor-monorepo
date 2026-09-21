import { and, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import {
  dailyStopStats,
  dailyTrainStats,
  infoNews,
  stations,
  stops,
  trainRuns,
} from "~/db/schema";
import type {
  BoardRes,
  DelaysRes,
  NewsRes,
  OverviewRes,
  PeriodStats,
  RegionStat,
  StationItem,
  TrainDetail,
} from "~/lib/api-types";
import { statoFor, temporalStatus } from "~/lib/api-types";
import { resolveRegion, regionName } from "~/lib/regions";
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
    // Final order is delay-first in JS below; keep SQL order recency-only
    // as a pre-filter for the LIMIT window.
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
    const temporal = temporalStatus(r.orarioPartenza?.toISOString() ?? null, r.orarioArrivo?.toISOString() ?? null, now, delay);
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
    runs: [],
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
    .limit(60);

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

  // Resolve station names (stops store only stationCode).
  // Fallback: major seed → raw code when missing from DB.
  const stopCodes = [...new Set(stopRows.map((s) => s.stationCode))];
  const nameByCode = new Map<string, string>();
  if (stopCodes.length > 0) {
    const stationRows = await database
      .select({ code: stations.code, name: stations.name })
      .from(stations)
      .where(inArray(stations.code, stopCodes));
    for (const r of stationRows) nameByCode.set(r.code, r.name);
  }
  const stopName = (code: string) =>
    nameByCode.get(code) ?? seedByCode(code)?.name ?? code;

  const delay = run.lastDelay ?? 0;
  const delayStato = statoFor(delay, run.provvedimento ?? 0);
  const temporal = temporalStatus(run.orarioPartenza?.toISOString() ?? null, run.orarioArrivo?.toISOString() ?? null, new Date(), delay);

  // Per-run delay summary over all recent runs (single extra query).
  // avgDelay = mean of max(delayArr, delayDep) across stops with actual
  // data; falls back to 0 when the run has no actuals yet.
  const runIds = runs.map((r) => r.id);
  const allStops =
    runIds.length > 0
      ? await database
          .select({
            runId: stops.runId,
            delayArr: stops.delayArr,
            delayDep: stops.delayDep,
            actualArr: stops.actualArr,
            actualDep: stops.actualDep,
          })
          .from(stops)
          .where(inArray(stops.runId, runIds))
      : [];
  const delaysByRun = new Map<number, number[]>();
  const countByRun = new Map<number, number>();
  for (const s of allStops) {
    countByRun.set(s.runId, (countByRun.get(s.runId) ?? 0) + 1);
    if (s.actualArr != null || s.actualDep != null) {
      const d = Math.max(s.delayArr ?? 0, s.delayDep ?? 0);
      const arr = delaysByRun.get(s.runId) ?? [];
      arr.push(d);
      delaysByRun.set(s.runId, arr);
    }
  }
  const runSummaries = runs.map((r) => {
    const vals = delaysByRun.get(r.id) ?? [];
    const avgDelay =
      vals.length > 0
        ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
        : 0;
    return {
      runId: r.id,
      origine: r.origine ?? "",
      origineCode: r.origineCode,
      destinazione: r.destinazione ?? "",
      dataPartenza: r.dataPartenza,
      orarioPartenza: r.orarioPartenza?.toISOString() ?? null,
      orarioArrivo: r.orarioArrivo?.toISOString() ?? null,
      avgDelay,
      lastDelay: r.lastDelay ?? 0,
      maxDelay: r.maxDelay ?? r.lastDelay ?? 0,
      stops: countByRun.get(r.id) ?? 0,
      provvedimento: r.provvedimento ?? 0,
      stato: statoFor(r.lastDelay ?? 0, r.provvedimento ?? 0),
    };
  });

  return {
    candidates: runs.map((r) => ({
      numero: r.numero,
      origine: r.origine ?? "",
      origineCode: r.origineCode,
      dataPartenza: r.dataPartenza,
    })),
    runs: runSummaries,
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
      station: stopName(s.stationCode),
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
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeLimit = Number.isFinite(limit)
    ? Math.min(Math.max(Math.floor(limit), 1), 200)
    : 50;
  const normCats = [...new Set(cats.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  const conditions = [gte(trainRuns.lastDelay, safeMin)];
  if (normCats.length > 0) {
    conditions.push(inArray(trainRuns.categoria, normCats));
  }
  // "ora" = waiting (departure within 50') or traveling now. Arrival is
  // delay-shifted: a train scheduled at 10:00 with +60' is still traveling
  // at 10:30. Without this, yesterday's ended runs (high last_delay) top
  // the ranking forever — e.g. 9639 arrived yesterday with +202 while
  // today's run still has to depart. A 3' trailing grace keeps just-ended
  // trains visible while the poller writes the final snapshot.
  conditions.push(
    sql`${trainRuns.orarioPartenza} <= NOW() + INTERVAL '50 minutes'`,
  );
  conditions.push(
    sql`${trainRuns.orarioArrivo} + make_interval(mins => GREATEST(COALESCE(${trainRuns.lastDelay}, 0), 0)) > NOW() - INTERVAL '3 minutes'`,
  );
  const rows = await database
    .select()
    .from(trainRuns)
    .where(sql.join(conditions, sql` AND `))
    .orderBy(desc(trainRuns.lastDelay))
    .limit(safeLimit);

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
      const temporal = temporalStatus(r.orarioPartenza?.toISOString() ?? null, r.orarioArrivo?.toISOString() ?? null, new Date(), r.lastDelay ?? 0);
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
  delayedCount: 0,
  delayedRate: 0,
  totalDelay: 0,
  worstTrain: null,
  series: [],
};

/** Soglia "in ritardo" per la panoramica home (richiesta: > 0'). */
export const DELAY_THRESHOLD = 0;

/**
 * Normalizza i periodi Ereignisse home + treno/stazione.
 * Home: "1d" | "7d" | "30d" | "total". Treno: "24h" | "7d" | "30d" | "all".
 * Ritorna i giorni di finestra, oppure null = tutto lo storico.
 */
export function normalizePeriodDays(period: string): number | null {
  const p = (period ?? "").trim().toLowerCase();
  if (p === "24h" || p === "1d" || p === "day" || p === "daily") return 1;
  if (p === "7d" || p === "week" || p === "7g") return 7;
  if (p === "30d" || p === "month" || p === "30g") return 30;
  if (p === "all" || p === "total" || p === "totale" || p === "tot") return null;
  return 30;
}

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
  const days = normalizePeriodDays(period);
  const sinceDate =
    days == null
      ? null
      : new Date(Date.now() - days * 24 * 3600 * 1000)
          .toISOString()
          .slice(0, 10);

  const database = db();
  if (!database) {
    return { ...emptyStats, dbConfigured: false, period };
  }

  if (scope === "station" && id) {
    const rows = sinceDate
      ? await database
          .select()
          .from(dailyStopStats)
          .where(
            and(
              eq(dailyStopStats.stationCode, id),
              gte(dailyStopStats.runDate, sinceDate),
            ),
          )
      : await database
          .select()
          .from(dailyStopStats)
          .where(eq(dailyStopStats.stationCode, id));
    const finals = rows.map((r) => r.delayArrFinal ?? 0).sort((a, b) => a - b);
    const maxes = rows.map((r) => r.delayMax ?? 0);
    const cancelled = rows.filter((r) => r.cancelled).length;
    const delayedCount = finals.filter((v) => v > DELAY_THRESHOLD).length;
    const totalDelay = finals.reduce((a, b) => a + b, 0);
    const byDay = new Map<string, { sum: number; max: number; n: number }>();
    for (const r of rows) {
      const d = byDay.get(r.runDate) ?? { sum: 0, max: 0, n: 0 };
      d.sum += r.delayArrFinal ?? 0;
      d.max = Math.max(d.max, r.delayMax ?? 0);
      d.n += 1;
      byDay.set(r.runDate, d);
    }
    const maxFinal = maxes.length ? Math.max(...maxes) : 0;
    let worstTrain: PeriodStats["worstTrain"] = null;
    if (rows.length > 0) {
      const worst = [...rows]
        .filter((r) => (r.delayMax ?? 0) === maxFinal)
        .sort(
          (a, b) =>
            b.runDate.localeCompare(a.runDate) ||
            (b.delayArrFinal ?? 0) - (a.delayArrFinal ?? 0),
        )[0];
      if (worst) {
        const worstDelay = worst.delayMax ?? 0;
        try {
          const runRows = await database
            .select()
            .from(trainRuns)
            .where(
              and(
                eq(trainRuns.numero, worst.numero),
                eq(trainRuns.dataPartenza, worst.runDate),
              ),
            )
            .limit(5);
          let run = runRows[0];
          let stopRow = null;
          if (runRows.length > 0) {
            const runIds = runRows.map((r) => r.id);
            const stopRows = await database
              .select()
              .from(stops)
              .where(
                and(
                  inArray(stops.runId, runIds),
                  eq(stops.stationCode, id),
                ),
              );
            const match = stopRows[0];
            if (match) {
              stopRow = match;
              run = runRows.find((r) => r.id === match.runId) ?? run;
            } else {
              const [single] = await database
                .select()
                .from(stops)
                .where(
                  and(
                    eq(stops.runId, run.id),
                    eq(stops.stationCode, id),
                  ),
                )
                .limit(1);
              stopRow = single ?? null;
            }
          }
          if (run) {
            const isOrigin = stopRow?.tipoFermata === "P";
            const scheduled =
              (isOrigin ? stopRow?.programmataDep : stopRow?.programmataArr)?.toISOString() ??
              run.orarioPartenza?.toISOString() ??
              null;
            const expected =
              (isOrigin ? stopRow?.actualDep : stopRow?.actualArr)?.toISOString() ??
              scheduled;
            worstTrain = {
              runId: run.id,
              numero: run.numero,
              categoria: run.categoria ?? "",
              origine: run.origine ?? "",
              destinazione: run.destinazione ?? "",
              dataPartenza: run.dataPartenza,
              scheduled,
              expected,
              delay: worstDelay,
              binarioProg: stopRow?.binarioProg ?? null,
              binarioReal: stopRow?.binarioReal ?? null,
              stato: statoFor(worstDelay, run.provvedimento ?? (worst.cancelled ? 1 : 0)),
              temporalStatus: "ended",
              orarioPartenza: run.orarioPartenza?.toISOString() ?? null,
              orarioArrivo: run.orarioArrivo?.toISOString() ?? null,
              lastRilevamento: run.lastRilevamentoAt?.toISOString() ?? null,
              lastRilevamentoStazione: run.lastRilevamentoStazione,
              runDate: worst.runDate,
            };
          } else {
            worstTrain = {
              runId: null,
              numero: worst.numero,
              categoria: "",
              origine: "",
              destinazione: "",
              dataPartenza: worst.runDate,
              scheduled: null,
              expected: null,
              delay: worstDelay,
              binarioProg: null,
              binarioReal: null,
              stato: statoFor(worstDelay, worst.cancelled ? 1 : 0),
              temporalStatus: "ended",
              orarioPartenza: null,
              orarioArrivo: null,
              lastRilevamento: null,
              lastRilevamentoStazione: null,
              runDate: worst.runDate,
            };
          }
        } catch {
          worstTrain = {
            runId: null,
            numero: worst.numero,
            categoria: "",
            origine: "",
            destinazione: "",
            dataPartenza: worst.runDate,
            scheduled: null,
            expected: null,
            delay: worstDelay,
            binarioProg: null,
            binarioReal: null,
            stato: statoFor(worstDelay, worst.cancelled ? 1 : 0),
            temporalStatus: "ended",
            orarioPartenza: null,
            orarioArrivo: null,
            lastRilevamento: null,
            lastRilevamentoStazione: null,
            runDate: worst.runDate,
          };
        }
      }
    }
    return {
      runs: rows.length,
      avgFinal: avg(finals),
      p95Final: percentile(finals, 95),
      maxFinal,
      avgMaxEnroute: 0,
      avgRecupero: 0,
      cancellRate: rows.length ? Math.round((cancelled / rows.length) * 1000) / 10 : 0,
      delayedCount,
      delayedRate: rows.length
        ? Math.round((delayedCount / rows.length) * 1000) / 10
        : 0,
      totalDelay,
      worstTrain,
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

  // Train/global scopes: bounded periods read the live `train_runs` hot
  // window (30d); "total"/"all" (sinceDate == null) reads the
  // `daily_train_stats` rollup instead, which is kept forever. Both are
  // normalized to the same shape so the aggregation below is shared.
  let rows: Array<{
    lastDelay: number | null;
    maxDelay: number | null;
    provvedimento: number | null;
    dataPartenza: string;
  }>;
  if (sinceDate == null) {
    const conds = [];
    if (scope === "train" && id) conds.push(eq(dailyTrainStats.numero, id));
    const rollup =
      conds.length > 0
        ? await database
            .select({
              lastDelay: dailyTrainStats.lastDelay,
              maxDelay: dailyTrainStats.maxDelay,
              provvedimento: dailyTrainStats.provvedimento,
              dataPartenza: dailyTrainStats.runDate,
            })
            .from(dailyTrainStats)
            .where(and(...conds))
        : await database
            .select({
              lastDelay: dailyTrainStats.lastDelay,
              maxDelay: dailyTrainStats.maxDelay,
              provvedimento: dailyTrainStats.provvedimento,
              dataPartenza: dailyTrainStats.runDate,
            })
            .from(dailyTrainStats);
    rows = rollup;
  } else {
    const conds = [];
    conds.push(gte(trainRuns.dataPartenza, sinceDate));
    if (scope === "train" && id) conds.push(eq(trainRuns.numero, id));
    rows = await database
      .select({
        lastDelay: trainRuns.lastDelay,
        maxDelay: trainRuns.maxDelay,
        provvedimento: trainRuns.provvedimento,
        dataPartenza: trainRuns.dataPartenza,
      })
      .from(trainRuns)
      .where(and(...conds));
  }

  const finals = rows.map((r) => r.lastDelay ?? 0).sort((a, b) => a - b);
  const maxes = rows.map((r) => r.maxDelay ?? r.lastDelay ?? 0);
  const cancelled = rows.filter((r) => (r.provvedimento ?? 0) === 1).length;
  const delayedCount = finals.filter((v) => v > DELAY_THRESHOLD).length;
  const totalDelay = finals.reduce((a, b) => a + b, 0);
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
    delayedCount,
    delayedRate: rows.length
      ? Math.round((delayedCount / rows.length) * 1000) / 10
      : 0,
    totalDelay,
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

/**
 * Panoramica nazionale per la home: media nazionale, regione con più ritardo
 * e incidenza % — tutto sul periodo richiesto ("1d" | "7d" | "30d" | "total",
 * alias di "24h"/"all" accettati).
 *
 * Attribuzione regione: ogni corsa conta una volta sola e viene attribuita
 * alla regione del suo ultimo rilevamento = ultima fermata con dato reale
 * (actual_arr/actual_dep, order_idx max); se nessuna, si ripiega sulla
 * stazione di origine. La regione "peggiore" è quella con la somma cumulata
 * di ritardi più alta nel periodo; soglia "in ritardo": last_delay > 0'.
 */
export async function fetchOverview(period: string): Promise<OverviewRes> {
  const national = await fetchStats("global", "", period);

  const database = db();
  if (!database) {
    return {
      period,
      dbConfigured: false,
      national,
      worstRegion: null,
      regions: [],
    };
  }

  const days = normalizePeriodDays(period);
  const sinceDate =
    days == null
      ? null
      : new Date(Date.now() - days * 24 * 3600 * 1000)
          .toISOString()
          .slice(0, 10);

  // Una riga per corsa: ritardo finale + regione dell'ultimo rilevamento.
  // Bounded periods read live `train_runs`+`stops`; "total"/"all" reads the
  // `daily_train_stats` rollup (region attribution frozen at rollup time),
  // which survives the 30-day `train_runs` retention window.
  // NB: con il driver neon-http `db.execute()` restituisce
  // FullQueryResults `{ rows: [...] }`, non un array diretto.
  type PerRunRow = {
    lastDelay: number | null;
    regionId: number | null;
    stationCode: string | null;
  };
  let perRun: PerRunRow[];
  if (sinceDate == null) {
    perRun = await database
      .select({
        lastDelay: dailyTrainStats.lastDelay,
        regionId: dailyTrainStats.regionId,
        stationCode: dailyTrainStats.regionStation,
      })
      .from(dailyTrainStats);
  } else {
    const rawPerRun = (await database.execute(sql`
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
    WHERE r.data_partenza >= ${sinceDate}
  `)) as unknown as Array<PerRunRow> | { rows: Array<PerRunRow> };
    perRun = Array.isArray(rawPerRun) ? rawPerRun : (rawPerRun.rows ?? []);
  }

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
      avgDelay: a.runs
        ? Math.round((a.total / a.runs) * 10) / 10
        : 0,
      maxDelay: a.max,
    }))
    .sort(
      (a, b) => b.totalDelay - a.totalDelay || b.delayedCount - a.delayedCount,
    );

  return {
    period,
    dbConfigured: true,
    national,
    worstRegion: regions[0] ?? null,
    regions: regions.slice(0, 6),
  };
}

export async function fetchNews(): Promise<
  NewsRes & { dbConfigured: boolean }
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
  const get = (k: string): unknown => byKind.get(k)?.payload ?? null;
  const rawTicker = get("ticker");
  const ticker = Array.isArray(rawTicker)
    ? rawTicker.filter((s): s is string => typeof s === "string")
    : [];
  const rawNews = get("news");
  const rawLavori = get("lavori");
  return {
    ticker,
    news: Array.isArray(rawNews) ? rawNews : [],
    lavori: Array.isArray(rawLavori) ? rawLavori : [],
    updatedAt:
      byKind.get("ticker")?.fetchedAt?.toISOString() ?? new Date().toISOString(),
    dbConfigured: true,
  };
}
