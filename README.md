# Ritardometro (monorepo)

Public, no-auth live board of Italian train delays.

MIT licensed — see [LICENSE](LICENSE).

Data flow: `ViaggiaTreno → Go poller → Postgres → SolidStart`. The app never calls ViaggiaTreno directly.

## Layout

| Path | What |
|---|---|
| `apps/web/` | SolidStart app (ex `train-monitor-v2` history, rewritten under `apps/web` via `git filter-repo --to-subdirectory-filter apps/web`) |
| `services/poller/` | Go ingester: polls ViaggiaTreno, writes Postgres (no prior git history; added as one commit) |
| `.env.example` | Combined env template (`DATABASE_URL` + poller vars) |

## Prerequisites

- Node >=24, pnpm 10.13.1
- Go >=1.24 (poller only)
- Postgres (`DATABASE_URL`)

## Setup

```bash
cp .env.example .env   # set DATABASE_URL
# --- web ---
pnpm install
pnpm db:push           # create tables (drizzle, dev)
pnpm dev
# --- poller (another shell) ---
for f in 001_schema 004_majors 005_drop_snapshots 006_daily_train_stats 007_daily_train_names 008_daily_train_stats_id; do
  psql $DATABASE_URL -f services/poller/migrations/$f.sql  # fresh install
done
pnpm poller:seed       # all stations from elencoStazioni (never touches is_major)
pnpm poller:run        # loop every POLL_INTERVAL_SECONDS (default 120)
```

Superseded one-shots (`002_*`, `003_*`) live in `services/poller/migrations/archive/` for old DBs only; `004_majors.sql` is the full 200-station list, single source of truth. See `services/poller/migrations/README.md`.

## Scripts

| Script | What |
|---|---|
| `pnpm dev` / `build` / `start` / `preview` | proxy to `apps/web` (`vite dev` / `vite build` → `node apps/web/.output/server/index.mjs`) |
| `pnpm db:push` | push `apps/web/src/db/schema.ts` (dev) |
| `pnpm db:generate` / `db:migrate` / `db:studio` | generate/migrate/inspect (prod uses migrate) |
| `pnpm poller:run` / `poller:seed` | `go run ./cmd/poller` / `./cmd/seed` in `services/poller` |
| `pnpm poller:vet` / `poller:build` | `go vet ./...` / build binary to `bin/poller` |

## Environment

| Var | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection string (required, shared; on Neon use the pooled string) |
| `POLL_INTERVAL_SECONDS` | `120` | Seconds between poller cycles |
| `WORKERS` | `25` | Max concurrent ViaggiaTreno requests |
| `MAJORS_ONLY` | `true` | Poll only `is_major` stations; `false` sweeps all seeded stations |

Web lookup order: `apps/web/.env`, then repo-root `.env`, then launcher CWD (`src/server/db.ts`). Poller: `services/poller/.env`, then repo-root `.env`.

## Schema contract (two definitions, one truth)

- **DDL source of truth:** `services/poller/migrations/*.sql`.
- **Mirror:** `apps/web/src/db/schema.ts` (Drizzle, read-only shapes for the app).
- Rule: any table change = new `services/poller/migrations/00N_*.sql` + manual mirror update in `schema.ts`. Never let them drift.

Tables: `stations`, `train_runs` (keyed by `(numero, origine_code, data_partenza)`, 30-day hot window), `stops` (current truth), `daily_stop_stats` (per-stop rollup, kept forever), `daily_train_stats` (per-run rollup incl. frozen region, kept forever), `info_news(kind=ticker|news|lavori|stats, payload=jsonb)`.

## Deployment

Two deployables sharing `DATABASE_URL`:

- **Web → Vercel.** Project Root Directory `apps/web` (the Go poller is never uploaded). Settings: `NITRO_PRESET=vercel` env var, Node.js 24.x, `DATABASE_URL` from the Neon Marketplace integration, Ignored Build Step `git diff --quiet HEAD^ HEAD -- apps/web/`.
- **Poller → separate always-on host** (Vercel can't run the ingest loop):

```bash
pnpm build && pnpm start        # web self-hosted alt: serves apps/web/.output/server/index.mjs
pnpm poller:build && ./bin/poller
```

Use `db:migrate` (not `push`) in prod. No CI yet. See `apps/web/README.md` (routes, API, stats model, degraded mode, responsive layout) and `services/poller/README.md` (pipeline details).
