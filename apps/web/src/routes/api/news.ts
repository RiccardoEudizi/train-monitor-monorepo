import { fetchNews } from "~/server/data";
import { withApi } from "~/server/api-helpers";

/** GET /api/news — thin adapter over fetchNews. */
export async function GET() {
  return withApi(() => fetchNews(), "news query failed");
}
