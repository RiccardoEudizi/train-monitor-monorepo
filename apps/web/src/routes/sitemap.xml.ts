import { MAJOR_STATIONS } from "~/lib/stations-seed";
import { canonicalUrl } from "~/lib/seo";

/** Stable pages only; trains remain discoverable through internal links.
 * No lastmod: the response time isn't evidence that page content changed.
 */
export function GET() {
  const paths = ["/", "/ritardi", ...MAJOR_STATIONS.map((s) => `/stazione/${s.code}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((path) => `  <url><loc>${canonicalUrl(path)}</loc></url>`).join("\n")}
</urlset>`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
