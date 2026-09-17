import { fetchOverview, fetchStats } from "~/server/data";

/** GET /api/stats?scope=train&numero=9583&period=30d — thin adapter over fetchStats.
 *  scope=overview&period=1d|7d|30d|total → panoramica nazionale per la home. */
export async function GET(event: any) {
  const url = new URL(event.request.url);
  const scope = url.searchParams.get("scope") ?? "global";
  const numero = (url.searchParams.get("numero") ?? "").trim();
  const code = (url.searchParams.get("code") ?? "").trim().toUpperCase();
  const period = url.searchParams.get("period") ?? "30d";
  try {
    if (scope === "overview") {
      return Response.json(await fetchOverview(period));
    }
    return Response.json(
      await fetchStats(scope, scope === "train" ? numero : code, period),
    );
  } catch (e) {
    console.error("stats query failed", e);
    return Response.json({ error: "stats query failed" }, { status: 500 });
  }
}
