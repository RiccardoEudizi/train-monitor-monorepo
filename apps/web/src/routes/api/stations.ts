import { searchStations } from "~/server/data";

/** GET /api/stations?q=milano — thin adapter over searchStations. */
export async function GET(event: { request: Request }) {
  const url = new URL(event.request.url);
  const q = url.searchParams.get("q") ?? "";
  try {
    return Response.json(await searchStations(q));
  } catch (e) {
    console.error("stations query failed", e);
    return Response.json({ error: "stations query failed" }, { status: 500 });
  }
}
