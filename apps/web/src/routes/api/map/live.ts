import { fetchLiveTrains } from "~/server/map-data";
import { withApi } from "~/server/api-helpers";

/**
 * GET /api/map/live — every traveling train with prev/next anchors.
 * Polled by /map every 12s; the client interpolates between polls
 * (see ~/lib/map/interpolate.ts).
 */
export async function GET() {
  return withApi(() => fetchLiveTrains(), "map live query failed");
}
