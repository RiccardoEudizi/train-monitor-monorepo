package ingest

import (
	"context"
	"log"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riccardoeudizi/train-monitor-poller/internal/vt"
)

// activeState is the last stored state used for change detection.
type activeState struct {
	lastDelay     int
	provvedimento int
	lastRilevMs   int64
}

// activeRef is a known run inside its live window with enough state to
// refresh it via andamentoTreno directly (no autocomplete round-trip).
type activeRef struct {
	ref   vt.TrainRef
	state activeState
}

// activeStats are per-cycle counters for logging.
type activeStats struct {
	active, fetched, unchanged, stored int64
	stops                              int64
	errors                             int64
}

// midnightMillis rebuilds the ViaggiaTreno midnight timestamp (Europe/Rome
// start-of-day in millis) from a data_partenza YYYY-MM-DD. storeAndamento
// derives data_partenza from ref.Midnight in the same zone, so the mapping
// round-trips.
func midnightMillis(dataPartenza string) (int64, error) {
	t, err := time.ParseInLocation("2006-01-02", dataPartenza, romeLoc)
	if err != nil {
		return 0, err
	}
	return t.UnixMilli(), nil
}

// loadActiveRefs returns runs whose live fields can still change:
// orario_partenza - pre <= now <= orario_arrivo + delay + grace.
func loadActiveRefs(ctx context.Context, pool *pgxpool.Pool, preMin, graceMin int) ([]activeRef, error) {
	rows, err := pool.Query(ctx, selectActiveRunsSQL, preMin, graceMin)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []activeRef
	for rows.Next() {
		var numeroTxt, origineCode string
		var dataPartenza time.Time
		var orarioPart, orarioArr *time.Time
		var lastDelay, provvedimento int
		var lastRilev *time.Time
		if err := rows.Scan(&numeroTxt, &origineCode, &dataPartenza,
			&orarioPart, &orarioArr, &lastDelay, &provvedimento, &lastRilev); err != nil {
			return nil, err
		}
		numero, err := strconv.Atoi(numeroTxt)
		if err != nil {
			continue
		}
		dataPartenzaStr := dataPartenza.Format("2006-01-02")
		mid, err := midnightMillis(dataPartenzaStr)
		if err != nil {
			continue
		}
		var rilevMs int64
		if lastRilev != nil {
			rilevMs = lastRilev.UnixMilli()
		}
		out = append(out, activeRef{
			ref: vt.TrainRef{Numero: numero, OrigineCode: origineCode, Midnight: mid},
			state: activeState{
				lastDelay:     lastDelay,
				provvedimento: provvedimento,
				lastRilevMs:   rilevMs,
			},
		})
	}
	return out, rows.Err()
}

// unchanged reports whether a fresh andamento carries no new live info
// versus what is already stored. Static schedule data never changes after
// departure; only delay / provvedimento / ultimo rilevamento move.
func unchanged(a *vt.Andamento, st activeState) bool {
	return a.Ritardo == st.lastDelay &&
		a.Provvedimento == st.provvedimento &&
		a.OraUltimoRilev == st.lastRilevMs
}

// activeCycle refreshes only runs inside their live window, writing only
// when the payload actually changed.
func activeCycle(ctx context.Context, pool *pgxpool.Pool, client *vt.Client, cfg Config) activeStats {
	var st activeStats
	refs, err := loadActiveRefs(ctx, pool, int(cfg.PreDeparture.Minutes()), int(cfg.PostArrivalGrace.Minutes()))
	if err != nil {
		log.Printf("active load: %v", err)
		st.errors++
		return st
	}
	st.active = int64(len(refs))

	var fetched, unchangedN, stored, stopsTotal, errors atomic.Int64
	sem := make(chan struct{}, cfg.Workers)
	var wg sync.WaitGroup
	for _, ar := range refs {
		wg.Add(1)
		go func(ar activeRef) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			a, err := client.AndamentoTreno(ctx, ar.ref)
			if err != nil {
				if ctx.Err() == nil {
					log.Printf("andamento %d: %v", ar.ref.Numero, err)
				}
				errors.Add(1)
				return
			}
			if a == nil {
				return // 204 cancelled/nodata
			}
			fetched.Add(1)
			if unchanged(a, ar.state) {
				unchangedN.Add(1)
				return
			}
			n, err := storeAndamento(ctx, pool, ar.ref, a)
			if err != nil {
				log.Printf("store %d: %v", ar.ref.Numero, err)
				errors.Add(1)
				return
			}
			stored.Add(1)
			stopsTotal.Add(int64(n))
		}(ar)
	}
	wg.Wait()

	st.fetched = fetched.Load()
	st.unchanged = unchangedN.Load()
	st.stored = stored.Load()
	st.stops = stopsTotal.Load()
	st.errors = errors.Load()
	return st
}
