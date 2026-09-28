package ingest

import (
	"context"
	"log"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riccardoeudizi/train-monitor-poller/internal/db"
	"github.com/riccardoeudizi/train-monitor-poller/internal/vt"
)

// discoverBoards fetches partenze+arrivi for every station in parallel and
// returns the set of candidate train numbers.
func discoverBoards(ctx context.Context, client *vt.Client, stations []string, workers int, now time.Time) map[int]struct{} {
	numSet := map[int]struct{}{}
	var mu sync.Mutex
	sem := make(chan struct{}, workers)
	var wg sync.WaitGroup
	for _, st := range stations {
		for _, kind := range []string{"partenze", "arrivi"} {
			wg.Add(1)
			go func(st, kind string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				entries, err := client.Board(ctx, kind, st, now)
				if err != nil {
					log.Printf("board %s %s: %v", kind, st, err)
					return
				}
				mu.Lock()
				for _, e := range entries {
					if e.NumeroTreno != 0 {
						numSet[e.NumeroTreno] = struct{}{}
					}
				}
				mu.Unlock()
			}(st, kind)
		}
	}
	wg.Wait()
	return numSet
}

// fetchDetails resolves each candidate via autocomplete + andamentoTreno and
// upserts runs/stops. Returns total stops upserted.
func fetchDetails(ctx context.Context, pool *pgxpool.Pool, client *vt.Client, numSet map[int]struct{}, workers int) int64 {
	var wg sync.WaitGroup
	var stopTotal atomic.Int64
	sem := make(chan struct{}, workers)
	for numero := range numSet {
		wg.Add(1)
		go func(numero int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			refs, err := client.Autocomplete(ctx, numero)
			if err != nil || len(refs) == 0 {
				return
			}
			// Latest triple only (usually one per day; keeps MVP cheap).
			ref := refs[len(refs)-1]
			a, err := client.AndamentoTreno(ctx, ref)
			if err != nil {
				log.Printf("andamento %d: %v", numero, err)
				return
			}
			if a == nil {
				return // 204 cancelled/nodata
			}
			n, err := storeAndamento(ctx, pool, ref, a)
			if err != nil {
				log.Printf("store %d: %v", numero, err)
				return
			}
			stopTotal.Add(int64(n))
		}(numero)
	}
	wg.Wait()
	return stopTotal.Load()
}

// publishMeta writes national counters + ticker into info_news.
func publishMeta(ctx context.Context, pool *pgxpool.Pool, client *vt.Client) {
	publishStats(ctx, pool, client)
	publishTicker(ctx, pool, client)
}

// publishStats writes national counters into info_news (cheap, frequent).
func publishStats(ctx context.Context, pool *pgxpool.Pool, client *vt.Client) {
	if stats, err := client.Statistiche(ctx); err == nil {
		_, _ = pool.Exec(ctx, upsertInfoSQL, "stats", stats)
	} else {
		log.Printf("statistiche: %v", err)
	}
}

// publishTicker writes the infomobility ticker into info_news (larger,
// slower-moving: called less often than stats).
func publishTicker(ctx context.Context, pool *pgxpool.Pool, client *vt.Client) {
	if tick, err := client.InfomobilitaTicker(ctx); err == nil {
		_, _ = pool.Exec(ctx, upsertInfoSQL, "ticker", tickerItems(tick))
	} else {
		log.Printf("ticker: %v", err)
	}
}

// stationsForCycle loads the station list for one cycle.
func stationsForCycle(ctx context.Context, pool *pgxpool.Pool, majorsOnly bool) ([]string, error) {
	return db.MajorStations(ctx, pool, majorsOnly)
}

// discoveryStats are per-sweep counters for logging.
type discoveryStats struct {
	stations, candidates          int64
	autocompleted, newRuns, stops int64
	errors                        int64
}

// runExists reports whether a (numero, origine, data_partenza) triple is
// already stored. Discovery owns the initial insert; the fast active loop
// owns all later updates.
func runExists(ctx context.Context, pool *pgxpool.Pool, numero int, origineCode, dataPartenza string) bool {
	var one int
	err := pool.QueryRow(ctx, existsRunSQL,
		strconv.Itoa(numero), origineCode, dataPartenza).Scan(&one)
	return err == nil
}

// discoveryCycle sweeps boards to find candidate numbers and stores only
// triples not yet in the DB (new trains, usually upcoming). Known runs are
// left to the fast active loop, so repeated sweeps are read-heavy on
// ViaggiaTreno but write almost nothing to Postgres.
func discoveryCycle(ctx context.Context, pool *pgxpool.Pool, client *vt.Client, cfg Config) discoveryStats {
	var st discoveryStats
	stations, err := stationsForCycle(ctx, pool, cfg.MajorsOnly)
	if err != nil {
		log.Printf("stations: %v", err)
		st.errors++
		return st
	}
	st.stations = int64(len(stations))

	numSet := discoverBoards(ctx, client, stations, cfg.Workers, time.Now())
	st.candidates = int64(len(numSet))

	var autocompleted, newRuns, stopsTotal, errors atomic.Int64
	sem := make(chan struct{}, cfg.Workers)
	var wg sync.WaitGroup
	for numero := range numSet {
		wg.Add(1)
		go func(numero int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			refs, err := client.Autocomplete(ctx, numero)
			if err != nil || len(refs) == 0 {
				if err != nil && ctx.Err() == nil {
					log.Printf("autocomplete %d: %v", numero, err)
					errors.Add(1)
				}
				return
			}
			autocompleted.Add(1)
			// Latest triple only (usually one per day).
			ref := refs[len(refs)-1]
			dataPartenza := time.UnixMilli(ref.Midnight).In(romeLoc).Format("2006-01-02")
			if runExists(ctx, pool, ref.Numero, ref.OrigineCode, dataPartenza) {
				return
			}
			a, err := client.AndamentoTreno(ctx, ref)
			if err != nil {
				log.Printf("andamento %d: %v", numero, err)
				errors.Add(1)
				return
			}
			if a == nil {
				return // 204 cancelled/nodata
			}
			n, err := storeAndamento(ctx, pool, ref, a)
			if err != nil {
				log.Printf("store %d: %v", numero, err)
				errors.Add(1)
				return
			}
			newRuns.Add(1)
			stopsTotal.Add(int64(n))
		}(numero)
	}
	wg.Wait()

	st.autocompleted = autocompleted.Load()
	st.newRuns = newRuns.Load()
	st.stops = stopsTotal.Load()
	st.errors += errors.Load()
	return st
}
