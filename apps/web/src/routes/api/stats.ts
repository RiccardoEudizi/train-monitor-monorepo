import { fetchOverview, fetchStats } from "~/server/data";
import { queryParam, withApi } from "~/server/api-helpers";

/** GET /api/stats?scope=train&numero=9583&period=30d — thin adapter over fetchStats.
 *  scope=overview&period=1d|7d|30d|total → panoramica nazionale per la home. */
export async function GET(event: { request: Request }) {
  const url = new URL(event.request.url);
  const scope = url.searchParams.get("scope") ?? "global";
  const numero = queryParam(url, "numero");
  const code = queryParam(url, "code").toUpperCase();
  const period = url.searchParams.get("period") ?? "30d";
  if (scope === "overview") {
    return withApi(() => fetchOverview(period), "stats query failed");
  }
  return withApi(() => fetchStats(scope, scope === "train" ? numero : code, period), "stats query failed");
}
