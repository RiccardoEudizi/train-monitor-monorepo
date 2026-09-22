-- The drizzle schema declares id SERIAL PRIMARY KEY on daily_train_stats
-- (and .select() fetches all columns), but 006 created the table without
-- it. Existing DBs only; 001 already carries the full definition.
ALTER TABLE daily_train_stats ADD COLUMN IF NOT EXISTS id SERIAL PRIMARY KEY;
