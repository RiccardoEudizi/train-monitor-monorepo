/**
 * Railway track geometry for Italy, fetched from OpenStreetMap via Overpass API.
 * Data is stored as a compact delta-encoded JSON file in public/data/railways.json
 * and loaded at runtime to keep the bundle small.
 *
 * Data source: © OpenStreetMap contributors, ODbL 1.0.
 * https://www.openstreetmap.org/copyright
 */

export interface RailwaySegment {
  id: number;
  name: string;
  /** Polyline as [lon, lat] pairs. */
  geom: [number, number][];
}

interface RailwayJson {
  meta: {
    scale: number;
    count: number;
    source: string;
  };
  segments: Array<{
    id: number;
    name: string;
    d: number[];
  }>;
}

let cached: RailwaySegment[] | null = null;
let inFlight: Promise<RailwaySegment[]> | null = null;

/**
 * Fetch and decode railway segments from the compact JSON file.
 * Results are cached after the first load. Retries a few times because
 * a dev-server reload (Vite dep re-optimisation) can abort the request.
 */
export async function loadRailwaySegments(): Promise<RailwaySegment[]> {
  if (cached) return cached;
  // Single-flight: concurrent callers share one fetch.
  inFlight ??= fetchAndDecode().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function fetchAndDecode(): Promise<RailwaySegment[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("/data/railways.json");
      if (!res.ok) throw new Error(`Failed to fetch railways: ${res.status}`);
      const data = (await res.json()) as RailwayJson;
      cached = decode(data);
      return cached;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function decode(data: RailwayJson): RailwaySegment[] {
  const scale = data.meta.scale;

  return data.segments.map((seg) => {
    const geom: [number, number][] = [];
    let lon = 0;
    let lat = 0;

    for (let i = 0; i < seg.d.length; i += 2) {
      lon += seg.d[i];
      lat += seg.d[i + 1];
      geom.push([lon / scale, lat / scale]);
    }

    return {
      id: seg.id,
      name: seg.name,
      geom,
    };
  });
}
