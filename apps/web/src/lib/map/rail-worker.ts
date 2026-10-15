/**
 * Rail router worker.
 *
 * Building the graph (~100k nodes) and running A* would block the render
 * frame, so the whole router lives here. The main thread sends `init` once
 * (with the decoded railway segments and the projection bounds) and then
 * `route` requests; completed routes come back as transferable typed arrays.
 *
 * Self-contained: it does not import the app modules (which use the `~`
 * alias), receiving the projection parameters in the init message instead.
 */

import { RailRouter } from "./rail-graph";

interface InitMsg {
  type: "init";
  lons: Float64Array;
  lats: Float64Array;
  offsets: Uint32Array;
  bounds: { minLon: number; maxLon: number; minLat: number; maxLat: number };
  world: number;
  bridgeR?: number;
}
interface RouteMsg {
  type: "route";
  key: string;
  aLon: number;
  aLat: number;
  bLon: number;
  bLat: number;
}
type InMsg = InitMsg | RouteMsg;

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<InMsg>) => void) | null;
  postMessage: (m: unknown, transfer?: Transferable[]) => void;
};

let router: RailRouter | null = null;

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") {
    const b = m.bounds;
    const w = m.world;
    // Mirrors toWorld() in ~/lib/map/map-projection (kept inline so the worker
    // stays free of alias-imported modules).
    const project = (lon: number, lat: number): [number, number] => [
      ((lon - b.minLon) / (b.maxLon - b.minLon)) * w - w / 2,
      ((b.maxLat - lat) / (b.maxLat - b.minLat)) * w - w / 2,
    ];
    // Rebuild per-segment geometries from the flat transferable arrays.
    const { lons, lats, offsets } = m;
    const segments = [];
    for (let s = 0; s < offsets.length - 1; s++) {
      const geom: [number, number][] = [];
      for (let i = offsets[s]; i < offsets[s + 1]; i++) {
        geom.push([lons[i], lats[i]]);
      }
      segments.push({ id: s, name: "", geom });
    }
    router = new RailRouter(segments, project, m.bridgeR);
    ctx.postMessage({ type: "ready" });
    return;
  }
  if (m.type === "route") {
    const r = router
      ? router.computeDirect(m.aLon, m.aLat, m.bLon, m.bLat)
      : null;
    if (r) {
      ctx.postMessage({ type: "route", key: m.key, route: r }, [
        r.xs.buffer,
        r.zs.buffer,
        r.cum.buffer,
      ]);
    } else {
      ctx.postMessage({ type: "route", key: m.key, route: null });
    }
  }
};
