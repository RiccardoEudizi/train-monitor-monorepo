-- 011: drop the unused surrogate primary key on daily_stop_stats.
--
-- The table is keyed by the unique (run_date, numero, station_code) index
-- used by ON CONFLICT; the serial `id` is never read by the app. The pkey
-- index cost ~124 MB at 30 days (~36 MB at the 7-day window) and, on a 1 GB
-- Neon project, was the headroom that made the 010 backfill fail.
--
-- Safe to re-run. Apply before 010 when the project is at its size limit;
-- on a fresh database it can run after 010 (it only frees an index).
ALTER TABLE daily_stop_stats DROP CONSTRAINT IF EXISTS daily_stop_stats_pkey;
