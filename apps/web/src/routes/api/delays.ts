import { fetchDelays } from "~/server/data";

/** GET /api/delays?min=5&cat=FR,IC&limit=50 — thin adapter over fetchDelays. */
export async function GET(event: { request: Request }) {
  const url = new URL(event.request.url);
  const rawMin = Number(url.searchParams.get("min") ?? "0");
  const rawLimit = Number(url.searchParams.get("limit") ?? "50");
  const min = Number.isFinite(rawMin) ? rawMin : 0;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.floor(rawLimit), 1), 200)
    : 50;
  const cats = (url.searchParams.get("cat") ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  try {
    return Response.json(await fetchDelays(min, cats, limit));
  } catch (e) {
    console.error("delays query failed", e);
    return Response.json({ error: "delays query failed" }, { status: 500 });
  }
}
