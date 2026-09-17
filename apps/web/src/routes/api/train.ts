import { fetchTrain } from "~/server/data";

/** GET /api/train?n=9583[&origine=..&date=..] — thin adapter over fetchTrain. */
export async function GET(event: { request: Request }) {
  const url = new URL(event.request.url);
  const n = (url.searchParams.get("n") ?? "").trim();
  const origine = (url.searchParams.get("origine") ?? "").trim().toUpperCase();
  const date = (url.searchParams.get("date") ?? "").trim();
  if (!n) {
    return Response.json({ error: "n required" }, { status: 400 });
  }
  try {
    return Response.json(await fetchTrain(n, origine || undefined, date || undefined));
  } catch (e) {
    console.error("train query failed", e);
    return Response.json({ error: "train query failed" }, { status: 500 });
  }
}
