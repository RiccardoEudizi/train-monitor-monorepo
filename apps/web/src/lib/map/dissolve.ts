import pc from "polygon-clipping";
import { ITALY_REGIONS } from "./italy-regions";

// polygon-clipping's ESM bundle exposes a default export only
// (named imports fail the prod build); unwrap once here.
const { union } = pc;

export type LonLat = [number, number];
/** Dissolved region outline: polygons → rings → positions. */
export type RegionOutline = LonLat[][][];

const cache = new Map<number, RegionOutline>();

function closeRing(ring: LonLat[]): LonLat[] {
  if (ring.length < 3) return ring;
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  return fx === lx && fy === ly ? ring : [...ring, [fx, fy]];
}

/**
 * Region outline with internal province borders dissolved away.
 * Islands stay separate polygons (real coastlines); shared
 * province edges merge via boolean union. Pure + memoized,
 * SSR-safe (no DOM).
 */
export function dissolvedRegion(id: number): RegionOutline {
  const hit = cache.get(id);
  if (hit) return hit;
  const entry = ITALY_REGIONS.find((r) => r.id === id);
  if (!entry) return [];
  const polys = entry.rings
    .filter((r) => r.length >= 3)
    .map((ring) => [closeRing(ring as LonLat[])] as [LonLat[]]);
  let out: RegionOutline = [];
  if (polys.length > 0) {
    out = (union(...polys) ?? []) as unknown as RegionOutline;
  }
  cache.set(id, out);
  return out;
}

/** Total dissolved polygon count (debug aid). */
export function dissolvedStats(): { regions: number; polygons: number } {
  let polygons = 0;
  for (const r of ITALY_REGIONS) polygons += dissolvedRegion(r.id).length;
  return { regions: ITALY_REGIONS.length, polygons };
}
