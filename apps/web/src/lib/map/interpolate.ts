/**
 * Train movement from live polls.
 *
 * The /map page polls `/api/map/live` every 12s (`POLL_MS`). Between
 * snapshots the client has only two anchors per train:
 *   prev — last stop with a real rilevamento (or origin departure)
 *   next — first upcoming stop (scheduled time)
 *
 * Motion model (dead-reckoning with velocity continuity):
 *
 * 1. Delay-aware leg: `tNextEff = next.t + delay*60_000` so late trains
 *    don't pin at p=1 before the next poll.
 * 2. Constant-speed profile: short dwells at both ends, trapezoid
 *    velocity (quadratic ramps, linear cruise) instead of a full-leg
 *    smootherstep that stalls near stations and rushes mid-leg.
 * 3. The renderer integrates `pos += vel * dt` every frame, so dots move
 *    continuously like real trains. Each 12s snapshot only bends the
 *    velocity: `vDesired = vCruise + clamp(err / POLL, 1.5 * cruise)`,
 *    blended with the current velocity. Position error bleeds away over
 *    the next poll interval instead of snapping.
 * 4. On leg change (anchors advance) the rendered point is projected
 *    onto the new segment — never reset to p=0.
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

/** Live poll interval of the /map page. */
export const POLL_MS = 12_000;
/** Station dwell at each end of a leg. */
export const DWELL_MS = 45_000;
/** Trapezoid ramp fraction (each end) of the cruise window. */
export const RAMP = 0.15;
/** Velocity-blend factor per poll (0..1). */
export const VEL_BLEND = 0.25;
/** Correction clamp, as a multiple of cruise speed. */
export const CORR_CLAMP = 1.5;

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 6th-order smootherstep (kept for compat / ramp shaping). */
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

/** Delay-aware effective anchor times for a train leg. */
export function effectiveTimes(train: LiveTrain): { tPrev: number; tNext: number } {
  const tPrev = train.prev.t;
  const delayMs = (Number.isFinite(train.delay) ? train.delay : 0) * 60_000;
  const tNext = train.next.t + delayMs;
  if (!(tNext > tPrev)) return { tPrev, tNext: tPrev + 60_000 };
  return { tPrev, tNext };
}

/**
 * Trapezoid position profile: quadratic ramps over RAMP at each end,
 * linear cruise in the middle. C1-continuous, constant mid-leg velocity.
 */
export function trapezoid(u: number, ramp = RAMP): number {
  const x = clamp01(u);
  const e = Math.min(Math.max(ramp, 0.01), 0.4);
  const v = 1 / (1 - e); // peak velocity (position units per unit u)
  if (x < e) return ((v * x * x) / (2 * e));
  if (x > 1 - e) {
    const d = 1 - x;
    return 1 - ((v * d * d) / (2 * e));
  }
  return v * (x - e / 2);
}

/** Derivative of `trapezoid` w.r.t. u (0..~1.18, 0 outside cruise). */
export function trapezoidDeriv(u: number, ramp = RAMP): number {
  const e = Math.min(Math.max(ramp, 0.01), 0.4);
  const v = 1 / (1 - e);
  if (u <= 0 || u >= 1) return 0;
  if (u < e) return (v * u) / e;
  if (u > 1 - e) return (v * (1 - u)) / e;
  return v;
}

export interface CruiseWindow {
  tPrev: number;
  tNext: number;
  dwell0: number;
  dwell1: number;
  cruiseDur: number;
}

/** Dwell-trimmed cruise window for a leg. */
export function cruiseWindow(tPrev: number, tNext: number): CruiseWindow {
  const legDur = Math.max(tNext - tPrev, 1);
  const dwell = Math.min(DWELL_MS, legDur * 0.2);
  const cruiseDur = Math.max(legDur - dwell * 2, legDur * 0.2);
  return {
    tPrev,
    tNext,
    dwell0: dwell,
    dwell1: dwell,
    cruiseDur,
  };
}

/**
 * Ideal 0..1 progress along prev→next at time `now`: dwell at both
 * ends, constant-speed cruise in between.
 */
export function idealProgress(train: LiveTrain, nowMs: number): number {
  const { tPrev, tNext } = effectiveTimes(train);
  const w = cruiseWindow(tPrev, tNext);
  const t0 = tPrev + w.dwell0;
  const t1 = tNext - w.dwell1;
  if (nowMs <= t0) return 0;
  if (nowMs >= t1) return 1;
  return trapezoid((nowMs - t0) / (t1 - t0));
}

export interface TrainPos {
  lat: number;
  lon: number;
  /** eased 0..1 along prev→next. */
  p: number;
}

export function trainPosition(train: LiveTrain, nowMs: number): TrainPos {
  const p = idealProgress(train, nowMs);
  return {
    lat: train.prev.lat + (train.next.lat - train.prev.lat) * p,
    lon: train.prev.lon + (train.next.lon - train.prev.lon) * p,
    p,
  };
}

/** Per-frame easing toward the target (frame-rate independent). Kept for compat. */
export function easeToward(
  current: number,
  target: number,
  dtMs: number,
  rate = 4,
): number {
  const k = 1 - Math.exp((-rate * dtMs) / 1000);
  return current + (target - current) * k;
}

// --- Dead-reckoning motion state (world-space, unit agnostic) ---

export interface MotionState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  legKey: string;
}

export function legKeyFor(train: LiveTrain): string {
  const { tPrev, tNext } = effectiveTimes(train);
  return `${tPrev}|${tNext}`;
}

/** Closest point on segment AB to P; returns projected point + s in 0..1. */
export function projectOntoLeg(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { x: number; z: number; s: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (!(len2 > 0)) return { x: ax, z: az, s: 0 };
  const s = clamp01(((px - ax) * dx + (pz - az) * dz) / len2);
  return { x: ax + dx * s, z: az + dz * s, s };
}

export interface LegFrame {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  idealX: number;
  idealZ: number;
  cruiseVX: number;
  cruiseVZ: number;
  cruiseSpeed: number;
}

/**
 * Ideal position + cruise velocity of a train in an arbitrary 2D plane
 * (caller passes world XZ endpoints). Cruise velocity is the analytic
 * derivative of the trapezoid profile — zero while dwelling.
 */
export function legFrame(
  train: LiveTrain,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  nowMs: number,
): LegFrame {
  const { tPrev, tNext } = effectiveTimes(train);
  const w = cruiseWindow(tPrev, tNext);
  const t0 = tPrev + w.dwell0;
  const t1 = tNext - w.dwell1;
  const span = Math.max(t1 - t0, 1);
  const u = clamp01((nowMs - t0) / span);
  const p = trapezoid(u);
  const idealX = ax + (bx - ax) * p;
  const idealZ = az + (bz - az) * p;
  // dp/dt in 1/ms, scaled to units/sec.
  const dpdt = (trapezoidDeriv(u) / span) * 1000;
  return {
    ax,
    az,
    bx,
    bz,
    idealX,
    idealZ,
    cruiseVX: (bx - ax) * dpdt,
    cruiseVZ: (bz - az) * dpdt,
    cruiseSpeed: Math.hypot(bx - ax, bz - az) * dpdt,
  };
}

/**
 * Retarget a train's motion state toward the latest snapshot. Runs every
 * frame (not just on polls): the position error is converted into a
 * bounded correction velocity so 12s retargets bend the trajectory
 * instead of jumping it.
 */
export function retargetMotion(
  prev: MotionState | undefined,
  train: LiveTrain,
  frame: LegFrame,
): MotionState {
  const key = legKeyFor(train);
  if (!prev || prev.legKey !== key) {
    // New train or advanced leg: continue from the projected position.
    const start = prev
      ? projectOntoLeg(prev.x, prev.z, frame.ax, frame.az, frame.bx, frame.bz)
      : { x: frame.idealX, z: frame.idealZ };
    const vx = prev && prev.legKey !== key ? prev.vx * 0.5 : frame.cruiseVX;
    const vz = prev && prev.legKey !== key ? prev.vz * 0.5 : frame.cruiseVZ;
    return { x: start.x, z: start.z, vx, vz, legKey: key };
  }
  const errX = frame.idealX - prev.x;
  const errZ = frame.idealZ - prev.z;
  const pollS = POLL_MS / 1000;
  let corrX = errX / pollS;
  let corrZ = errZ / pollS;
  const corrMag = Math.hypot(corrX, corrZ);
  const maxCorr = Math.max(frame.cruiseSpeed * CORR_CLAMP, 1e-6);
  if (corrMag > maxCorr && corrMag > 0) {
    const s = maxCorr / corrMag;
    corrX *= s;
    corrZ *= s;
  }
  const desVX = frame.cruiseVX + corrX;
  const desVZ = frame.cruiseVZ + corrZ;
  return {
    x: prev.x,
    z: prev.z,
    vx: prev.vx + (desVX - prev.vx) * VEL_BLEND,
    vz: prev.vz + (desVZ - prev.vz) * VEL_BLEND,
    legKey: key,
  };
}

/** Integrate motion forward by dt seconds. Pure — no snapping. */
export function stepMotion(s: MotionState, dtS: number): MotionState {
  const dt = Math.min(Math.max(dtS, 0), 0.25);
  return { ...s, x: s.x + s.vx * dt, z: s.z + s.vz * dt };
}
