-- Names for historic run display (train detail page lists pruned runs
-- summary-only from daily_train_stats; stops are gone with retention).
ALTER TABLE daily_train_stats ADD COLUMN IF NOT EXISTS origine TEXT;
ALTER TABLE daily_train_stats ADD COLUMN IF NOT EXISTS destinazione TEXT;

-- Backfill from the hot window (matches every row the 006 backfill wrote).
UPDATE daily_train_stats d
SET origine = r.origine, destinazione = r.destinazione
FROM train_runs r
WHERE r.numero = d.numero
  AND r.origine_code = d.origine_code
  AND r.data_partenza = d.run_date;
