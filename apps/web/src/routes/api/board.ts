import { fetchBoard } from "~/server/data";
import { queryParam, withApi } from "~/server/api-helpers";

/** GET /api/board?station=S01700 — thin adapter over fetchBoard. */
export async function GET(event: { request: Request }) {
  const url = new URL(event.request.url);
  const code = queryParam(url, "station").toUpperCase();
  if (!code) {
    return Response.json({ error: "station required" }, { status: 400 });
  }
  return withApi(() => fetchBoard(code), "board query failed");
}
