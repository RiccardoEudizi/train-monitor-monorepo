import { fetchDelays } from "~/server/data";

/** GET /api/delays?min=5&cat=FR,IC&limit=50 — thin adapter over fetchDelays. */
export async function GET(event: any) {
  const url = new URL(event.request.url);
  const min = Number(url.searchParams.get("min") ?? "0");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
  const cats = (url.searchParams.get("cat") ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  try {
    return Response.json(
      await fetchDelays(Number.isFinite(min) ? min : 0, cats, limit),
    );
  } catch (e) {
    console.error("delays query failed", e);
    return Response.json({ error: "delays query failed" }, { status: 500 });
  }
}
