import { fetchDelays } from "~/server/data";
import { parseCats, parseLimit, parseMin, withApi } from "~/server/api-helpers";

/** GET /api/delays?min=5&cat=FR,IC&limit=50 — thin adapter over fetchDelays. */
export async function GET(event: { request: Request }) {
  const url = new URL(event.request.url);
  const min = parseMin(url.searchParams.get("min"));
  const limit = parseLimit(url.searchParams.get("limit"));
  const cats = parseCats(url.searchParams.get("cat"));
  return withApi(() => fetchDelays(min, cats, limit), "delays query failed");
}
