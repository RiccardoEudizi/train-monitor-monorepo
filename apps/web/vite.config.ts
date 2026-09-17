import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import { solidStart } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";

// Load .env early so `process.env.DATABASE_URL` is available to server code
// in `vite dev` SSR. Vite only exposes VITE_* via import.meta.env and does
// not populate process.env with server-only vars; Nitro's prod runtime loads
// .env itself, but the dev SSR path does not. Resolve relative to this config
// file so it works regardless of launcher CWD.
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".env"),
  quiet: true,
});

// @jridgewell/resolve-uri ships a broken `exports` map for bundlers: the
// `browser` condition (UMD, no ESM exports) wins over `import` (ESM), so Vite
// dev serves the UMD build to the browser and the client crashes with
// "does not provide an export named 'default'" (imported via
// @jridgewell/trace-mapping from SolidStart's dev toolbar). Force the ESM build.
const require = createRequire(import.meta.url);
const resolveUriMjs = path.join(
  path.dirname(require.resolve("@jridgewell/resolve-uri/package.json")),
  "dist",
  "resolve-uri.mjs",
);

export default defineConfig({
  resolve: {
    alias: {
      "@jridgewell/resolve-uri": resolveUriMjs,
    },
  },
  optimizeDeps: {
    include: ["@jridgewell/resolve-uri", "@jridgewell/trace-mapping"],
  },
  // The same build-time flag is used by SSR and the client (no middleware).
  define: {
    "import.meta.env.SEO_NOINDEX": JSON.stringify(
      process.env.VERCEL_ENV !== undefined && process.env.VERCEL_ENV !== "production",
    ),
  },
  plugins: [
    solidStart(),
    tailwindcss(),
    nitro()
  ]
});
