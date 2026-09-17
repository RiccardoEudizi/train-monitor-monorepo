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
	env.Load("")     // services/poller/.env when launched from services/poller
	env.Load("../..") // monorepo-root .env fallback (missing file is ignored)
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
		Interval:   time.Duration(env.Int("POLL_INTERVAL_SECONDS", 120)) * time.Second,
		Workers:    env.Int("WORKERS", 25),
		MajorsOnly: env.Bool("MAJORS_ONLY", true),
	}
	log.Printf("poller starting: interval=%s workers=%d majorsOnly=%v", cfg.Interval, cfg.Workers, cfg.MajorsOnly)
	ingest.Loop(ctx, pool, vt.NewClient(), cfg)
}
