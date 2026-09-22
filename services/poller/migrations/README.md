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
```

`004_majors.sql` (200 stations) + `009_rfi_topup.sql` (60 stations) are the
single source of truth for `is_major` (260 majors total: every RFI MAIN HUB /
HUB / MAJOR station with a live ViaggiaTreno board).
The seeder (`go run ./cmd/seed`) never touches `is_major`.

## Archive

`archive/` holds superseded one-shot migrations kept for existing DBs only:

- `002_snapshot_retention.sql` — index on the dropped `stop_snapshots` table.
- `003_tier2_majors.sql` — partial majors list, superseded by `004_majors.sql`.
