import { fetchReplayDays } from "~/server/map-data";
import { withApi } from "~/server/api-helpers";

/** GET /api/map/days — days available for replay (30-day hot window). */
export async function GET() {
  return withApi(() => fetchReplayDays(), "replay days query failed");
}
