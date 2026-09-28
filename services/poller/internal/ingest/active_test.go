package ingest

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riccardoeudizi/train-monitor-poller/internal/vt"
)

// TestActiveWindowGate covers the write-reduction scheduler: midnight
// round-trip, active-window selection, change detection, exists check.
func TestActiveWindowGate(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	// NOTE: pool is closed in a t.Cleanup registered BEFORE the row-delete
	// cleanup, so cleanups run in reverse order: delete row, then close pool.
	// (A plain `defer pool.Close()` would close before cleanups run.)
	t.Cleanup(func() { pool.Close() })

	// midnight round-trip: today -> millis -> date string
	todayRome := time.Now().In(romeLoc).Format("2006-01-02")
	mid, err := midnightMillis(todayRome)
	if err != nil {
		t.Fatalf("midnightMillis: %v", err)
	}
	back := time.UnixMilli(mid).In(romeLoc).Format("2006-01-02")
	if back != todayRome {
		t.Fatalf("midnight round-trip: %s -> %d -> %s", todayRome, mid, back)
	}

	// Synthetic circulating run (numeric numero: non-numeric codes are
	// skipped by loadActiveRefs via Atoi, matching real VT numbers).
	const numero, origine = "998001", "S00000"
	_, err = pool.Exec(ctx, `
		INSERT INTO train_runs (numero, origine_code, data_partenza,
			orario_partenza, orario_arrivo, last_delay, provvedimento, last_rilevamento_at)
		VALUES ($1, $2, CURRENT_DATE,
			NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', 5, 0, NOW() - INTERVAL '10 minutes')
		ON CONFLICT (numero, origine_code, data_partenza) DO UPDATE SET
			orario_partenza = EXCLUDED.orario_partenza,
			orario_arrivo = EXCLUDED.orario_arrivo,
			last_delay = 5, provvedimento = 0,
			last_rilevamento_at = EXCLUDED.last_rilevamento_at`,
		numero, origine)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM train_runs WHERE numero=$1 AND origine_code=$2 AND data_partenza=CURRENT_DATE`,
			numero, origine)
	})

	refs, err := loadActiveRefs(ctx, pool, 30, 5)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, r := range refs {
		if r.ref.Numero == 998001 && r.ref.OrigineCode == origine {
			found = true
			if r.state.lastDelay != 5 {
				t.Fatalf("expected lastDelay 5, got %d", r.state.lastDelay)
			}
		}
	}
	if !found {
		t.Fatalf("synthetic run not in active set (%d refs)", len(refs))
	}

	// unchanged detection
	st := activeState{lastDelay: 5, provvedimento: 0, lastRilevMs: 123}
	if !unchanged(&vt.Andamento{Ritardo: 5, Provvedimento: 0, OraUltimoRilev: 123}, st) {
		t.Fatal("identical payload should be unchanged")
	}
	if unchanged(&vt.Andamento{Ritardo: 6, Provvedimento: 0, OraUltimoRilev: 123}, st) {
		t.Fatal("changed delay should not be unchanged")
	}
	if unchanged(&vt.Andamento{Ritardo: 5, Provvedimento: 0, OraUltimoRilev: 124}, st) {
		t.Fatal("changed rilevamento should not be unchanged")
	}

	// exists check via query
	var one int
	err = pool.QueryRow(ctx, existsRunSQL, numero, origine, todayRome).Scan(&one)
	if err != nil {
		t.Fatalf("existsRunSQL should find synthetic run: %v", err)
	}
}
