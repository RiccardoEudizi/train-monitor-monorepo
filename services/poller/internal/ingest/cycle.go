// Package ingest is the dumb-ingester poll loop: discover active trains from
// boards, fetch andamentoTreno detail, upsert train_runs/stops (current truth,
// 30-day hot window) and fold today's data into daily_stop_stats (per-stop)
// and daily_train_stats (per-run), both kept forever.
// All aggregation lives in the app's SQL views.
package ingest

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riccardoeudizi/train-monitor-poller/internal/vt"
)

type Config struct {
	Interval   time.Duration
	Workers    int
	MajorsOnly bool
}

// runRetentionDays bounds train_runs/stops (current truth) to a hot window.
// Station history beyond this lives in daily_stop_stats (kept forever).
const runRetentionDays = 30

// Cycle runs one full discovery + detail pass.
func Cycle(ctx context.Context, pool *pgxpool.Pool, client *vt.Client, cfg Config) error {
	stations, err := stationsForCycle(ctx, pool, cfg.MajorsOnly)
	if err != nil {
		return fmt.Errorf("stations: %w", err)
	}
	now := time.Now()

	numSet := discoverBoards(ctx, client, stations, cfg.Workers, now)
	log.Printf("discovered %d trains on %d stations", len(numSet), len(stations))

	stopTotal := fetchDetails(ctx, pool, client, numSet, cfg.Workers)
	log.Printf("stops upserted: %d", stopTotal)

	if err := rollupToday(ctx, pool); err != nil {
		log.Printf("rollup: %v", err)
	}
	if err := rollupTrainToday(ctx, pool); err != nil {
		log.Printf("rollup-train: %v", err)
	}
	if err := cleanupOldRuns(ctx, pool); err != nil {
		log.Printf("cleanup: %v", err)
	}

	publishMeta(ctx, pool, client)
	return nil
}

// Loop runs Cycle forever on cfg.Interval.
func Loop(ctx context.Context, pool *pgxpool.Pool, client *vt.Client, cfg Config) {
	t := time.NewTicker(cfg.Interval)
	defer t.Stop()
	for {
		start := time.Now()
		if err := Cycle(ctx, pool, client, cfg); err != nil {
			log.Printf("cycle error: %v", err)
		}
		log.Printf("cycle done in %s", time.Since(start).Round(time.Second))
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
