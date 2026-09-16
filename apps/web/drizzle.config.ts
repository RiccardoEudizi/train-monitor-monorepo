import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// drizzle-kit CLI does not load .env itself; preload it so
// `db:push/migrate` see DATABASE_URL without manual `export`.
if (!process.env.DATABASE_URL) {
  dotenv.config({
    path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".env"),
    quiet: true,
  });
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
