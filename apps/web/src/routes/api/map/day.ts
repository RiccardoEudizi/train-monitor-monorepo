import { fetchDayReplay } from "~/server/map-data";
import { withApi } from "~/server/api-helpers";

/**
 * GET /api/map/day?date=YYYY-MM-DD — whole-day trajectory dataset for the
 * /replay page (compact: minutes-since-Rome-midnight + station indices).
 */
export async function GET(event: { request: Request }) {
  const url = new URL(event.request.url);
  const date = (url.searchParams.get("date") ?? "").trim();
  return withApi(() => fetchDayReplay(date), "replay day query failed");
}
