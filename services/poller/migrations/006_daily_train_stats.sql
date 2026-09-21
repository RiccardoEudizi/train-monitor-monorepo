-- Run-level daily rollup for all-time train/global stats.
-- train_runs/stops are a 30-day hot window; this table keeps one row per
-- (run_date, numero, origine_code) forever (~hundreds of rows/day).
-- Region attribution is frozen at rollup time with the same rule the app
-- uses live: last stop with actual data, else origine station (callers
-- still pass it through resolveRegion for the major-station override).
CREATE TABLE IF NOT EXISTS daily_train_stats (
  run_date DATE NOT NULL,
  numero TEXT NOT NULL,
  origine_code TEXT NOT NULL,
  last_delay INTEGER NOT NULL DEFAULT 0,
  max_delay INTEGER NOT NULL DEFAULT 0,
  provvedimento INTEGER NOT NULL DEFAULT 0,
  region_id INTEGER,
  region_station TEXT,
  UNIQUE (run_date, numero, origine_code)
);
CREATE INDEX IF NOT EXISTS daily_train_stats_numero_idx ON daily_train_stats (numero);
CREATE INDEX IF NOT EXISTS daily_train_stats_date_idx ON daily_train_stats (run_date);

-- Backfill from the current hot window (exact per-run finals).
INSERT INTO daily_train_stats (run_date, numero, origine_code, last_delay, max_delay, provvedimento, region_id, region_station)
SELECT r.data_partenza, r.numero, r.origine_code, r.last_delay, r.max_delay, r.provvedimento,
  COALESCE(sl.region_id, so.region_id), COALESCE(sl.code, so.code)
FROM train_runs r
LEFT JOIN LATERAL (
  SELECT stat.region_id AS region_id, st.station_code AS code
  FROM stops st
  LEFT JOIN stations stat ON stat.code = st.station_code
  WHERE st.run_id = r.id
    AND (st.actual_arr IS NOT NULL OR st.actual_dep IS NOT NULL)
  ORDER BY st.order_idx DESC
  LIMIT 1
) sl ON true
LEFT JOIN stations so ON so.code = r.origine_code
ON CONFLICT (run_date, numero, origine_code) DO NOTHING;
