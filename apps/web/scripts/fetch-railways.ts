/**
 * Fetch railway track geometry from OpenStreetMap via Overpass API,
 * simplify with Douglas-Peucker, and write to src/lib/map/italy-railways.ts.
 *
 * Run: pnpm run fetch:railways
 *
 * Data source: © OpenStreetMap contributors, ODbL 1.0.
 * https://www.openstreetmap.org/copyright
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = resolve(__dirname, "../src/lib/map/italy-railways.ts");

// Italy bounding box (matches MAP_BOUNDS in italy-regions.ts)
const BBOX = { minLat: 35.4, minLon: 6.6, maxLat: 47.1, maxLon: 18.6 };

// Douglas-Peucker tolerance in degrees (~100m at mid-latitudes)
const TOLERANCE = 0.001;

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

interface OverpassResponse {
  elements: OverpassWay[];
}

/**
 * Douglas-Peucker polyline simplification.
 * Points are [lon, lat] pairs.
 */
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

  // Project point onto line, clamped to segment
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = x1 + t * dx;
  const projY = y1 + t * dy;

  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

async function fetchWithRetry(
  query: string,
  label: string,
  retries = 5,
): Promise<OverpassResponse> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "train-monitor-monorepo/1.0 (railway geometry fetch script)",
        },
        body: `data=${encodeURIComponent(query)}`,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      return (await res.json()) as OverpassResponse;
    } catch (err) {
      lastError = err as Error;
      console.log(`    Attempt ${attempt + 1} failed: ${lastError.message}`);
      if (attempt < retries - 1) {
        // Wait before retry: 3s, 6s, 12s, 24s
        const delay = 3000 * Math.pow(2, attempt);
        console.log(`    Retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw new Error(`All ${retries} attempts failed for ${label}: ${lastError?.message}`);
}

async function fetchRailways(
  cachedWays: OverpassWay[],
  cachedIds: Set<number>,
): Promise<OverpassWay[]> {
  // Split Italy into a grid of small bounding boxes to avoid Overpass API timeouts
  const GRID_LAT = 5;
  const GRID_LON = 5;
  const latStep = (BBOX.maxLat - BBOX.minLat) / GRID_LAT;
  const lonStep = (BBOX.maxLon - BBOX.minLon) / GRID_LON;
  const allWays: OverpassWay[] = [...cachedWays];
  const seenIds = new Set<number>(cachedIds);
  const failedCells: string[] = [];

  for (let i = 0; i < GRID_LAT; i++) {
    for (let j = 0; j < GRID_LON; j++) {
      const minLat = BBOX.minLat + i * latStep - 0.05;
      const maxLat = BBOX.minLat + (i + 1) * latStep + 0.05;
      const minLon = BBOX.minLon + j * lonStep - 0.05;
      const maxLon = BBOX.minLon + (j + 1) * lonStep + 0.05;

      const query = `
        [out:json][timeout:60];
        way["railway"="rail"](${minLat},${minLon},${maxLat},${maxLon});
        out geom;
      `.trim();

      const label = `cell(${i},${j})`;
      console.log(`  Fetching ${label} [${minLat.toFixed(1)}-${maxLat.toFixed(1)}, ${minLon.toFixed(1)}-${maxLon.toFixed(1)}]...`);

      try {
        const data = await fetchWithRetry(query, label, 3);
        const ways = data.elements.filter((e) => e.type === "way" && e.geometry.length >= 2);

        let newCount = 0;
        for (const way of ways) {
          if (!seenIds.has(way.id)) {
            seenIds.add(way.id);
            allWays.push(way);
            newCount++;
          }
        }
        console.log(`    Got ${ways.length} ways (${newCount} new)`);

        // Save cache after each successful cell
        saveCache(allWays);
      } catch (err) {
        console.log(`    FAILED: ${(err as Error).message}`);
        failedCells.push(label);
      }
    }
  }

  if (failedCells.length > 0) {
    console.log(`\n  Warning: ${failedCells.length} cells failed: ${failedCells.join(", ")}`);
    console.log(`  Re-run the script to retry failed cells.`);
  }

  return allWays;
}

function waysToSegments(ways: OverpassWay[]): Array<{
  id: number;
  name: string;
  geom: [number, number][];
}> {
  const segments: Array<{ id: number; name: string; geom: [number, number][] }> = [];

  for (const way of ways) {
    const raw: [number, number][] = way.geometry.map((n) => [
      Number(n.lon.toFixed(5)),
      Number(n.lat.toFixed(5)),
    ]);

    // Split long ways into chunks of ~200 points to avoid huge buffers
    const simplified = simplify(raw, TOLERANCE);
    const CHUNK = 200;

    if (simplified.length <= CHUNK) {
      segments.push({
        id: way.id,
        name: way.tags?.name ?? "",
        geom: simplified,
      });
    } else {
      for (let i = 0; i < simplified.length - 1; i += CHUNK - 1) {
        const chunk = simplified.slice(i, i + CHUNK);
        if (chunk.length < 2) continue;
        segments.push({
          id: way.id * 1000 + i,
          name: way.tags?.name ?? "",
          geom: chunk,
        });
      }
    }
  }

  return segments;
}

function generateTs(segments: Array<{ id: number; name: string; geom: [number, number][] }>): string {
  const lines: string[] = [];

  lines.push(`/**
 * Railway track geometry for Italy, fetched from OpenStreetMap via Overpass API.
 * Simplified with Douglas-Peucker (~100m tolerance).
 *
 * Data source: © OpenStreetMap contributors, ODbL 1.0.
 * https://www.openstreetmap.org/copyright
 *
 * GENERATED FILE — do not edit manually.
 * Run \`pnpm run fetch:railways\` to regenerate.
 */

export interface RailwaySegment {
  id: number;
  name: string;
  /** Polyline as [lon, lat] pairs. */
  geom: [number, number][];
}

export const RAILWAY_SEGMENTS: RailwaySegment[] = [`);

  for (const seg of segments) {
    const geomStr = seg.geom
      .map(([lon, lat]) => `[${lon},${lat}]`)
      .join(",");
    lines.push(`  { id: ${seg.id}, name: ${JSON.stringify(seg.name)}, geom: [${geomStr}] },`);
  }

  lines.push(`];`);
  lines.push(``);

  return lines.join("\n");
}

const CACHE_FILE = resolve(__dirname, ".railways-cache.json");

function loadCache(): OverpassWay[] {
  if (!existsSync(CACHE_FILE)) return [];
  try {
    const data = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
    return data as OverpassWay[];
  } catch {
    return [];
  }
}

function saveCache(ways: OverpassWay[]): void {
  writeFileSync(CACHE_FILE, JSON.stringify(ways), "utf-8");
}

async function main() {
  console.log("Fetching railway data from OpenStreetMap...");

  // Load cached results from previous runs
  const cachedWays = loadCache();
  const cachedIds = new Set(cachedWays.map((w) => w.id));
  console.log(`  Loaded ${cachedWays.length} cached ways`);

  const ways = await fetchRailways(cachedWays, cachedIds);
  console.log(`  Got ${ways.length} railway ways total`);

  const segments = waysToSegments(ways);
  console.log(`  Simplified to ${segments.length} segments`);

  const ts = generateTs(segments);

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, ts, "utf-8");
  console.log(`  Written to ${OUT_FILE}`);

  // Stats
  const totalPoints = segments.reduce((sum, s) => sum + s.geom.length, 0);
  console.log(`  Total points: ${totalPoints}`);
  console.log(`  File size: ${(ts.length / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error("Failed to fetch railways:", err);
  process.exit(1);
});
