import { drizzle } from "drizzle-orm/postgres-js";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import * as schema from "~/db/schema";

// Load .env as fallback for contexts where the framework didn't already do
// it (e.g. plain `vite dev` SSR before vite.config preload, drizzle-kit,
// tests). Resolve relative to this file, not process.cwd(), because CWD
// varies by launcher (Vite/Nitro SSR workers, bundled prod output).
// Skip entirely when DATABASE_URL is already set to avoid dotenv's
// misleading "injecting env (0)" log on double-load.
if (!process.env.DATABASE_URL) {
  const candidates = [
    // src/server/db.ts -> apps/web/.env (package-level)
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env"),
    // apps/web/src/server/db.ts -> monorepo root .env
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../.env",
    ),
    // launcher CWD (prod `node .output/server/index.mjs` from root, CLIs)
    path.resolve(process.cwd(), ".env"),
  ];
  for (const p of candidates) {
    const res = dotenv.config({ path: p, quiet: true });
    if (res.parsed?.DATABASE_URL) break;
  }
  if (!process.env.DATABASE_URL) {
    console.error(`[env] DATABASE_URL not set (looked in ${candidates.join(", ")})`);
  }
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/** True when DATABASE_URL is configured. */
export function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Lazily create the DB client. Returns null when DATABASE_URL is not set
 * so API routes can degrade gracefully (empty state + dbConfigured:false)
 * until you provision Postgres.
 */
export function db() {
  if (!process.env.DATABASE_URL) return null;
  if (!_db) {
    const client = postgres(process.env.DATABASE_URL, { max: 10 });
    _db = drizzle(client, { schema });
  }
  return _db;
}
