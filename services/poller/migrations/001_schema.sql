-- Mirrors apps/web/src/db/schema.ts.
-- The poller is a dumb ingester: upsert train_runs/stops (current truth),
-- roll up daily_stop_stats (kept forever), prune train_runs older than 30d.

CREATE TABLE IF NOT EXISTS stations (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT,
  city TEXT,
  region_id INTEGER,
  lat REAL,
  lon REAL,
  is_major BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS stations_name_idx ON stations (name);
CREATE INDEX IF NOT EXISTS stations_major_idx ON stations (is_major);

CREATE TABLE IF NOT EXISTS train_runs (
  id SERIAL PRIMARY KEY,
  numero TEXT NOT NULL,
  origine_code TEXT NOT NULL,
  data_partenza DATE NOT NULL,
  categoria TEXT,
  origine TEXT,
  destinazione TEXT,
  dest_code TEXT,
  tipo_treno TEXT,
  provvedimento INTEGER NOT NULL DEFAULT 0,
  orario_partenza TIMESTAMPTZ,
  orario_arrivo TIMESTAMPTZ,
  last_delay INTEGER NOT NULL DEFAULT 0,
  max_delay INTEGER NOT NULL DEFAULT 0,
  last_rilevamento_at TIMESTAMPTZ,
  last_rilevamento_stazione TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (numero, origine_code, data_partenza)
);
CREATE INDEX IF NOT EXISTS train_runs_numero_idx ON train_runs (numero);
CREATE INDEX IF NOT EXISTS train_runs_data_idx ON train_runs (data_partenza);

CREATE TABLE IF NOT EXISTS stops (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES train_runs (id) ON DELETE CASCADE,
  station_code TEXT NOT NULL,
  order_idx INTEGER NOT NULL DEFAULT 0,
  tipo_fermata TEXT,
  programmata_arr TIMESTAMPTZ,
  programmata_dep TIMESTAMPTZ,
  actual_arr TIMESTAMPTZ,
  actual_dep TIMESTAMPTZ,
  delay_arr INTEGER NOT NULL DEFAULT 0,
  delay_dep INTEGER NOT NULL DEFAULT 0,
  actual_type INTEGER NOT NULL DEFAULT 1,
  binario_prog TEXT,
  binario_real TEXT,
  UNIQUE (run_id, station_code)
);
CREATE INDEX IF NOT EXISTS stops_station_idx ON stops (station_code);

CREATE TABLE IF NOT EXISTS daily_stop_stats (
  id SERIAL PRIMARY KEY,
  run_date DATE NOT NULL,
  numero TEXT NOT NULL,
  station_code TEXT NOT NULL,
  delay_arr_final INTEGER NOT NULL DEFAULT 0,
  delay_max INTEGER NOT NULL DEFAULT 0,
  cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  samples INTEGER NOT NULL DEFAULT 0,
  UNIQUE (run_date, numero, station_code)
);
CREATE INDEX IF NOT EXISTS daily_stats_numero_idx ON daily_stop_stats (numero);
CREATE INDEX IF NOT EXISTS daily_stats_station_idx ON daily_stop_stats (station_code);

CREATE TABLE IF NOT EXISTS info_news (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
