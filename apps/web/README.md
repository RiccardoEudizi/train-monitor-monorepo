# train-monitor-v2

Public, no-auth live board of Italian train delays. SolidStart + SolidJS + Tailwind v4 + Drizzle + Postgres.

Data comes from Postgres, written by the Go poller (`../train-monitor-poller`). The app never calls ViaggiaTreno directly.

## Setup

```bash
cp .env.example .env   # set DATABASE_URL
pnpm install
pnpm db:push           # create tables (drizzle)
pnpm dev
```

Without `DATABASE_URL` the app runs in degraded mode: station search works from the built-in Tier-1 seed, live sections show empty states.

## Routes

| Route | Source |
|---|---|
| `/` dashboard (counters, top delays, search) | `GET /api/delays`, `GET /api/news`, `GET /api/live` |
| `/ritardi` full ranking + filters | `GET /api/delays?min=&cat=` |
| `/stazione/[code]` live board + 30d history | `GET /api/board`, `GET /api/stats?scope=station`, `GET /api/live?station=` |
| `/treno/[numero]` detail + stops + history | `GET /api/train`, `GET /api/stats?scope=train`, `GET /api/live?train=` |

API responses are UI-ready shapes (`src/lib/api-types.ts`), never raw ViaggiaTreno.

## Stats model

Aggregates run over `train_runs` (one row per `(numero, origine, data)` triple): `final` = destination arrival delay, `max` = worst en-route, `recupero = max - final`. Cancellations counted separately. See `src/routes/api/stats.ts`.
