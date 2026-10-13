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
import { DELAY_THRESHOLD } from "~/lib/thresholds";
import { aggregateByRegion, type PerRunRegion } from "~/lib/region-agg";
import { MAJOR_REGION_OVERRIDE, regionName } from "~/lib/regions";
import { searchSeed, seedByCode } from "~/lib/stations-seed";
import { db, dbConfigured } from "~/server/db";
import { logError } from "~/server/log";
import { periodSinceDate } from "~/server/period";
import { avg, emptyStats, maxValue, percentile, rate, toSeries } from "~/server/stats-shared";

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
    logError("stations query failed", e);
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

  // Hot window (exact, with stops) + per-run rollup (summary-only, kept
  // forever). Merged newest-first, hot rows winning over rollup dupes of
  // the same (origine, date) — today's runs exist in both. The rollup read
  // is best-effort: DBs without migrations 006/007 fall back to hot only
  // instead of 500ing the page.
  const liveRuns = await database
    .select()
    .from(trainRuns)
    .where(eq(trainRuns.numero, n))
    .orderBy(desc(trainRuns.dataPartenza))
    .limit(60);
  let rollupRuns: (typeof dailyTrainStats.$inferSelect)[] = [];
  try {
    rollupRuns = await database
      .select()
      .from(dailyTrainStats)
      .where(eq(dailyTrainStats.numero, n))
      .orderBy(desc(dailyTrainStats.runDate))
      .limit(60);
  } catch (e) {
    logError("daily_train_stats read failed, hot-window only", e);
  }

  if (liveRuns.length === 0 && rollupRuns.length === 0) {
    return { ...empty, dbConfigured: true };
  }

  const seen = new Set(
    liveRuns.map((r) => `${r.origineCode}|${r.dataPartenza}`),
  );
  type MergedRun = {
    runId: number | null;
    origine: string;
    origineCode: string;
    destinazione: string;
    dataPartenza: string;
    orarioPartenza: Date | null;
    orarioArrivo: Date | null;
    lastDelay: number;
    maxDelay: number;
    provvedimento: number;
    hot: boolean;
  };
  const merged: MergedRun[] = liveRuns.map((r) => ({
    runId: r.id,
    origine: r.origine ?? "",
    origineCode: r.origineCode,
    destinazione: r.destinazione ?? "",
    dataPartenza: r.dataPartenza,
    orarioPartenza: r.orarioPartenza,
    orarioArrivo: r.orarioArrivo,
    lastDelay: r.lastDelay ?? 0,
    maxDelay: r.maxDelay ?? r.lastDelay ?? 0,
    provvedimento: r.provvedimento ?? 0,
    hot: true,
  }));
  for (const r of rollupRuns) {
    if (seen.has(`${r.origineCode}|${r.runDate}`)) continue;
    merged.push({
      runId: null,
      origine: r.origine ?? "",
      origineCode: r.origineCode,
      destinazione: r.destinazione ?? "",
      dataPartenza: r.runDate,
      orarioPartenza: null,
      orarioArrivo: null,
      lastDelay: r.lastDelay ?? 0,
      maxDelay: r.maxDelay ?? r.lastDelay ?? 0,
      provvedimento: r.provvedimento ?? 0,
      hot: false,
    });
  }
  merged.sort((a, b) => b.dataPartenza.localeCompare(a.dataPartenza));
  const capped = merged.slice(0, 60);
  const hotById = new Map(liveRuns.map((r) => [r.id, r]));

  const run =
    capped.find(
      (r) =>
        (!origine || r.origineCode === origine) &&
        (!date || r.dataPartenza === date),
    ) ?? capped[0];
  const hotRow = run.hot ? (hotById.get(run.runId as number) ?? null) : null;

  const stopRows =
    hotRow != null
      ? await database
          .select()
          .from(stops)
          .where(eq(stops.runId, hotRow.id))
          .orderBy(stops.orderIdx)
      : [];

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

  // Per-run delay summary over hot runs (single extra query).
  // avgDelay = mean of max(delayArr, delayDep) across stops with actual
  // data; falls back to 0 when the run has no actuals yet.
  const hotIds = capped.filter((m) => m.hot).map((m) => m.runId as number);
  const allStops =
    hotIds.length > 0
      ? await database
          .select({
            runId: stops.runId,
            delayArr: stops.delayArr,
            delayDep: stops.delayDep,
            actualArr: stops.actualArr,
            actualDep: stops.actualDep,
          })
          .from(stops)
          .where(inArray(stops.runId, hotIds))
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
  // Pruned runs have no stops rows: approximate the summary from the
  // per-stop rollup (mean of station finals + stop count), one query.
  // Same train number ⇒ single numero filter + date list.
  const coldDates = [
    ...new Set(capped.filter((m) => !m.hot).map((m) => m.dataPartenza)),
  ];
  const coldAvg = new Map<string, { avg: number; n: number }>();
  if (coldDates.length > 0) {
    const avgRows = await database
      .select({
        date: dailyStopStats.runDate,
        avg: sql<number>`avg(${dailyStopStats.delayArrFinal})`,
        n: sql<number>`count(*)`,
      })
      .from(dailyStopStats)
      .where(
        and(
          eq(dailyStopStats.numero, n),
          inArray(dailyStopStats.runDate, coldDates),
        ),
      )
      .groupBy(dailyStopStats.runDate);
    for (const r of avgRows) {
      const v = Number(r.avg);
      coldAvg.set(r.date, {
        avg: Number.isFinite(v) ? Math.round(v * 10) / 10 : 0,
        n: Number(r.n) || 0,
      });
    }
  }
  const runSummaries = capped.map((r) => {
    let avgDelay: number;
    let stopCount: number;
    if (r.hot) {
      const vals = delaysByRun.get(r.runId as number) ?? [];
      avgDelay =
        vals.length > 0
          ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
          : 0;
      stopCount = countByRun.get(r.runId as number) ?? 0;
    } else {
      const c = coldAvg.get(r.dataPartenza);
      avgDelay = c?.avg ?? r.lastDelay;
      stopCount = c?.n ?? 0;
    }
    return {
      runId: r.runId,
      origine: r.origine,
      origineCode: r.origineCode,
      destinazione: r.destinazione,
      dataPartenza: r.dataPartenza,
      orarioPartenza: r.orarioPartenza?.toISOString() ?? null,
      orarioArrivo: r.orarioArrivo?.toISOString() ?? null,
      avgDelay,
      lastDelay: r.lastDelay,
      maxDelay: r.maxDelay,
      stops: stopCount,
      provvedimento: r.provvedimento,
      stato: statoFor(r.lastDelay, r.provvedimento),
    };
  });

  const candidates = capped.map((r) => ({
    numero: n,
    origine: r.origine,
    origineCode: r.origineCode,
    dataPartenza: r.dataPartenza,
  }));

  if (hotRow == null) {
    // Pruned run selected: summary-only card, no live data or stops.
    return {
      candidates,
      runs: runSummaries,
      live: {
        runId: null,
        numero: n,
        categoria: "",
        origine: run.origine,
        destinazione: run.destinazione,
        dataPartenza: run.dataPartenza,
        scheduled: null,
        expected: null,
        delay: run.lastDelay,
        binarioProg: null,
        binarioReal: null,
        stato: statoFor(run.lastDelay, run.provvedimento),
        temporalStatus: "unknown" as const,
        orarioPartenza: null,
        orarioArrivo: null,
        lastRilevamento: null,
        lastRilevamentoStazione: null,
      },
      stops: [],
      dbConfigured: true,
    };
  }

  const hotDelay = hotRow.lastDelay ?? 0;
  const hotStato = statoFor(hotDelay, hotRow.provvedimento ?? 0);
  const hotTemporal = temporalStatus(hotRow.orarioPartenza?.toISOString() ?? null, hotRow.orarioArrivo?.toISOString() ?? null, new Date(), hotDelay);

  return {
    candidates,
    runs: runSummaries,
    live: {
      runId: hotRow.id,
      numero: hotRow.numero,
      categoria: hotRow.categoria ?? "",
      origine: hotRow.origine ?? "",
      destinazione: hotRow.destinazione ?? "",
      dataPartenza: hotRow.dataPartenza,
      scheduled: hotRow.orarioPartenza?.toISOString() ?? null,
      expected: hotRow.orarioArrivo?.toISOString() ?? null,
      delay: hotDelay,
      binarioProg: null,
      binarioReal: null,
      stato: hotStato,
      temporalStatus: hotTemporal,
      orarioPartenza: hotRow.orarioPartenza?.toISOString() ?? null,
      orarioArrivo: hotRow.orarioArrivo?.toISOString() ?? null,
      lastRilevamento: hotRow.lastRilevamentoAt?.toISOString() ?? null,
      lastRilevamentoStazione: hotRow.lastRilevamentoStazione,
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

export async function fetchStats(
  scope: string,
  id: string,
  period: string,
): Promise<PeriodStats & { dbConfigured: boolean; period: string }> {
  const sinceDate = periodSinceDate(period);

  const database = db();
  if (!database) {
    return { ...emptyStats, dbConfigured: false, period };
  }

  if (scope === "global") {
    try {
      return await fetchGlobalStatsSQL(period);
    } catch (e) {
      logError("global stats SQL failed, falling back to row scan", e);
    }
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
    const maxFinal = maxValue(maxes);
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
      cancellRate: rate(cancelled, rows.length),
      delayedCount,
      delayedRate: rate(delayedCount, rows.length),
      totalDelay,
      worstTrain,
      series: toSeries(byDay),
      dbConfigured: true,
      period,
    };
  }

  // Train/global scopes: bounded periods read the live `train_runs` hot
  // window (30d); "total"/"all" (sinceDate == null) reads the
  // `daily_train_stats` rollup instead, which is kept forever. Both are
  // normalized to the same shape so the aggregation below is shared.
  // The rollup read is best-effort: DBs without migrations 006/007 fall
  // back to the hot window instead of 500ing.
  let rows: Array<{
    lastDelay: number | null;
    maxDelay: number | null;
    provvedimento: number | null;
    dataPartenza: string;
  }> | null = null;
  if (sinceDate == null) {
    try {
      const conds = [];
      if (scope === "train" && id) conds.push(eq(dailyTrainStats.numero, id));
      rows =
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
    } catch (e) {
      logError("daily_train_stats read failed, falling back to train_runs", e);
    }
  }
  if (rows == null) {
    const conds = [];
    if (sinceDate) conds.push(gte(trainRuns.dataPartenza, sinceDate));
    if (scope === "train" && id) conds.push(eq(trainRuns.numero, id));
    rows =
      conds.length > 0
        ? await database
            .select({
              lastDelay: trainRuns.lastDelay,
              maxDelay: trainRuns.maxDelay,
              provvedimento: trainRuns.provvedimento,
              dataPartenza: trainRuns.dataPartenza,
            })
            .from(trainRuns)
            .where(and(...conds))
        : await database
            .select({
              lastDelay: trainRuns.lastDelay,
              maxDelay: trainRuns.maxDelay,
              provvedimento: trainRuns.provvedimento,
              dataPartenza: trainRuns.dataPartenza,
            })
            .from(trainRuns);
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
    maxFinal: maxValue(finals),
    avgMaxEnroute: avg(maxes),
    avgRecupero: Math.round(recupero * 10) / 10,
    cancellRate: rate(cancelled, rows.length),
    delayedCount,
    delayedRate: rate(delayedCount, rows.length),
    totalDelay,
    series: toSeries(byDay),
    dbConfigured: true,
    period,
  };
}

/** neon-http `db.execute()` returns `{ rows }`; plain arrays elsewhere. */
function rowsOf<T>(raw: unknown): T[] {
  return Array.isArray(raw) ? (raw as T[]) : ((raw as { rows?: T[] }).rows ?? []);
}

/**
 * Region delay aggregates for the choropleth / overview ranking, computed in
 * SQL. Returns ~20 rows instead of the 137k per-run rows the old path shipped
 * over neon-http (~15-23s). Region attribution mirrors resolveRegion exactly:
 * the frozen region_id wins when set, otherwise the major-station override
 * (passed as a JSON map) — non-major 0/NULL rows are dropped.
 *
 * Falls back to the per-run scan + aggregateByRegion only if the SQL fails.
 */
export async function fetchRegionStats(period: string): Promise<RegionStat[]> {
  const database = db();
  if (!database) return [];
  const sinceDate = periodSinceDate(period);
  const override = JSON.stringify(Object.fromEntries(MAJOR_REGION_OVERRIDE));

  try {
    const raw = await database.execute(sql`
      WITH resolved AS (
        SELECT
          CASE
            WHEN d.region_id IS NOT NULL AND d.region_id <> 0 THEN d.region_id
            WHEN d.region_station IS NULL THEN NULL
            ELSE ((${override}::jsonb) ->> d.region_station)::int
          END AS region_id,
          COALESCE(d.last_delay, 0) AS delay
        FROM daily_train_stats d
        ${sinceDate ? sql`WHERE d.run_date >= ${sinceDate}` : sql``}
      )
      SELECT region_id,
             count(*)::int AS runs,
             count(*) FILTER (WHERE delay > ${DELAY_THRESHOLD})::int AS delayed,
             COALESCE(sum(delay), 0)::int AS total,
             COALESCE(max(delay), 0)::int AS max
      FROM resolved
      WHERE region_id IS NOT NULL
      GROUP BY region_id
      ORDER BY total DESC, delayed DESC
    `);
    return rowsOf<{
      region_id: number;
      runs: number;
      delayed: number;
      total: number;
      max: number;
    }>(raw).map((r) => ({
      regionId: r.region_id,
      name: regionName(r.region_id),
      runs: r.runs,
      delayedCount: r.delayed,
      totalDelay: r.total,
      avgDelay: r.runs ? Math.round((r.total / r.runs) * 10) / 10 : 0,
      maxDelay: r.max,
    }));
  } catch (e) {
    logError("region stats SQL failed, falling back to row scan", e);
  }

  return aggregateByRegion(await fetchPerRunRegion(period));
}

/**
 * National period stats computed in SQL: one aggregate row + one row per day,
 * instead of shipping every run (137k rows, ~15-23s) to Node to fold in JS.
 *
 * Source matches the previous behaviour: bounded periods read the live
 * `train_runs` hot window, "total"/"all" reads the forever `daily_train_stats`
 * rollup. The math mirrors stats-shared (avg/rate/percentile rounded the same).
 */
async function fetchGlobalStatsSQL(
  period: string,
): Promise<PeriodStats & { dbConfigured: boolean; period: string }> {
  const database = db();
  if (!database) return { ...emptyStats, dbConfigured: false, period };

  const sinceDate = periodSinceDate(period);
  const table = sinceDate ? trainRuns : dailyTrainStats;
  const delay = sinceDate ? trainRuns.lastDelay : dailyTrainStats.lastDelay;
  const maxDelay = sinceDate ? trainRuns.maxDelay : dailyTrainStats.maxDelay;
  const provvedimento = sinceDate ? trainRuns.provvedimento : dailyTrainStats.provvedimento;
  const dateCol = sinceDate ? trainRuns.dataPartenza : dailyTrainStats.runDate;
  const where = sinceDate ? sql`WHERE ${dateCol} >= ${sinceDate}` : sql``;

  const aggRaw = await database.execute(sql`
    SELECT
      count(*)::int AS runs,
      COALESCE(sum(COALESCE(${delay}, 0)), 0)::int AS total_delay,
      count(*) FILTER (WHERE COALESCE(${delay}, 0) > ${DELAY_THRESHOLD})::int AS delayed_count,
      count(*) FILTER (WHERE ${provvedimento} = 1)::int AS cancelled,
      COALESCE(round(avg(COALESCE(${delay}, 0)), 1), 0)::float8 AS avg_final,
      COALESCE(max(COALESCE(${delay}, 0)), 0)::int AS max_final,
      COALESCE(percentile_disc(0.95) WITHIN GROUP (ORDER BY COALESCE(${delay}, 0)), 0)::int AS p95_final,
      COALESCE(round(avg(COALESCE(${maxDelay}, ${delay}, 0)), 1), 0)::float8 AS avg_max
    FROM ${table} ${where}
  `);
  const a = rowsOf<{
    runs: number;
    total_delay: number;
    delayed_count: number;
    cancelled: number;
    avg_final: number;
    max_final: number;
    p95_final: number;
    avg_max: number;
  }>(aggRaw)[0];

  const seriesRaw = await database.execute(sql`
    SELECT ${dateCol}::text AS date,
           count(*)::int AS runs,
           COALESCE(round(avg(COALESCE(${delay}, 0)), 1), 0)::float8 AS avg_final,
           COALESCE(max(COALESCE(${delay}, 0)), 0)::int AS max_final
    FROM ${table} ${where}
    GROUP BY ${dateCol}
    ORDER BY ${dateCol}
  `);
  const series = rowsOf<{
    date: string;
    runs: number;
    avg_final: number;
    max_final: number;
  }>(seriesRaw).map((r) => ({
    date: r.date,
    avgFinal: r.avg_final,
    maxFinal: r.max_final,
    runs: r.runs,
  }));

  const runs = a?.runs ?? 0;
  const avgFinal = a?.avg_final ?? 0;
  const avgMaxEnroute = a?.avg_max ?? 0;

  return {
    runs,
    avgFinal,
    p95Final: a?.p95_final ?? 0,
    maxFinal: a?.max_final ?? 0,
    avgMaxEnroute,
    // avg() rounds each side to 1dp before subtracting, as before.
    avgRecupero: Math.round((avgMaxEnroute - avgFinal) * 10) / 10,
    cancellRate: rate(a?.cancelled ?? 0, runs),
    delayedCount: a?.delayed_count ?? 0,
    delayedRate: rate(a?.delayed_count ?? 0, runs),
    totalDelay: a?.total_delay ?? 0,
    worstTrain: null,
    series,
    dbConfigured: true,
    period,
  };
}

/**
 * Per-run delay + region for a period, feeding the region aggregations
 * (fetchOverview, fetchMapRegions).
 *
 * Reads the `daily_train_stats` rollup: one indexed scan over a table that
 * already carries `last_delay` + `region_id` + `region_station` per run, with
 * region attribution frozen at rollup time and kept forever. This replaces the
 * live `train_runs ⨯ stops` last-stop lateral, which seq-scanned `stations`
 * once per run and took ~70s over the 30-day window (the rollup read is ~40ms).
 *
 * Falls back to the live hot window only if the rollup read fails (e.g. a DB
 * without migrations 006/007). The fallback keeps the `stations` join OUTSIDE
 * the lateral so it uses the `stations_code_key` index instead of a per-run
 * seq scan.
 */
export async function fetchPerRunRegion(period: string): Promise<PerRunRegion[]> {
  const database = db();
  if (!database) return [];
  const sinceDate = periodSinceDate(period);

  try {
    return (await database
      .select({
        lastDelay: dailyTrainStats.lastDelay,
        regionId: dailyTrainStats.regionId,
        stationCode: dailyTrainStats.regionStation,
      })
      .from(dailyTrainStats)
      .where(
        sinceDate ? gte(dailyTrainStats.runDate, sinceDate) : undefined,
      )) as PerRunRegion[];
  } catch (e) {
    logError("daily_train_stats read failed, falling back to train_runs", e);
  }

  // NB: con il driver neon-http `db.execute()` restituisce
  // FullQueryResults `{ rows: [...] }`, non un array diretto.
  const rawPerRun = (await database.execute(sql`
    SELECT r.last_delay AS "lastDelay",
           COALESCE(reg.region_id, so.region_id) AS "regionId",
           COALESCE(sl.code, so.code) AS "stationCode"
    FROM train_runs r
    LEFT JOIN LATERAL (
      SELECT st.station_code AS code
      FROM stops st
      WHERE st.run_id = r.id
        AND (st.actual_arr IS NOT NULL OR st.actual_dep IS NOT NULL)
      ORDER BY st.order_idx DESC
      LIMIT 1
    ) sl ON true
    LEFT JOIN stations reg ON reg.code = sl.code
    LEFT JOIN stations so ON so.code = r.origine_code
    ${sinceDate ? sql`WHERE r.data_partenza >= ${sinceDate}` : sql``}
  `)) as unknown as PerRunRegion[] | { rows: PerRunRegion[] };
  return Array.isArray(rawPerRun) ? rawPerRun : (rawPerRun.rows ?? []);
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

  const sinceDate = periodSinceDate(period);

  // Una riga per corsa: ritardo finale + regione dell'ultimo rilevamento.
  // Aggregated in SQL (see fetchRegionStats) instead of shipping every run.
  const regions = await fetchRegionStats(period);

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
