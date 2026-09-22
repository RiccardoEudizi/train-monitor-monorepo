import { searchStations } from "~/server/data";
import { withApi } from "~/server/api-helpers";

/** GET /api/stations?q=milano — thin adapter over searchStations. */
export async function GET(event: { request: Request }) {
  const url = new URL(event.request.url);
  const q = url.searchParams.get("q") ?? "";
  return withApi(() => searchStations(q), "stations query failed");
}
