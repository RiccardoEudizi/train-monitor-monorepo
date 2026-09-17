import { fetchBoard } from "~/server/data";

/** GET /api/board?station=S01700 — thin adapter over fetchBoard. */
export async function GET(event: { request: Request }) {
  const url = new URL(event.request.url);
  const code = (url.searchParams.get("station") ?? "").trim().toUpperCase();
  if (!code) {
    return Response.json({ error: "station required" }, { status: 400 });
  }
  try {
    return Response.json(await fetchBoard(code));
  } catch (e) {
    console.error("board query failed", e);
    return Response.json({ error: "board query failed" }, { status: 500 });
  }
}
