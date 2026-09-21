import { fetchMapRegions } from "~/server/map-data";

/** GET /api/map/regions?period=30d — all regions, no top-N slice. */
export async function GET(event: { request: Request }) {
  const url = new URL(event.request.url);
  const period = url.searchParams.get("period") ?? "30d";
  try {
    return Response.json(await fetchMapRegions(period));
  } catch (e) {
    console.error("map regions query failed", e);
    return Response.json({ error: "map regions query failed" }, { status: 500 });
  }
}
