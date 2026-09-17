# train-monitor-poller

Go ingester for train-monitor-v2. Polls ViaggiaTreno, writes Postgres.
No aggregation here — the app computes stats in SQL.

## How it works

Each cycle:

1. **Discover** — `partenze` + `arrivi` boards for the target stations
   (`stations WHERE is_major`, or all stations when `MAJORS_ONLY=false`)
   → active train numbers.
2. **Resolve** — `cercaNumeroTrenoTrenoAutocomplete` → `(numero, origine, midnight)`
   triple, latest only.
3. **Store** — `andamentoTreno` → upsert `train_runs` + `stops` (current truth),
   append `stop_snapshots` only when a stop's delays/status changed
   (plus a full heartbeat write every 15th cycle, ~30 min at 2-min intervals,
   so charts can tell "still +5" apart from "no data").
4. **Rollup** — today's stops folded into `daily_stop_stats` (upserted, converges
   to end-of-day truth); snapshots older than 14 days deleted
   (`daily_stop_stats` kept forever).
5. **Info** — `statistiche` + `infomobilitaTicker` → `info_news`
   (national counters + ticker items as `string[]`).

`204` responses (cancelled / no data) are skipped, not errors.
`data_partenza` is derived from the midnight timestamp in `Europe/Rome`, not UTC.

## Setup

```bash
cp .env.example .env   # set DATABASE_URL
psql $DATABASE_URL -f migrations/001_schema.sql
psql $DATABASE_URL -f migrations/002_snapshot_retention.sql
psql $DATABASE_URL -f migrations/004_majors.sql
go run ./cmd/seed      # all stations from elencoStazioni/0..22 (never touches is_major)
go run ./cmd/poller    # loop every POLL_INTERVAL_SECONDS (default 120)
```

`003_tier2_majors.sql` is kept for existing DBs; fresh installs only need
`004_majors.sql`, which holds the full 200-station list (Tier-1 + Tier-2,
the single source of truth). Re-running seed is safe: it upserts station
details without clearing `is_major`.

## Config

| Var | Default | Meaning |
| --- | ------- | ------- |
| `DATABASE_URL` | — | Postgres connection string (required) |
| `POLL_INTERVAL_SECONDS` | `120` | Seconds between cycles |
| `WORKERS` | `25` | Max concurrent ViaggiaTreno requests |
| `MAJORS_ONLY` | `true` | Poll only `is_major` stations; `false` sweeps all seeded stations |

## Layout

- `cmd/poller` — ingest loop (graceful shutdown on SIGINT/SIGTERM).
- `cmd/seed` — station seeding from `elencoStazioni`.
- `internal/ingest` — discovery → detail → store → rollup pipeline.
- `internal/vt` — minimal ViaggiaTreno client.
- `internal/db` — pool + station queries.
- `internal/env` — `.env` loader + typed getters.
- `migrations/` — schema, retention index, majors list.
