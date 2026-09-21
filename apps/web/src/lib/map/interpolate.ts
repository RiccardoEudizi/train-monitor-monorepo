/**
 * Train movement from live polls.
 *
 * The poller upserts `stops` (current truth) every ~120s.
 * Between snapshots the client has only two anchors per train:
 *   prev — last stop with a real rilevamento (or origin departure)
 *   next — first upcoming stop (scheduled time)
 * Position at time `now` is the eased interpolation between them:
 *
 *   p_raw = clamp((now - tPrev) / (tNext - tPrev), 0, 1)
 *   p     = smootherstep(p_raw)          ← dwells at stations, cruises mid-leg
 *   pos   = lerp(prev.lat/lon, next.lat/lon, p)
 *
 * Waiting trains pin to prev, ended trains pin to next. Each animation
 * frame the rendered dot eases toward the target (`render += (target -
 * render) * k`) so the 12s SSE retargets never jump.
 */

export interface MapAnchor {
  lat: number;
  lon: number;
  /** epoch ms of the anchor event (actual or scheduled). */
  t: number;
}

export interface LiveTrain {
  runId: number;
  numero: string;
  categoria: string;
  delay: number;
  stato: string;
  prev: MapAnchor;
  next: MapAnchor;
  updatedAt: string;
}

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 6th-order smootherstep: flat ends (station dwell), steep middle. */
export function smootherstep(p: number): number {
  const x = clamp01(p);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export function rawProgress(nowMs: number, tPrev: number, tNext: number): number {
  if (!Number.isFinite(tPrev) || !Number.isFinite(tNext) || tNext <= tPrev) {
    return nowMs >= tNext ? 1 : 0;
  }
  return clamp01((nowMs - tPrev) / (tNext - tPrev));
}

export interface TrainPos {
  lat: number;
  lon: number;
  /** eased 0..1 along prev→next. */
  p: number;
}

export function trainPosition(train: LiveTrain, nowMs: number): TrainPos {
  const p = smootherstep(rawProgress(nowMs, train.prev.t, train.next.t));
  return {
    lat: train.prev.lat + (train.next.lat - train.prev.lat) * p,
    lon: train.prev.lon + (train.next.lon - train.prev.lon) * p,
    p,
  };
}

/** Per-frame easing toward the target (frame-rate independent). */
export function easeToward(
  current: number,
  target: number,
  dtMs: number,
  rate = 4,
): number {
  const k = 1 - Math.exp((-rate * dtMs) / 1000);
  return current + (target - current) * k;
}
