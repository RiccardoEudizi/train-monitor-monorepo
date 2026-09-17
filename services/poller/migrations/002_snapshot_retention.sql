-- Index for snapshot retention deletes (rilevato_at range scan).
CREATE INDEX IF NOT EXISTS snapshots_rilevato_idx
  ON stop_snapshots (rilevato_at);
