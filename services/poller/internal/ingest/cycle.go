// Package ingest is the ingest scheduler: fast refresh of active trains,
// slower discovery of new trains, and infrequent rollup/meta/cleanup jobs.
// Only live fields of circulating trains are rewritten; static schedule
// data is stored once at discovery and finished trains are never refetched.
package ingest

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riccardoeudizi/train-monitor-poller/internal/vt"
)

type Config struct {
	// ActiveInterval is the refresh period for trains inside their live
	// window (default 40s). Only changed runs are rewritten.
	ActiveInterval time.Duration
	// DiscoveryInterval is the board-sweep period for finding new trains
	// (default 300s). Known runs are skipped, so sweeps write almost nothing.
	DiscoveryInterval time.Duration
	// RollupInterval folds today's stops/runs into daily aggregates
	// (default 600s). Converges to end-of-day truth without rewriting
	// every active cycle.
	RollupInterval time.Duration
	// StatsInterval refreshes national counters (default 300s).
	StatsInterval time.Duration
	// TickerInterval refreshes the infomobility ticker (default 900s).
	TickerInterval time.Duration
	Workers        int
	MajorsOnly     bool
	// PreDeparture is how early before orario_partenza a run enters the
	// active window (default 30m).
	PreDeparture time.Duration
	// PostArrivalGrace keeps a run active just past arrival (shifted by
	// delay) so the final snapshot is written (default 5m).
	PostArrivalGrace time.Duration
}

// runRetentionDays bounds train_runs/stops (current truth) to a hot window.
// Station history beyond this lives in daily_stop_stats (kept forever).
const runRetentionDays = 30

// Cycle runs one full legacy discovery + detail pass. Kept for one-shot
// tooling; the long-running Loop below uses the tiered scheduler instead.
func Cycle(ctx context.Context, pool *pgxpool.Pool, client *vt.Client, cfg Config) error {
	stations, err := stationsForCycle(ctx, pool, cfg.MajorsOnly)
	if err != nil {
		return err
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

// Loop runs the tiered scheduler forever:
//   - active refresh every ActiveInterval (default 40s, no night slowdown),
//   - board discovery every DiscoveryInterval (new trains only),
//   - rollup/stats/ticker/cleanup on their own slower tickers.
//
// Discovery and active loops run in separate goroutines so a slow 520-board
// sweep never delays the 40s live refresh.
func Loop(ctx context.Context, pool *pgxpool.Pool, client *vt.Client, cfg Config) {
	// Initial pass: seed known trains, then refresh live ones immediately.
	log.Printf("initial discovery sweep")
	if ds := discoveryCycle(ctx, pool, client, cfg); ctx.Err() == nil {
		log.Printf("discovery: stations=%d candidates=%d new=%d stops=%d errors=%d",
			ds.stations, ds.candidates, ds.newRuns, ds.stops, ds.errors)
	}
	if ctx.Err() == nil {
		if as := activeCycle(ctx, pool, client, cfg); ctx.Err() == nil {
			log.Printf("active: active=%d fetched=%d unchanged=%d stored=%d stops=%d errors=%d",
				as.active, as.fetched, as.unchanged, as.stored, as.stops, as.errors)
		}
	}
	if ctx.Err() == nil {
		if err := rollupToday(ctx, pool); err != nil {
			log.Printf("rollup: %v", err)
		}
		if err := rollupTrainToday(ctx, pool); err != nil {
			log.Printf("rollup-train: %v", err)
		}
		if err := cleanupOldRuns(ctx, pool); err != nil {
			log.Printf("cleanup: %v", err)
		}
		publishStats(ctx, pool, client)
		publishTicker(ctx, pool, client)
	}

	go activeLoop(ctx, pool, client, cfg)
	go discoveryLoop(ctx, pool, client, cfg)
	go slowLoop(ctx, pool, client, cfg)

	<-ctx.Done()
}

func activeLoop(ctx context.Context, pool *pgxpool.Pool, client *vt.Client, cfg Config) {
	t := time.NewTicker(cfg.ActiveInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			start := time.Now()
			as := activeCycle(ctx, pool, client, cfg)
			log.Printf("active: active=%d fetched=%d unchanged=%d stored=%d stops=%d errors=%d in %s",
				as.active, as.fetched, as.unchanged, as.stored, as.stops, as.errors,
				time.Since(start).Round(time.Second))
		}
	}
}

func discoveryLoop(ctx context.Context, pool *pgxpool.Pool, client *vt.Client, cfg Config) {
	t := time.NewTicker(cfg.DiscoveryInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			start := time.Now()
			ds := discoveryCycle(ctx, pool, client, cfg)
			log.Printf("discovery: stations=%d candidates=%d new=%d stops=%d errors=%d in %s",
				ds.stations, ds.candidates, ds.newRuns, ds.stops, ds.errors,
				time.Since(start).Round(time.Second))
		}
	}
}

func slowLoop(ctx context.Context, pool *pgxpool.Pool, client *vt.Client, cfg Config) {
	rollupT := time.NewTicker(cfg.RollupInterval)
	defer rollupT.Stop()
	statsT := time.NewTicker(cfg.StatsInterval)
	defer statsT.Stop()
	tickerT := time.NewTicker(cfg.TickerInterval)
	defer tickerT.Stop()
	cleanupT := time.NewTicker(24 * time.Hour)
	defer cleanupT.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-rollupT.C:
			if err := rollupToday(ctx, pool); err != nil {
				log.Printf("rollup: %v", err)
			}
			if err := rollupTrainToday(ctx, pool); err != nil {
				log.Printf("rollup-train: %v", err)
			}
		case <-statsT.C:
			publishStats(ctx, pool, client)
		case <-tickerT.C:
			publishTicker(ctx, pool, client)
		case <-cleanupT.C:
			if err := cleanupOldRuns(ctx, pool); err != nil {
				log.Printf("cleanup: %v", err)
			}
		}
	}
}
