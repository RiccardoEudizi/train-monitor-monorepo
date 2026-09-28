// Command poller runs the ViaggiaTreno ingest loop forever.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/riccardoeudizi/train-monitor-poller/internal/db"
	"github.com/riccardoeudizi/train-monitor-poller/internal/env"
	"github.com/riccardoeudizi/train-monitor-poller/internal/ingest"
	"github.com/riccardoeudizi/train-monitor-poller/internal/vt"
)

func main() {
	env.LoadDefaults()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if os.Getenv("DATABASE_URL") == "" {
		log.Fatal("DATABASE_URL not set")
	}
	pool, err := db.Pool(ctx)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("db ping: %v", err)
	}

	cfg := ingest.Config{
		ActiveInterval:    activeInterval(),
		DiscoveryInterval: time.Duration(env.Int("DISCOVERY_INTERVAL_SECONDS", 300)) * time.Second,
		RollupInterval:    time.Duration(env.Int("ROLLUP_INTERVAL_SECONDS", 600)) * time.Second,
		StatsInterval:     time.Duration(env.Int("STATS_INTERVAL_SECONDS", 300)) * time.Second,
		TickerInterval:    time.Duration(env.Int("TICKER_INTERVAL_SECONDS", 900)) * time.Second,
		Workers:           env.Int("WORKERS", 25),
		MajorsOnly:        env.Bool("MAJORS_ONLY", true),
		PreDeparture:      time.Duration(env.Int("PRE_DEPARTURE_MINUTES", 30)) * time.Minute,
		PostArrivalGrace:  time.Duration(env.Int("POST_ARRIVAL_GRACE_MINUTES", 5)) * time.Minute,
	}
	log.Printf("poller starting: active=%s discovery=%s rollup=%s stats=%s ticker=%s workers=%d majorsOnly=%v pre=%s grace=%s",
		cfg.ActiveInterval, cfg.DiscoveryInterval, cfg.RollupInterval, cfg.StatsInterval, cfg.TickerInterval,
		cfg.Workers, cfg.MajorsOnly, cfg.PreDeparture, cfg.PostArrivalGrace)
	ingest.Loop(ctx, pool, vt.NewClient(), cfg)
}

// activeInterval defaults to 40s for live trains. POLL_INTERVAL_SECONDS is
// kept as a deprecated alias so existing .env files keep working.
func activeInterval() time.Duration {
	if v := os.Getenv("ACTIVE_INTERVAL_SECONDS"); v != "" {
		return time.Duration(env.Int("ACTIVE_INTERVAL_SECONDS", 40)) * time.Second
	}
	return time.Duration(env.Int("POLL_INTERVAL_SECONDS", 40)) * time.Second
}
