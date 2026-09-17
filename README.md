# train-monitor monorepo

Public, no-auth live board of Italian train delays.

Data flow: `ViaggiaTreno → Go poller → Postgres → SolidStart`. The app never calls ViaggiaTreno directly.

## Layout

| Path | What |
|---|---|
| `apps/web/` | SolidStart app (ex `train-monitor-v2` history, rewritten under `apps/web` via `git filter-repo --to-subdirectory-filter apps/web`) |
| `services/poller/` | Go ingester: polls ViaggiaTreno, writes Postgres (no prior git history; added as one commit) |
| `docker-compose.yml` | Local Postgres for dev |
| `.env.example` | Combined env template (`DATABASE_URL` + poller vars) |

## Prerequisites

- Node >=24, pnpm 10.13.1
- Go >=1.24 (poller only)
- Postgres (`DATABASE_URL`, or `docker compose up db`)

## Setup

```bash
cp .env.example .env   # set DATABASE_URL
# --- web ---
pnpm install
pnpm db:push           # create tables (drizzle, dev)
pnpm dev
# --- poller (another shell) ---
psql $DATABASE_URL -f services/poller/migrations/001_schema.sql
psql $DATABASE_URL -f services/poller/migrations/002_snapshot_retention.sql
psql $DATABASE_URL -f services/poller/migrations/004_majors.sql
pnpm poller:seed       # all stations from elencoStazioni (never touches is_major)
pnpm poller:run        # loop every POLL_INTERVAL_SECONDS (default 120)
```

`003_tier2_majors.sql` is kept for existing DBs; fresh installs only need `004_majors.sql` (full 200-station list, single source of truth).

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
| `DATABASE_URL` | — | Postgres connection string (required, shared) |
| `POLL_INTERVAL_SECONDS` | `120` | Seconds between poller cycles |
| `WORKERS` | `25` | Max concurrent ViaggiaTreno requests |
| `MAJORS_ONLY` | `true` | Poll only `is_major` stations; `false` sweeps all seeded stations |

Web lookup order: `apps/web/.env`, then repo-root `.env`, then launcher CWD (`src/server/db.ts`). Poller: `services/poller/.env`, then repo-root `.env`.

## Schema contract (two definitions, one truth)

- **DDL source of truth:** `services/poller/migrations/*.sql`.
- **Mirror:** `apps/web/src/db/schema.ts` (Drizzle, read-only shapes for the app).
- Rule: any table change = new `services/poller/migrations/00N_*.sql` + manual mirror update in `schema.ts`. Never let them drift.

Tables: `stations`, `train_runs` (keyed by `(numero, origine_code, data_partenza)`), `stops` (current truth), `stop_snapshots` (append on change + heartbeat every 15th cycle, 14-day retention), `daily_stop_stats` (rollup, kept forever), `info_news(kind=ticker|news|lavori|stats, payload=jsonb)`.

## Deployment

Two deployables sharing `DATABASE_URL`:

```bash
pnpm build && pnpm start        # web: serves apps/web/.output/server/index.mjs
pnpm poller:build && ./bin/poller
```

Use `db:migrate` (not `push`) in prod. No Dockerfile/CI yet. See `apps/web/README.md` (routes, API, stats model, degraded mode) and `services/poller/README.md` (pipeline details).
