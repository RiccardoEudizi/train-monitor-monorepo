import { fetchMapRegions } from "~/server/map-data";
import { withApi } from "~/server/api-helpers";

/** GET /api/map/regions?period=30d — all regions, no top-N slice. */
export async function GET(event: { request: Request }) {
  const url = new URL(event.request.url);
  const period = url.searchParams.get("period") ?? "30d";
  return withApi(() => fetchMapRegions(period), "map regions query failed");
}
