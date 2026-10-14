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

/**
 * Decode the wire payload into absolute-ms timelines. Times are clamped to
 * be monotonically non-decreasing per run (source glitches would otherwise
 * produce negative legs), and runs with < 2 usable points are dropped.
 */
export function decodeDay(raw: DayReplay): ReplayDay {
  const mid = raw.midnightMs;
  const runs: ReplayRun[] = [];
  let minMs = Infinity;
  let maxMs = -Infinity;

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
    if (startMs < minMs) minMs = startMs;
    if (endMs > maxMs) maxMs = endMs;
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

  if (!Number.isFinite(minMs)) {
    minMs = 0;
    maxMs = 0;
  }
  return {
    date: raw.date,
    dbConfigured: raw.dbConfigured,
    minMs,
    maxMs,
    stations: raw.stations,
    runs,
  };
}

/**
 * Trains on the move (or dwelling) at `nowMs`, shaped as `LiveTrain` so the
 * 3D map renders them through the exact same pipeline as the live view.
 * Cancelled runs carry no movement and are skipped.
 */
export function activeTrainsAt(day: ReplayDay, nowMs: number): LiveTrain[] {
  const out: LiveTrain[] = [];
  const stations = day.stations;

  for (const r of day.runs) {
    if (r.provvedimento === 1) continue; // cancelled: never travels
    if (nowMs < r.startMs || nowMs > r.endMs) continue;

    const tl = r.tl;
    let prevIdx = -1;
    let nextIdx = -1;
    let dwelling = false;
    for (let i = 0; i < tl.length; i++) {
      const a = tl[i][1];
      const d = tl[i][2];
      if (nowMs >= a && nowMs <= d) {
        prevIdx = i;
        nextIdx = i;
        dwelling = true;
        break;
      }
      if (i + 1 < tl.length && nowMs > d && nowMs <= tl[i + 1][1]) {
        prevIdx = i;
        nextIdx = i + 1;
        break;
      }
    }
    if (prevIdx < 0) continue;

    const prevStation = stations[tl[prevIdx][0]];
    const nextStation = stations[tl[nextIdx][0]];
    if (!prevStation || !nextStation) continue;

    const delay = tl[prevIdx][3] ?? 0;
    const stato = statoFor(delay, r.provvedimento);
    const prevT = dwelling ? tl[prevIdx][1] : tl[prevIdx][2];
    const nextT = dwelling ? tl[nextIdx][2] : tl[nextIdx][1];

    out.push({
      runId: r.runId,
      numero: r.numero,
      categoria: r.categoria,
      delay,
      stato,
      prev: { lat: prevStation[0], lon: prevStation[1], t: prevT },
      next: { lat: nextStation[0], lon: nextStation[1], t: nextT },
      updatedAt: "",
      origine: r.origine,
      destinazione: r.destinazione,
      nextStation: dwelling ? prevStation[2] : nextStation[2],
      exact: true,
    });
  }
  return out;
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
