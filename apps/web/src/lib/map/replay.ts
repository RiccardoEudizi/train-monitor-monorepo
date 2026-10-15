/**
 * Historical day replay.
 *
 * The server ships one compact dataset per day (~9.5k runs, ~1.9 MB raw):
 * times are integer MINUTES since Europe/Rome midnight and stations are
 * dense-ranked by code, so runs reference them by index. `decodeDay` turns
 * that into absolute epoch-ms timelines once; after that playback is fully
 * client-side and seeking is instant.
 *
 * Positions reuse the live motion model (~/lib/map/interpolate): a train
 * active at time T is emitted as a `LiveTrain` whose prev/next anchors are
 * its current leg, with `exact: true` so `effectiveTimes` does not re-apply
 * the delay (the anchors already are actual times).
 */

import { statoFor, type TrainStato } from "~/lib/api-types";
import type { LiveTrain } from "~/lib/map/interpolate";

/** Available replay days (from the 30-day hot window). */
export interface ReplayDayInfo {
  date: string;
  runs: number;
}

export interface ReplayDaysRes {
  dbConfigured: boolean;
  days: ReplayDayInfo[];
}

/** Wire shape of one run. `tl` = [stationIdx, arrMin, depMin, delay]. */
export interface DayReplayRun {
  runId: number;
  numero: string;
  categoria: string;
  origine: string;
  destinazione: string;
  provvedimento: number;
  delay: number;
  tl: number[][];
}

/** Wire shape of a whole day (server → client). */
export interface DayReplay {
  date: string;
  dbConfigured: boolean;
  midnightMs: number;
  minMin: number;
  maxMin: number;
  stations: Array<[number, number, string]>;
  runs: DayReplayRun[];
}

/** Decoded run: `tl` = [stationIdx, arrMs, depMs, delay] absolute epoch ms. */
export interface ReplayRun {
  runId: number;
  numero: string;
  categoria: string;
  origine: string;
  destinazione: string;
  provvedimento: number;
  delay: number;
  startMs: number;
  endMs: number;
  tl: Array<[number, number, number, number]>;
}

export interface ReplayDay {
  date: string;
  dbConfigured: boolean;
  minMs: number;
  maxMs: number;
  stations: Array<[number, number, string]>;
  runs: ReplayRun[];
}

/** One arrival/departure event for the sidebar feed. */
export interface ReplayEvent {
  kind: "dep" | "arr";
  runId: number;
  numero: string;
  categoria: string;
  origine: string;
  destinazione: string;
  station: string;
  tMs: number;
  delay: number;
  stato: TrainStato;
}

const MIN_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Decode the wire payload into absolute-ms timelines. Times are clamped to
 * be monotonically non-decreasing per run (source glitches would otherwise
 * produce negative legs), and runs with < 2 usable points are dropped.
 */
export function decodeDay(raw: DayReplay): ReplayDay {
  const mid = raw.midnightMs;
  const runs: ReplayRun[] = [];

  for (const r of raw.runs) {
    const tl: ReplayRun["tl"] = [];
    let prevDep = -Infinity;
    for (const e of r.tl) {
      const si = e[0] | 0;
      let a = e[1];
      let d = e[2];
      if (a == null && d == null) continue;
      if (a == null) a = d;
      if (d == null) d = a;
      if (a < prevDep) a = prevDep;
      if (d < a) d = a;
      prevDep = d;
      tl.push([si, mid + a * MIN_MS, mid + d * MIN_MS, e[3] | 0]);
    }
    if (tl.length < 2) continue;
    const startMs = tl[0][1];
    const endMs = tl[tl.length - 1][2];
    if (!(endMs > startMs)) continue;
    runs.push({
      runId: r.runId,
      numero: r.numero,
      categoria: r.categoria,
      origine: r.origine,
      destinazione: r.destinazione,
      provvedimento: r.provvedimento,
      delay: r.delay,
      startMs,
      endMs,
      tl,
    });
  }

  // Playback window is exactly the calendar day: 00:00 → 23:59 (night trains
  // that run past midnight simply stop at the end of the day).
  const minMs = mid;
  const maxMs = mid > 0 ? mid + DAY_MS - MIN_MS : 0;
  return {
    date: raw.date,
    dbConfigured: raw.dbConfigured,
    minMs,
    maxMs,
    stations: raw.stations,
    runs,
  };
}

interface LegIndices {
  prevIdx: number;
  nextIdx: number;
  dwelling: boolean;
}

/** Locate the leg a run is on at `nowMs`, or null when it is off-service. */
function findLeg(tl: ReplayRun["tl"], nowMs: number): LegIndices | null {
  for (let i = 0; i < tl.length; i++) {
    const a = tl[i][1];
    const d = tl[i][2];
    if (nowMs >= a && nowMs <= d) {
      return { prevIdx: i, nextIdx: i, dwelling: true };
    }
    if (i + 1 < tl.length && nowMs > d && nowMs <= tl[i + 1][1]) {
      return { prevIdx: i, nextIdx: i + 1, dwelling: false };
    }
  }
  return null;
}

/**
 * Trains on the move (or dwelling) at `nowMs`, shaped as `LiveTrain` so the
 * 3D map renders them through the exact same pipeline as the live view.
 * Cancelled runs carry no movement and are skipped.
 */
export function activeTrainsAt(day: ReplayDay, nowMs: number): LiveTrain[] {
  const out: LiveTrain[] = [];
  for (const r of day.runs) {
    if (r.provvedimento === 1) continue; // cancelled: never travels
    if (nowMs < r.startMs || nowMs > r.endMs) continue;
    const leg = findLeg(r.tl, nowMs);
    if (!leg) continue;
    const prevStation = day.stations[r.tl[leg.prevIdx][0]];
    const nextStation = day.stations[r.tl[leg.nextIdx][0]];
    if (!prevStation || !nextStation) continue;
    out.push(
      makeTrain(r, leg, prevStation, nextStation, {
        runId: r.runId,
        numero: r.numero,
        categoria: r.categoria,
        delay: 0,
        stato: "ok",
        prev: { lat: 0, lon: 0, t: 0 },
        next: { lat: 0, lon: 0, t: 0 },
        updatedAt: "",
        origine: r.origine,
        destinazione: r.destinazione,
        nextStation: "",
        exact: true,
      }),
    );
  }
  return out;
}

/**
 * Per-frame feed for the 3D map: same result as `activeTrainsAt` but the
 * array and its train objects are reused between calls (no per-frame
 * allocation), and the map consumes them synchronously. This is what makes
 * the dots move continuously at any playback speed.
 */
export function createReplayFeed(
  day: ReplayDay,
): (nowMs: number) => LiveTrain[] {
  const pool = new Map<number, LiveTrain>();
  const out: LiveTrain[] = [];
  return (nowMs: number) => {
    let n = 0;
    for (const r of day.runs) {
      if (r.provvedimento === 1) continue;
      if (nowMs < r.startMs || nowMs > r.endMs) continue;
      const leg = findLeg(r.tl, nowMs);
      if (!leg) continue;
      const prevStation = day.stations[r.tl[leg.prevIdx][0]];
      const nextStation = day.stations[r.tl[leg.nextIdx][0]];
      if (!prevStation || !nextStation) continue;
      let t = pool.get(r.runId);
      if (!t) {
        t = {
          runId: r.runId,
          numero: r.numero,
          categoria: r.categoria,
          delay: 0,
          stato: "ok",
          prev: { lat: 0, lon: 0, t: 0 },
          next: { lat: 0, lon: 0, t: 0 },
          updatedAt: "",
          origine: r.origine,
          destinazione: r.destinazione,
          nextStation: "",
          exact: true,
        };
        pool.set(r.runId, t);
      }
      makeTrain(r, leg, prevStation, nextStation, t);
      out[n++] = t;
    }
    out.length = n;
    return out;
  };
}

/** Fill (or create) a `LiveTrain` for a resolved leg. */
function makeTrain(
  r: ReplayRun,
  leg: LegIndices,
  prevStation: [number, number, string],
  nextStation: [number, number, string],
  t: LiveTrain,
): LiveTrain {
  const delay = r.tl[leg.prevIdx][3] ?? 0;
  t.runId = r.runId;
  t.numero = r.numero;
  t.categoria = r.categoria;
  t.delay = delay;
  t.stato = statoFor(delay, r.provvedimento);
  t.origine = r.origine;
  t.destinazione = r.destinazione;
  t.exact = true;
  t.prev.lat = prevStation[0];
  t.prev.lon = prevStation[1];
  t.prev.t = leg.dwelling ? r.tl[leg.prevIdx][1] : r.tl[leg.prevIdx][2];
  t.next.lat = nextStation[0];
  t.next.lon = nextStation[1];
  t.next.t = leg.dwelling ? r.tl[leg.nextIdx][2] : r.tl[leg.nextIdx][1];
  t.nextStation = leg.dwelling ? prevStation[2] : nextStation[2];
  return t;
}

/**
 * Arrivals/departures in `(nowMs - lookbackMs, nowMs]`, newest first.
 * Scans the (small) per-run timelines on demand instead of materialising a
 * ~200k-entry event index in memory.
 */
export function eventsAround(
  day: ReplayDay,
  nowMs: number,
  lookbackMs: number,
  limit = 40,
): ReplayEvent[] {
  const from = nowMs - lookbackMs;
  const out: ReplayEvent[] = [];
  for (const r of day.runs) {
    if (r.provvedimento === 1) continue;
    if (r.endMs <= from || r.startMs > nowMs) continue;
    for (const [si, a, d, del] of r.tl) {
      const station = day.stations[si];
      if (!station) continue;
      if (d > from && d <= nowMs) {
        out.push(makeEvent("dep", r, station[2], d, del));
      }
      if (a > from && a <= nowMs) {
        out.push(makeEvent("arr", r, station[2], a, del));
      }
    }
  }
  out.sort((x, y) => y.tMs - x.tMs);
  return out.length > limit ? out.slice(0, limit) : out;
}

function makeEvent(
  kind: "dep" | "arr",
  r: ReplayRun,
  station: string,
  tMs: number,
  delay: number,
): ReplayEvent {
  return {
    kind,
    runId: r.runId,
    numero: r.numero,
    categoria: r.categoria,
    origine: r.origine,
    destinazione: r.destinazione,
    station,
    tMs,
    delay,
    stato: statoFor(delay, r.provvedimento),
  };
}
