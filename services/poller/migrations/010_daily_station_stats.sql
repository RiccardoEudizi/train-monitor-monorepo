-- 010: bound `daily_stop_stats`, add `daily_station_stats`, extend
-- `daily_train_stats` with the per-run stop summary.
--
-- Why: `daily_stop_stats` is one row per train-stop per day, kept forever
-- (~2 GB/year at current traffic) but only read for the 30-day hot window.
-- Station totals/series and pruned-train history are now served from one row
-- per station-day / per-run, so the per-stop table can be pruned.
--
-- Run this BEFORE deploying the poller that prunes `daily_stop_stats`.
-- Reclaiming disk needs a separate, non-transactional VACUUM (see
-- migrations/README.md) — the DELETE below is left to the poller's daily
-- cleanup so it doesn't bloat one migration transaction.

-- ── station-day rollup (kept forever) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_station_stats (
  id SERIAL PRIMARY KEY,
  run_date DATE NOT NULL,
  station_code TEXT NOT NULL,
  runs INTEGER NOT NULL DEFAULT 0,
  -- sum of delay_arr_final, for avg/total
  sum_final INTEGER NOT NULL DEFAULT 0,
  -- sum of delay_max, for future avg-enroute metrics
  sum_max INTEGER NOT NULL DEFAULT 0,
  -- max of delay_max (the station page's "max" card)
  max_delay INTEGER NOT NULL DEFAULT 0,
  cancelled INTEGER NOT NULL DEFAULT 0,
  -- stops whose final delay was > 0 (DELAY_THRESHOLD)
  delayed INTEGER NOT NULL DEFAULT 0,
  -- per-day p95 of delay_arr_final; multi-day reads use a runs-weighted mean
  p95_final INTEGER NOT NULL DEFAULT 0,
  -- worst stop of the day: max(delay_max), then max(delay_arr_final),
  -- then lowest numero (deterministic)
  worst_numero TEXT,
  worst_delay INTEGER NOT NULL DEFAULT 0,
  worst_final INTEGER NOT NULL DEFAULT 0,
  worst_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (run_date, station_code)
);
CREATE INDEX IF NOT EXISTS daily_station_stats_station_idx
  ON daily_station_stats (station_code, run_date);

-- Backfill every day currently in daily_stop_stats. Safe to re-run.
INSERT INTO daily_station_stats (
  run_date, station_code, runs, sum_final, sum_max, max_delay,
  cancelled, delayed, p95_final,
  worst_numero, worst_delay, worst_final, worst_cancelled
)
SELECT
  run_date,
  station_code,
  count(*)::int,
  COALESCE(sum(delay_arr_final), 0)::int,
  COALESCE(sum(delay_max), 0)::int,
  COALESCE(max(delay_max), 0)::int,
  count(*) FILTER (WHERE cancelled)::int,
  count(*) FILTER (WHERE delay_arr_final > 0)::int,
  COALESCE(percentile_disc(0.95) WITHIN GROUP (ORDER BY delay_arr_final), 0)::int,
  (array_agg(numero ORDER BY delay_max DESC, delay_arr_final DESC, numero ASC))[1],
  COALESCE(max(delay_max), 0)::int,
  (array_agg(delay_arr_final ORDER BY delay_max DESC, delay_arr_final DESC, numero ASC))[1],
  (array_agg(cancelled ORDER BY delay_max DESC, delay_arr_final DESC, numero ASC))[1]
FROM daily_stop_stats
GROUP BY run_date, station_code
ON CONFLICT (run_date, station_code) DO NOTHING;

-- ── per-run stop summary (used for pruned-train history) ─────────────────────
ALTER TABLE daily_train_stats
  ADD COLUMN IF NOT EXISTS stops_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_train_stats
  ADD COLUMN IF NOT EXISTS avg_stop_delay INTEGER NOT NULL DEFAULT 0;

-- Exact, for runs still inside the 30-day hot window.
UPDATE daily_train_stats d
SET stops_count = s.n, avg_stop_delay = s.a
FROM (
  SELECT r.data_partenza AS run_date,
         r.numero,
         r.origine_code,
         count(*)::int AS n,
         COALESCE(round(avg(GREATEST(st.delay_arr, st.delay_dep))), 0)::int AS a
  FROM train_runs r
  JOIN stops st ON st.run_id = r.id
  WHERE st.actual_arr IS NOT NULL OR st.actual_dep IS NOT NULL
  GROUP BY r.data_partenza, r.numero, r.origine_code
) s
WHERE d.run_date = s.run_date
  AND d.numero = s.numero
  AND d.origine_code = s.origine_code
  AND d.stops_count = 0;

-- Older runs: derive one value per (date, numero) from the per-stop rollup.
-- It is copied to every origine_code row of that date; the read path weights
-- by stops_count, so the date mean stays correct.
UPDATE daily_train_stats d
SET stops_count = s.n, avg_stop_delay = s.a
FROM (
  SELECT run_date,
         numero,
         count(*)::int AS n,
         COALESCE(round(avg(delay_arr_final)), 0)::int AS a
  FROM daily_stop_stats
  GROUP BY run_date, numero
) s
WHERE d.run_date = s.run_date
  AND d.numero = s.numero
  AND d.stops_count = 0;

-- `numero` is no longer queried on the per-stop table (train history reads
-- daily_train_stats); `samples` has been dead since 005.
DROP INDEX IF EXISTS daily_stats_numero_idx;
ALTER TABLE daily_stop_stats DROP COLUMN IF EXISTS samples;
