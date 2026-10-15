/**
 * Shared lon/lat → world-XZ projection for the 3D Italy map.
 *
 * Extracted so the rail router (built in a Web Worker) and the renderer
 * (main thread) use the exact same mapping; a mismatch would place the
 * track polylines away from the stations and coastlines drawn on the map.
 */

import { MAP_BOUNDS } from "~/lib/map/italy-regions";

/** World units across the map-bounds square. */
export const WORLD = 140;

export function toWorld(lon: number, lat: number): [number, number] {
  const x =
    ((lon - MAP_BOUNDS.minLon) / (MAP_BOUNDS.maxLon - MAP_BOUNDS.minLon)) *
      WORLD -
    WORLD / 2;
  const z =
    ((MAP_BOUNDS.maxLat - lat) / (MAP_BOUNDS.maxLat - MAP_BOUNDS.minLat)) *
      WORLD -
    WORLD / 2;
  return [x, z];
}
