import { fetchTrain } from "~/server/data";
import { queryParam, withApi } from "~/server/api-helpers";

/** GET /api/train?n=9583[&origine=..&date=..] — thin adapter over fetchTrain. */
export async function GET(event: { request: Request }) {
  const url = new URL(event.request.url);
  const n = queryParam(url, "n");
  const origine = queryParam(url, "origine").toUpperCase();
  const date = queryParam(url, "date");
  if (!n) {
    return Response.json({ error: "n required" }, { status: 400 });
  }
  return withApi(() => fetchTrain(n, origine || undefined, date || undefined), "train query failed");
}
