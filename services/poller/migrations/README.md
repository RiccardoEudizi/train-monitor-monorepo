# Migrations

Fresh installs apply, in order:

```
001_schema.sql
004_majors.sql
005_drop_snapshots.sql   # no-op on fresh DBs (drops legacy table if present)
006_daily_train_stats.sql
007_daily_train_names.sql
008_daily_train_stats_id.sql
```

`004_majors.sql` (200 stations) is the single source of truth for `is_major`.
The seeder (`go run ./cmd/seed`) never touches `is_major`.

## Archive

`archive/` holds superseded one-shot migrations kept for existing DBs only:

- `002_snapshot_retention.sql` — index on the dropped `stop_snapshots` table.
- `003_tier2_majors.sql` — partial majors list, superseded by `004_majors.sql`.
