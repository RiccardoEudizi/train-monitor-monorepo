/**
 * Main-thread client for the rail router worker.
 *
 * `route()` is synchronous: it returns a cached route or null (and asks the
 * worker to compute it) so the render loop never blocks. Requests are
 * de-duplicated by station pair; results are cached for the session.
 */

import { MAP_BOUNDS } from "~/lib/map/italy-regions";
import { WORLD } from "~/lib/map/map-projection";
import type { RailRoute } from "~/lib/map/rail-route";
import type { RailwaySegment } from "~/lib/map/italy-railways";

interface RouteReply {
  type: "route";
  key: string;
  route: RailRoute | null;
}

export class RailClient {
  private worker: Worker | null = null;
  private cache = new Map<string, RailRoute | null>();
  private pending = new Set<string>();
  private initSent = false;

  /** Build the graph in the worker. Safe to call once; no-op after. */
  init(segments: RailwaySegment[]): void {
    if (this.worker || this.initSent || segments.length === 0) return;
    this.initSent = true;
    try {
      this.worker = new Worker(new URL("./rail-worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      this.worker = null;
      return;
    }
    this.worker.onmessage = (e: MessageEvent<RouteReply>) => {
      const m = e.data;
      if (m.type === "route") {
        this.cache.set(m.key, m.route ?? null);
        this.pending.delete(m.key);
      }
    };
    this.worker.onerror = () => {
      this.worker = null;
    };

    // Flatten all geometries into transferable typed arrays so the hand-off
    // is zero-copy (a structured clone of ~170k points would stall a frame).
    let count = 0;
    for (const s of segments) count += s.geom.length;
    const lons = new Float64Array(count);
    const lats = new Float64Array(count);
    const offsets = new Uint32Array(segments.length + 1);
    let k = 0;
    for (let i = 0; i < segments.length; i++) {
      offsets[i] = k;
      for (const [lo, la] of segments[i].geom) {
        lons[k] = lo;
        lats[k] = la;
        k++;
      }
    }
    offsets[segments.length] = k;

    this.worker.postMessage(
      { type: "init", lons, lats, offsets, bounds: MAP_BOUNDS, world: WORLD },
      [lons.buffer, lats.buffer, offsets.buffer],
    );
  }

  /** Cached route, or null while it is being computed (caller falls back). */
  route(aLon: number, aLat: number, bLon: number, bLat: number): RailRoute | null {
    const key = `${Math.round(aLon * 1e5)},${Math.round(aLat * 1e5)}|${Math.round(
      bLon * 1e5,
    )},${Math.round(bLat * 1e5)}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    if (this.worker && !this.pending.has(key)) {
      this.pending.add(key);
      this.worker.postMessage({ type: "route", key, aLon, aLat, bLon, bLat });
    }
    return null;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.cache.clear();
    this.pending.clear();
  }
}
