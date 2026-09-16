import { fetchNews } from "~/server/data";

/** GET /api/news — thin adapter over fetchNews. */
export async function GET() {
  try {
    return Response.json(await fetchNews());
  } catch (e) {
    console.error("news query failed", e);
    return Response.json({ error: "news query failed" }, { status: 500 });
  }
}
