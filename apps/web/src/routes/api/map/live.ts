import { fetchLiveTrains } from "~/server/map-data";

/**
 * GET /api/map/live — every traveling train with prev/next anchors.
 * Polled by /map every 12s; the client interpolates between polls
 * (see ~/lib/map/interpolate.ts).
 */
export async function GET() {
  try {
    return Response.json(await fetchLiveTrains());
  } catch (e) {
    console.error("map live query failed", e);
    return Response.json({ error: "map live query failed" }, { status: 500 });
  }
}
