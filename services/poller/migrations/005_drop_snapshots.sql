-- Option A: drop the write-only stop_snapshots table (nothing reads it;
-- station charts use daily_stop_stats, train/global stats use train_runs).
-- Frees ~80-90% of storage on small tiers (table + 3 indexes).
-- One-time prune of old runs so train_runs/stops fit the 30-day hot window
-- enforced by cleanupOldRuns in the poller (cascades to stops).
DROP TABLE IF EXISTS stop_snapshots;
DROP INDEX IF EXISTS snapshots_run_station_time_idx;
DROP INDEX IF EXISTS snapshots_station_time_idx;
DROP INDEX IF EXISTS snapshots_rilevato_idx;

DELETE FROM train_runs WHERE data_partenza < CURRENT_DATE - INTERVAL '30 days';
