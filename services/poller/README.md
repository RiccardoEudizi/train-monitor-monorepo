# train-monitor-poller

Go ingester for train-monitor-v2. Polls ViaggiaTreno, writes Postgres.
No aggregation here — the app computes stats in SQL.
Runs on its own always-on host (not Vercel) against the same `DATABASE_URL`.

## How it works

Tiered scheduler (no night slowdown — the 40s live cadence runs 24/7):

1. **Discover** (every `DISCOVERY_INTERVAL_SECONDS`, default 300) — `partenze` + `arrivi`
   boards for the target stations (`stations WHERE is_major`, or all stations
   when `MAJORS_ONLY=false`) → candidate train numbers → `cercaNumeroTrenoTrenoAutocomplete`.
   Only triples **not yet stored** are fetched (`andamentoTreno`) and inserted
   (schedule captured once). Known runs are skipped: sweeps write almost nothing.
2. **Refresh active** (every `ACTIVE_INTERVAL_SECONDS`, default 40) — runs inside
   their live window (`orario_partenza - PRE_DEPARTURE_MINUTES` … `orario_arrivo +
   delay + POST_ARRIVAL_GRACE_MINUTES`, cancelled excluded) are re-fetched via
   `andamentoTreno` **directly** (no autocomplete round-trip; midnight is rebuilt
   from `data_partenza` in `Europe/Rome`). A run is rewritten only when
   `ritardo` / `provvedimento` / `oraUltimoRilevamento` changed — static schedule
   data is never rewritten and finished trains are never refetched.
3. **Rollup** (every `ROLLUP_INTERVAL_SECONDS`, default 600) — today's stops folded
   into `daily_stop_stats` and today's runs into `daily_train_stats` (both upserted,
   converge to end-of-day truth, kept forever); `train_runs`/`stops` older than 30
   days deleted once a day (cascades to `stops`).
4. **Info** — `statistiche` every `STATS_INTERVAL_SECONDS` (default 300) +
   `infomobilitaTicker` every `TICKER_INTERVAL_SECONDS` (default 900) →
   `info_news` (national counters + ticker items as `string[]`).

`204` responses (cancelled / no data) are skipped, not errors.
`data_partenza` is derived from the midnight timestamp in `Europe/Rome`, not UTC.

## Setup

```bash
cp .env.example .env   # set DATABASE_URL
psql $DATABASE_URL -f migrations/001_schema.sql
psql $DATABASE_URL -f migrations/004_majors.sql
psql $DATABASE_URL -f migrations/009_rfi_topup.sql
psql $DATABASE_URL -f migrations/005_drop_snapshots.sql  # existing DBs only
psql $DATABASE_URL -f migrations/006_daily_train_stats.sql  # existing DBs only
psql $DATABASE_URL -f migrations/007_daily_train_names.sql  # existing DBs only
psql $DATABASE_URL -f migrations/008_daily_train_stats_id.sql  # existing DBs only
go run ./cmd/seed      # all stations from elencoStazioni/0..22 (never touches is_major)
go run ./cmd/poller    # tiered scheduler: live trains every 40s, discovery every 5m
```

`003_tier2_majors.sql` is kept for existing DBs; fresh installs only need
`004_majors.sql` (200 stations) + `009_rfi_topup.sql` (60 stations, every
remaining RFI MAIN HUB / HUB / MAJOR station with a live ViaggiaTreno board),
260 majors total, the single source of truth for `is_major`. Re-running seed
is safe: it upserts station details without clearing `is_major`.

## Config

| Var | Default | Meaning |
| --- | ------- | ------- |
| `DATABASE_URL` | — | Postgres connection string (required) |
| `ACTIVE_INTERVAL_SECONDS` | `40` | Refresh live (circulating) trains; changed runs only (`POLL_INTERVAL_SECONDS` is a deprecated alias) |
| `DISCOVERY_INTERVAL_SECONDS` | `300` | Board sweep for new trains (known runs skipped) |
| `ROLLUP_INTERVAL_SECONDS` | `600` | Fold today's data into `daily_*` aggregates |
| `STATS_INTERVAL_SECONDS` | `300` | Refresh national counters (`info_news kind=stats`) |
| `TICKER_INTERVAL_SECONDS` | `900` | Refresh infomobility ticker (`info_news kind=ticker`) |
| `PRE_DEPARTURE_MINUTES` | `30` | Run enters live window this early before `orario_partenza` |
| `POST_ARRIVAL_GRACE_MINUTES` | `5` | Run stays live this long past `orario_arrivo` + delay |
| `WORKERS` | `25` | Max concurrent ViaggiaTreno requests |
| `MAJORS_ONLY` | `true` | Poll only `is_major` stations; `false` sweeps all seeded stations |

Env lookup: `services/poller/.env`, then the monorepo-root `.env` (a single root `.env` covers both the poller and the web app). Real environment variables always win.

## Layout

- `cmd/poller` — ingest loop (graceful shutdown on SIGINT/SIGTERM).
- `cmd/seed` — station seeding from `elencoStazioni`.
- `internal/ingest` — discovery → detail → store → rollup pipeline.
- `internal/vt` — minimal ViaggiaTreno client.
- `internal/db` — pool + station queries.
- `internal/env` — `.env` loader + typed getters.
- `migrations/` — schema, majors list, snapshot-removal + retention prune.
