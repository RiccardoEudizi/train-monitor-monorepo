# Ritardometro

Public, no-auth live board of Italian train delays. SolidStart + SolidJS + Tailwind v4 + Drizzle + Postgres.

Data flow: `ViaggiaTreno → Go poller → Postgres → SolidStart`. The app never calls ViaggiaTreno directly.

## Tech stack

| Piece | Version |
|---|---|
| `@solidjs/start` / `solid-js` / `@solidjs/router` | 2.0.0 / 1.9.14 / 1.0 |
| `vite` / `nitro` | 8 / 3 beta |
| `tailwindcss` / `@tailwindcss/vite` | 4.3.3 |
| `drizzle-orm` / `drizzle-kit` | 0.44.5 / 0.31.4 |
| `postgres` | 3.4.5 |
| `@kobalte/core` / `@fontsource/geist-mono` | 0.13.14 / 5.3 |
| `node` / `pnpm` | >=24 / 10.13.1 |

## Prerequisites

- Node >=24, pnpm 10.13.1
- Postgres URL (`DATABASE_URL`)

## Setup

```bash
cp .env.example .env   # set DATABASE_URL
pnpm install
pnpm db:push           # create tables (drizzle, dev)
pnpm dev
```

| Script | What |
|---|---|
| `pnpm dev` | `vite dev` |
| `pnpm build` / `pnpm start` | `vite build` → `node .output/server/index.mjs` (Nitro) |
| `pnpm db:push` | push `src/db/schema.ts` (dev) |
| `pnpm db:generate` / `db:migrate` / `db:studio` | generate/migrate/inspect (prod uses migrate) |

## Environment

Only `DATABASE_URL` (server-only, never `VITE_*`):

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/train_monitor_v2
```

Loading order: `vite.config.ts` preloads `apps/web/.env` for dev SSR, `drizzle.config.ts` for CLI, `src/server/db.ts` walks `apps/web/.env` → repo-root `.env` → `cwd/.env` as fallback. Nitro loads `.env` itself in prod.

DB client: `@neondatabase/serverless` HTTP driver (`drizzle-orm/neon-http`, see `src/server/db.ts`) — no TCP pooling to configure, safe on serverless. Works with any Postgres URL; on Neon either the direct or pooled string works.

## Poller contract

Live data is written by the Go poller (`../../services/poller`): `stations`, `train_runs` (30-day window), `stops`, `daily_stop_stats` (per-stop rollup, kept forever), `daily_train_stats` (per-run rollup, kept forever), `info_news(kind=ticker|news|lavori|stats, payload=jsonb)`. No poller = degraded mode (below). Seed target list: `src/lib/stations-seed.ts` (85 Tier-1 majors).

## Architecture

- `src/routes/` file-routes + `src/app.tsx` (`Router` + `FileRoutes` + `Nav`)
- `src/server/data.ts` shared fetchers used by both `src/routes/api/*` adapters and `src/lib/queries.ts` `query()` + `createAsync` SSR functions
- `src/lib/api-types.ts` UI-ready shapes (`TrainCard`, `StopRow`, `PeriodStats`, `RegionStat`) + `statoFor` / `temporalStatus` / `displayStatus`
- `src/lib/sse.ts` `useLive()` EventSource helper (backoff, hydration-safe)
- `src/components/` `Nav`, `CommandPalette` (Ctrl+K), `ui` (`Card`, `EmptyState`, `ErrorBox`, `Field`, `TrainRow`, ASCII charts), `fx` (CSS transitions)
- Tailwind v4 via `@tailwindcss/vite`, dark mode via `tm-theme` cookie (`src/lib/theme.ts`)

## Routes + API

| Page | Data |
|---|---|
| `/` dashboard (counters, overview, search, top delays) | `getDelaysQuery(1,"",20)`, `getNewsQuery()`, `getOverviewQuery("30d")`, `fetch(/api/stations?q=)`, `useLive(/api/live)` |
| `/ritardi` ranking + filters (`min=5`, `limit=100`, `cat=FR,IC,REG`) | `GET /api/delays?min=&cat=&limit=` (1-200) |
| `/stazione/[code]` board + 30d history | `GET /api/board?station=`, `GET /api/stats?scope=station&code=&period=`, `GET /api/live?station=` |
| `/treno/[numero]` detail + stops + history | `GET /api/train?n=&origine=&date=` (`candidates[]+live+stops[]`), `GET /api/stats?scope=train&numero=&period=`, `GET /api/live?train=` |

Also: `GET /api/stations?q=` (q>=2 chars), `GET /api/stats?scope=overview&period=1d|7d|30d|total` (aliases `24h/day`, `week`, `month`, `all/totale`), `GET /api/news`, `GET /api/live` SSE (12s DB poll, change-only push else `heartbeat:true`).

## Stats model

Aggregates run over `train_runs` keyed by `(numero, origine_code, data_partenza)`: `final` = destination arrival delay, `max` = worst en-route, `recupero = max - final`. `scope=station` reads the `daily_stop_stats` rollup instead. Train/global `total`/`all` reads the `daily_train_stats` per-run rollup (kept forever, region attribution frozen at rollup time); bounded periods read live `train_runs`. Overview attributes each run once to its last-relevamento region (`src/lib/regions.ts`), ranks by cumulative delay, threshold `>0'`. See `src/routes/api/stats.ts`, `src/server/data.ts`.

## Degraded mode (no DB)

Without `DATABASE_URL`: `db()==null → dbConfigured:false`. Station search + board fall back to the Tier-1 seed; delays/train/stats/news/live return empty + banners. DB errors return `degraded:true` with seed fallback for search.

## Live updates

SSE at `/api/live[?station=][?train=]`, 12s poll, diff-push or heartbeat. Client `useLive()` connects only after mount (no hydration mismatch), exponential backoff to 30s, `revalidate()` on data messages.

## Responsive layout

Panoramica (`/`) adapts below the `md` breakpoint (`src/routes/index.tsx`):

- Header: fetch spinner shim renders right of the period chips on mobile, left on `sm+` (`order-last sm:order-first`, DOM order unchanged).
- Stat blocks with charts (`media nazionale`, `incidenza`): text column left, chart right on mobile via an `md:contents` wrapper — `md+` stacks exactly as before.
- Trend chart renders 4 rows on mobile (≈ text-column height) vs 7 on desktop, via a mount-only `matchMedia("(min-width: 768px)")` signal (SSR renders the mobile variant, desktop upgrades on hydrate).

## Deployment

```bash
pnpm build && pnpm start   # serves .output/server/index.mjs (self-hosted)
```

On Vercel: project Root Directory `apps/web`, `NITRO_PRESET=vercel` env var (build emits `.vercel/output/`), Node.js 24.x, `DATABASE_URL` from the Neon Marketplace integration. Ignored Build Step `git diff --quiet HEAD^ HEAD -- apps/web/` skips poller-only commits.

Use `db:migrate` (not `push`) in prod. No CI yet.

## Repo map

`src/routes/api/*` adapters · `src/server/db.ts|data.ts` · `src/db/schema.ts` (6 tables) · `src/lib/queries|api-types|sse|format|regions|stations-seed` · `src/components/Nav|CommandPalette|ui|fx` · `drizzle.config.ts` (`out=./drizzle`, `dialect=postgresql`) · `public/favicon.ico`.
