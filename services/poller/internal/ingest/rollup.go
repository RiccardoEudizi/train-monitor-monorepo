package ingest

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// rollupToday folds today's current stops into daily_stop_stats (upserted,
// so repeated runs converge to the end-of-day truth) for the app's
// 24h/7d/30d charts. DISTINCT ON keeps one row per unique key: the same
// train number can run from different origins on the same day.
func rollupToday(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, rollupStopsSQL)
	return err
}

// rollupTrainToday folds today's runs into daily_train_stats (upserted, so
// repeated runs converge to the end-of-day truth). One row per run, kept
// forever, so the app's train/global "total" stats survive the 30-day
// train_runs retention window. Region attribution is frozen with the same
// rule fetchOverview uses live: last stop with actual data, else origine.
func rollupTrainToday(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, rollupTrainsSQL)
	return err
}

// cleanupOldRuns deletes runs (cascading to stops) older than the retention
// window. Daily aggregates in daily_stop_stats and daily_train_stats are
// kept forever.
func cleanupOldRuns(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, cleanupRunsSQL, runRetentionDays)
	return err
}
