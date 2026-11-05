# Migrations

Fresh installs apply, in order:

```
001_schema.sql
004_majors.sql
005_drop_snapshots.sql   # no-op on fresh DBs (drops legacy table if present)
006_daily_train_stats.sql
007_daily_train_names.sql
008_daily_train_stats_id.sql
009_rfi_topup.sql
010_daily_station_stats.sql
```

`004_majors.sql` (200 stations) + `009_rfi_topup.sql` (60 stations) are the
single source of truth for `is_major` (260 majors total: every RFI MAIN HUB /
HUB / MAJOR station with a live ViaggiaTreno board).
The seeder (`go run ./cmd/seed`) never touches `is_major`.

## 010 — bounding `daily_stop_stats`

`daily_stop_stats` is one row per train-stop per day, forever (~2 GB/year).
Station totals and series only need one row per station-day, so 010:

1. creates `daily_station_stats` and backfills it from all existing per-stop rows;
2. adds `stops_count` / `avg_stop_delay` to `daily_train_stats` and backfills
   them (exact from `stops` for the hot window, from `daily_stop_stats` for older
   runs) so pruned-train history keeps its mean-delay number;
3. drops the now-unused `daily_stop_stats.numero` index and the dead `samples`
   column.

**Order matters:**

0. On a project at the 1 GB Neon limit, free index headroom first: apply
   [`011_drop_daily_stop_pkey.sql`](011_drop_daily_stop_pkey.sql) and drop
   `daily_stats_numero_idx`. Otherwise the 010 backfill can fail with
   `project size limit (1024 MB) has been exceeded` — creating the new table
   and its indexes needs ~20 MB, and the project has less than that free.
1. Apply `010_daily_station_stats.sql` (backfill happens here).
2. Deploy the poller that writes `daily_station_stats` and prunes
   `daily_stop_stats` (`STOP_STATS_RETENTION_DAYS`, default 7). Deploying the
   poller first would fail its rollup: the new columns/table wouldn't exist.
3. Reclaim disk. `DELETE` only marks space reusable; Neon keeps billing the
   file size. VACUUM cannot run in the migration transaction, so run it once,
   by hand, after the first prune:

```sql
-- Check what you are reclaiming first.
SELECT pg_size_pretty(pg_total_relation_size('daily_stop_stats'));

-- Rewrites the table without dead rows. Needs roughly table-size free space,
-- so do it right after upgrading the plan / freeing headroom.
VACUUM FULL daily_stop_stats;
VACUUM (ANALYZE) daily_station_stats, daily_train_stats;
```

If `VACUUM FULL` fails for lack of space, delete in day-sized batches from the
Neon SQL editor, run `VACUUM daily_stop_stats` between batches, and retry
`VACUUM FULL` once enough is free.

If the poller has been off longer than the retention window, almost every row
is already outside it. Copy the few kept rows, `TRUNCATE`, and re-insert them:
that avoids a multi-million-row `DELETE` (and its WAL), and `TRUNCATE` already
returns the files, so no `VACUUM FULL` is needed:

```sql
BEGIN;
CREATE TEMP TABLE keep_daily_stops AS
  SELECT * FROM daily_stop_stats WHERE run_date >= CURRENT_DATE - 7;
TRUNCATE daily_stop_stats;
INSERT INTO daily_stop_stats SELECT * FROM keep_daily_stops;
COMMIT;
```

The web app reads the same retention window (`STOP_STATS_RETENTION_DAYS`) to
decide between exact per-stop stats and the station-day rollup; keep the two
env values in sync.

## 011 — dropping the unused `daily_stop_stats` pkey

The serial `id` is never read by the app; the natural key
`(run_date, numero, station_code)` is enforced by the unique index that
`ON CONFLICT` already targets. The surrogate pkey index cost ~124 MB at 30
days (~36 MB at the 7-day window), and dropping it is what gives the 010
backfill room on a 1 GB Neon project. Safe to re-run; the `id` column stays
because the web still selects it.

## Archive

`archive/` holds superseded one-shot migrations kept for existing DBs only:

- `002_snapshot_retention.sql` — index on the dropped `stop_snapshots` table.
- `003_tier2_majors.sql` — partial majors list, superseded by `004_majors.sql`.
