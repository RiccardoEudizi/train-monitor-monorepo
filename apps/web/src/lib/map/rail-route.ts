/**
 * Shared rail-route shape and sampling. Kept separate from the router so the
 * renderer can sample routes without bundling the (worker-only) graph code.
 */

export interface RailRoute {
  /** World XZ vertices. */
  xs: Float64Array;
  zs: Float64Array;
  /** Cumulative arc-length fraction per vertex (0 … 1). */
  cum: Float64Array;
  /** Total length in world units. */
  total: number;
}

export interface RouteSample {
  x: number;
  z: number;
  /** Unit tangent (world XZ). */
  tx: number;
  tz: number;
  /** Route length in world units. */
  len: number;
}

/** Sample a route at progress `p` (0…1) by arc length. */
export function routeSample(r: RailRoute, p: number): RouteSample {
  const n = r.xs.length;
  if (n === 0) return { x: 0, z: 0, tx: 1, tz: 0, len: 0 };
  if (n === 1) return { x: r.xs[0], z: r.zs[0], tx: 1, tz: 0, len: r.total };
  const t = p <= 0 ? 0 : p >= 1 ? 1 : p;
  let lo = 0;
  let hi = n - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (r.cum[mid] <= t) lo = mid;
    else hi = mid;
  }
  const c0 = r.cum[lo];
  const c1 = r.cum[hi];
  const f = c1 > c0 ? (t - c0) / (c1 - c0) : 0;
  const dx = r.xs[hi] - r.xs[lo];
  const dz = r.zs[hi] - r.zs[lo];
  const segLen = Math.hypot(dx, dz);
  return {
    x: r.xs[lo] + dx * f,
    z: r.zs[lo] + dz * f,
    tx: segLen > 0 ? dx / segLen : 1,
    tz: segLen > 0 ? dz / segLen : 0,
    len: r.total,
  };
}
