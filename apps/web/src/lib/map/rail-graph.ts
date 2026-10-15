/**
 * Rail-following router.
 *
 * Builds a graph from the OSM railway segments (nodes = shared vertices,
 * edges = consecutive vertices weighted by ground distance) and finds the
 * shortest rail path between two station coordinates with A*. The map uses
 * the resulting polyline — projected to world XZ once, then sampled by
 * arc-length — so train dots ride the tracks instead of cutting straight
 * lines between stations.
 *
 * Routing is asynchronous and cached: `route()` returns a cached path or
 * enqueues a job and returns null (caller falls back to a straight line),
 * and `tick()` does a bounded slice of work per frame so the main thread
 * never stalls. Stations too far from the network (e.g. foreign terminals)
 * or unreachable pairs cache a null and stay on the straight-line fallback.
 */

import type { RailwaySegment } from "~/lib/map/italy-railways";
import type { RailRoute } from "~/lib/map/rail-route";

export type Project = (lon: number, lat: number) => [number, number];

const EARTH_M = 111320;
/** Max distance a station may be from the network to be routable. */
const MAX_SNAP_M = 2500;
const CELL = 0.02; // ~2.2 km grid (snapping)
const FINE_CELL = 0.005; // ~550 m grid (bridge edges)
/**
 * The bundled OSM geometry is Douglas–Peucker simplified, which drops interior
 * junction nodes and leaves the network as many disjoint 2-point segments.
 * Bridging each node to its nearest neighbour within this radius (sparse
 * single-linkage) reconnects the junctions without the millions of edges a
 * full radius merge would add.
 */
const BRIDGE_R = 200;
/** Reject a route longer than `straight * GATE_RATIO + GATE_SLACK_M`. */
const GATE_RATIO = 1.6;
const GATE_SLACK_M = 1000;
const MAX_EXPANSIONS = 150000;

/** Minimal binary min-heap keyed by f-score. */
class MinHeap {
  private f: number[] = [];
  private v: number[] = [];
  get size(): number {
    return this.v.length;
  }
  push(fScore: number, value: number): void {
    this.f.push(fScore);
    this.v.push(value);
    let c = this.v.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.f[p] <= this.f[c]) break;
      this.swap(p, c);
      c = p;
    }
  }
  pop(): number {
    const top = this.v[0];
    const lf = this.f.pop()!;
    const lv = this.v.pop()!;
    if (this.v.length > 0) {
      this.f[0] = lf;
      this.v[0] = lv;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1;
        const r = l + 1;
        let s = p;
        if (l < this.v.length && this.f[l] < this.f[s]) s = l;
        if (r < this.v.length && this.f[r] < this.f[s]) s = r;
        if (s === p) break;
        this.swap(p, s);
        p = s;
      }
    }
    return top;
  }
  private swap(i: number, j: number): void {
    const tf = this.f[i];
    this.f[i] = this.f[j];
    this.f[j] = tf;
    const tv = this.v[i];
    this.v[i] = this.v[j];
    this.v[j] = tv;
  }
}

export class RailRouter {
  private lons: Float64Array;
  private lats: Float64Array;
  /** CSR adjacency: neighbors/weights of node i live in [start[i], start[i+1]). */
  private start: Int32Array;
  private nbr: Int32Array;
  private wgt: Float32Array;
  private grid = new Map<string, number[]>();
  private project: Project;

  constructor(segments: RailwaySegment[], project: Project, bridgeR = BRIDGE_R) {
    this.project = project;
    const keyToId = new Map<string, number>();
    const lon: number[] = [];
    const lat: number[] = [];
    const ea: number[] = [];
    const eb: number[] = [];
    const ed: number[] = [];

    const nodeId = (x: number, y: number): number => {
      const k = `${Math.round(x * 1e5)},${Math.round(y * 1e5)}`;
      let id = keyToId.get(k);
      if (id === undefined) {
        id = lon.length;
        keyToId.set(k, id);
        lon.push(x);
        lat.push(y);
      }
      return id;
    };

    for (const seg of segments) {
      const g = seg.geom;
      let pId = -1;
      let px = 0;
      let py = 0;
      for (let i = 0; i < g.length; i++) {
        const x = g[i][0];
        const y = g[i][1];
        const id = nodeId(x, y);
        if (pId >= 0 && id !== pId) {
          const dx = (x - px) * Math.cos((y * Math.PI) / 180) * EARTH_M;
          const dy = (y - py) * EARTH_M;
          ea.push(pId);
          eb.push(id);
          ed.push(Math.hypot(dx, dy));
        }
        pId = id;
        px = x;
        py = y;
      }
    }

    const n = lon.length;

    // Bridge edges: the bundled OSM geometry is Douglas–Peucker simplified,
    // which drops interior junction nodes and leaves the network as many
    // disjoint 2-point segments. Walk every node and connect it to the
    // nearest node within BRIDGE_R that is still in a DIFFERENT component
    // (union-find makes this converge to a minimal set of bridges), so the
    // junctions are reconnected without adding millions of redundant edges.
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    for (let i = 0; i < ea.length; i++) union(ea[i], eb[i]);

    const fine = new Map<string, number[]>();
    const fkey = (x: number, y: number) =>
      `${Math.floor(x / FINE_CELL)},${Math.floor(y / FINE_CELL)}`;
    for (let i = 0; i < n; i++) {
      const k = fkey(lon[i], lat[i]);
      let arr = fine.get(k);
      if (!arr) {
        arr = [];
        fine.set(k, arr);
      }
      arr.push(i);
    }
    const r2 = bridgeR * bridgeR;
    const range = Math.ceil(bridgeR / (FINE_CELL * EARTH_M)) + 1;
    for (let i = 0; i < n; i++) {
      const gx = Math.floor(lon[i] / FINE_CELL);
      const gy = Math.floor(lat[i] / FINE_CELL);
      const cosLat = Math.cos((lat[i] * Math.PI) / 180) * EARTH_M;
      const rootI = find(i);
      let best = r2;
      let bj = -1;
      for (let dx = -range; dx <= range; dx++) {
        for (let dy = -range; dy <= range; dy++) {
          const arr = fine.get(`${gx + dx},${gy + dy}`);
          if (!arr) continue;
          for (const j of arr) {
            if (find(j) === rootI) continue;
            const ddx = (lon[j] - lon[i]) * cosLat;
            const ddy = (lat[j] - lat[i]) * EARTH_M;
            const d = ddx * ddx + ddy * ddy;
            if (d < best) {
              best = d;
              bj = j;
            }
          }
        }
      }
      if (bj >= 0) {
        ea.push(i);
        eb.push(bj);
        ed.push(Math.sqrt(best));
        union(i, bj);
      }
    }

    const deg = new Int32Array(n);
    for (let i = 0; i < ea.length; i++) {
      deg[ea[i]]++;
      deg[eb[i]]++;
    }
    const start = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) start[i + 1] = start[i] + deg[i];
    const nbr = new Int32Array(start[n]);
    const wgt = new Float32Array(start[n]);
    const cursor = start.slice(0, n);
    for (let i = 0; i < ea.length; i++) {
      const a = ea[i];
      const b = eb[i];
      const d = ed[i];
      nbr[cursor[a]] = b;
      wgt[cursor[a]++] = d;
      nbr[cursor[b]] = a;
      wgt[cursor[b]++] = d;
    }

    this.lons = Float64Array.from(lon);
    this.lats = Float64Array.from(lat);
    this.start = start;
    this.nbr = nbr;
    this.wgt = wgt;

    for (let i = 0; i < n; i++) {
      const k = this.cellKey(this.lons[i], this.lats[i]);
      let arr = this.grid.get(k);
      if (!arr) {
        arr = [];
        this.grid.set(k, arr);
      }
      arr.push(i);
    }
  }

  private cellKey(lon: number, lat: number): string {
    return `${Math.floor(lon / CELL)},${Math.floor(lat / CELL)}`;
  }

  /** Nearest graph node within MAX_SNAP_M, or -1. */
  private snap(lon: number, lat: number): number {
    const gx = Math.floor(lon / CELL);
    const gy = Math.floor(lat / CELL);
    const cosLat = Math.cos((lat * Math.PI) / 180) * EARTH_M;
    const limit = MAX_SNAP_M * MAX_SNAP_M;
    let best = limit;
    let bi = -1;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const arr = this.grid.get(`${gx + dx},${gy + dy}`);
        if (!arr) continue;
        for (const i of arr) {
          const ddx = (this.lons[i] - lon) * cosLat;
          const ddy = (this.lats[i] - lat) * EARTH_M;
          const d = ddx * ddx + ddy * ddy;
          if (d < best) {
            best = d;
            bi = i;
          }
        }
      }
    }
    return bi;
  }

  private heuristic(i: number, goal: number): number {
    const cosLat = Math.cos((this.lats[goal] * Math.PI) / 180) * EARTH_M;
    const dx = (this.lons[i] - this.lons[goal]) * cosLat;
    const dy = (this.lats[i] - this.lats[goal]) * EARTH_M;
    return Math.hypot(dx, dy);
  }

  /** A* node path from a to b, or null. */
  private astar(a: number, b: number): number[] | null {
    if (a === b) return [a];
    const gScore = new Map<number, number>([[a, 0]]);
    const came = new Map<number, number>();
    const closed = new Set<number>();
    const heap = new MinHeap();
    heap.push(this.heuristic(a, b), a);
    let expansions = 0;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (closed.has(cur)) continue;
      closed.add(cur);
      if (cur === b) break;
      if (++expansions > MAX_EXPANSIONS) return null;
      const gc = gScore.get(cur)!;
      const end = this.start[cur + 1];
      for (let e = this.start[cur]; e < end; e++) {
        const nn = this.nbr[e];
        if (closed.has(nn)) continue;
        const ng = gc + this.wgt[e];
        if (ng < (gScore.get(nn) ?? Infinity) - 1e-6) {
          gScore.set(nn, ng);
          came.set(nn, cur);
          heap.push(ng + this.heuristic(nn, b), nn);
        }
      }
    }
    if (!came.has(b)) return null;
    const path: number[] = [];
    let c = b;
    while (c !== a) {
      path.push(c);
      const p = came.get(c);
      if (p === undefined) return null;
      c = p;
    }
    path.push(a);
    path.reverse();
    return path;
  }

  private compute(
    aLon: number,
    aLat: number,
    bLon: number,
    bLat: number,
  ): RailRoute | null {
    const a = this.snap(aLon, aLat);
    const b = this.snap(bLon, bLat);
    if (a < 0 || b < 0) return null;
    const path = this.astar(a, b);
    if (!path) return null;

    const geo = (lo1: number, la1: number, lo2: number, la2: number) => {
      const c = Math.cos(((la1 + la2) / 2) * (Math.PI / 180)) * EARTH_M;
      return Math.hypot((lo2 - lo1) * c, (la2 - la1) * EARTH_M);
    };
    const straight = geo(aLon, aLat, bLon, bLat);

    // lon/lat sequence: station A -> node path -> station B (dedup closes).
    const lons: number[] = [aLon];
    const lats: number[] = [aLat];
    const push = (lo: number, la: number) => {
      if (geo(lons[lons.length - 1], lats[lats.length - 1], lo, la) < 5) return;
      lons.push(lo);
      lats.push(la);
    };
    for (const id of path) push(this.lons[id], this.lats[id]);
    push(bLon, bLat);
    const n = lons.length;
    if (n < 2) return null;

    // Store projected points (for rendering) but measure arc length and gate
    // in geographic meters, so `total` is real distance and the cumulative
    // fractions are geographically even.
    const xs = new Float64Array(n);
    const zs = new Float64Array(n);
    const cum = new Float64Array(n);
    let acc = 0;
    let accWorld = 0;
    for (let i = 0; i < n; i++) {
      const [x, z] = this.project(lons[i], lats[i]);
      xs[i] = x;
      zs[i] = z;
      if (i > 0) {
        acc += geo(lons[i - 1], lats[i - 1], lons[i], lats[i]);
        accWorld += Math.hypot(x - xs[i - 1], z - zs[i - 1]);
        cum[i] = acc;
      }
    }
    if (acc <= 0 || accWorld <= 0) return null;

    // Quality gate: a route much longer than the straight-line distance means
    // the direct track is missing from the (simplified) network and A* found a
    // detour. Reject those so dots never take absurd paths — the leg falls
    // back to a straight line instead.
    if (acc > straight * GATE_RATIO + GATE_SLACK_M) return null;

    for (let i = 0; i < n; i++) cum[i] /= acc;
    return { xs, zs, cum, total: accWorld };
  }

  /** Compute a route synchronously (used inside the worker). */
  computeDirect(
    aLon: number,
    aLat: number,
    bLon: number,
    bLat: number,
  ): RailRoute | null {
    return this.compute(aLon, aLat, bLon, bLat);
  }
}
