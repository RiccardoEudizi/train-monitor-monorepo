/**
 * Fetch all stations from the database and write to
 * public/data/stations.json as a compact static asset.
 *
 * Run: pnpm run fetch:stations
 *
 * Shipped as a static file (not bundled) so it's served from the CDN and
 * loaded at runtime, mirroring the railways data.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../src/server/db";
import { stations } from "../src/db/schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = resolve(__dirname, "../public/data/stations.json");

async function main() {
  const database = db();
  if (!database) {
    console.error("Database not configured. Set DATABASE_URL and try again.");
    process.exit(1);
  }

  console.log("Fetching stations from database...");
  const rows = await database
    .select({
      code: stations.code,
      name: stations.name,
      lat: stations.lat,
      lon: stations.lon,
      isMajor: stations.isMajor,
    })
    .from(stations);

  const valid = rows.filter((r) => r.lat != null && r.lon != null);
  console.log(`  Got ${valid.length} stations with coordinates`);

  // Compact tuple encoding: [code, name, lat, lon, isMajor(0|1)].
  // Keeps the payload small; coordinates rounded to 5 decimals (~1m).
  const encoded = valid.map((s) => [
    s.code,
    s.name,
    Number((s.lat as number).toFixed(5)),
    Number((s.lon as number).toFixed(5)),
    s.isMajor ? 1 : 0,
  ]);

  const data = {
    meta: {
      count: encoded.length,
      source: "ViaggiaTreno station registry",
    },
    stations: encoded,
  };

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  const json = JSON.stringify(data);
  writeFileSync(OUT_FILE, json, "utf-8");
  console.log(`  Written to ${OUT_FILE}`);
  console.log(`  File size: ${(json.length / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error("Failed to fetch stations:", err);
  process.exit(1);
});
