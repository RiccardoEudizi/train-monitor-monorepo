/**
 * Convert cached railway data to a compact JSON file in public/.
 * Uses delta encoding and rounded coordinates to minimize size.
 *
 * Run: pnpm run convert:railways
 */

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ITALY_REGIONS } from "../src/lib/map/italy-regions";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = resolve(__dirname, ".railways-cache.json");
const OUT_FILE = resolve(__dirname, "../public/data/railways.json");

interface OverpassNode {
  lat: number;
  lon: number;
}

interface OverpassWay {
  type: "way";
  id: number;
  tags?: Record<string, string>;
  geometry: OverpassNode[];
}

function simplify(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length <= 2) return points;

  const first = points[0];
  const last = points[points.length - 1];
  let maxDist = 0;
  let maxIdx = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplify(points.slice(0, maxIdx + 1), tolerance);
    const right = simplify(points.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

function perpendicularDistance(
  point: [number, number],
  lineStart: [number, number],
  lineEnd: [number, number],
): number {
  const [px, py] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  }

  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = x1 + t * dx;
  const projY = y1 + t * dy;

  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

/**
 * Italy landmass test. We keep only railway points that fall inside the
 * ISTAT region rings, so connecting lines into neighbouring countries
 * (France, Switzerland, Slovenia, Croatia, Tunisia) and Corsica are
 * dropped entirely rather than drawn off the country.
 */
interface Ring {
  pts: Array<[number, number]>;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

const RINGS: Ring[] = ITALY_REGIONS.flatMap((region) =>
  region.rings.map((pts) => {
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const [lon, lat] of pts) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    return { pts, minLon, maxLon, minLat, maxLat };
  }),
);

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  const pts = ring.pts;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function insideItaly(lon: number, lat: number): boolean {
  for (const ring of RINGS) {
    if (
      lon < ring.minLon ||
      lon > ring.maxLon ||
      lat < ring.minLat ||
      lat > ring.maxLat
    ) {
      continue;
    }
    if (pointInRing(lon, lat, ring)) return true;
  }
  return false;
}

/** Split a polyline into maximal runs of consecutive in-Italy points. */
function insideRuns(points: Array<[number, number]>): Array<Array<[number, number]>> {
  const runs: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> = [];
  for (const p of points) {
    if (insideItaly(p[0], p[1])) {
      cur.push(p);
    } else {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

function main() {
  console.log("Loading cached railway data...");
  const ways = JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as OverpassWay[];
  console.log(`  Loaded ${ways.length} ways`);

  // Simplify each way with ~200m tolerance
  const TOLERANCE = 0.002;
  const segments: Array<{ id: number; name: string; geom: [number, number][] }> = [];

  for (const way of ways) {
    const raw: [number, number][] = way.geometry.map((n) => [
      Number(n.lon.toFixed(5)),
      Number(n.lat.toFixed(5)),
    ]);

    const simplified = simplify(raw, TOLERANCE);
    if (simplified.length < 2) continue;

    // Keep only the parts of the line that lie on Italian soil.
    const runs = insideRuns(simplified);
    for (let r = 0; r < runs.length; r++) {
      segments.push({
        id: way.id * 100 + r,
        name: way.tags?.name ?? "",
        geom: runs[r],
      });
    }
  }

  console.log(`  Clipped to Italy: ${segments.length} segments`);

  // Delta encode: store first point as [lon, lat], then deltas as integers
  // Scale by 1e5 to preserve 5 decimal places (~1m precision)
  const SCALE = 100000;
  const encoded: number[][] = [];

  for (const seg of segments) {
    const flat: number[] = [];
    let prevLon = 0;
    let prevLat = 0;

    for (let i = 0; i < seg.geom.length; i++) {
      const [lon, lat] = seg.geom[i];
      const lonInt = Math.round(lon * SCALE);
      const latInt = Math.round(lat * SCALE);

      if (i === 0) {
        flat.push(lonInt, latInt);
      } else {
        flat.push(lonInt - prevLon, latInt - prevLat);
      }

      prevLon = lonInt;
      prevLat = latInt;
    }

    encoded.push(flat);
  }

  // Build compact JSON
  const data = {
    meta: {
      scale: SCALE,
      count: segments.length,
      source: "OpenStreetMap contributors, ODbL 1.0",
    },
    segments: encoded.map((flat, i) => ({
      id: segments[i].id,
      name: segments[i].name,
      d: flat,
    })),
  };

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  const json = JSON.stringify(data);
  writeFileSync(OUT_FILE, json, "utf-8");

  console.log(`  Written to ${OUT_FILE}`);
  console.log(`  File size: ${(json.length / 1024 / 1024).toFixed(2)} MB`);
}

main();
