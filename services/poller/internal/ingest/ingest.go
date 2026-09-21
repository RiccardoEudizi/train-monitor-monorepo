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
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riccardoeudizi/train-monitor-poller/internal/db"
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

// romeLoc is the timezone ViaggiaTreno midnight timestamps are expressed in.
// data_partenza must be derived in this zone, not UTC.
var romeLoc = vt.RomeLoc

func millisToTime(ms int64) *time.Time {
	if ms == 0 {
		return nil
	}
	t := time.UnixMilli(ms)
	return &t
}

const upsertStopSQL = `
	INSERT INTO stops (run_id, station_code, order_idx, tipo_fermata,
		programmata_arr, programmata_dep, actual_arr, actual_dep,
		delay_arr, delay_dep, actual_type, binario_prog, binario_real)
	VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
	ON CONFLICT (run_id, station_code) DO UPDATE SET
		order_idx=EXCLUDED.order_idx, tipo_fermata=EXCLUDED.tipo_fermata,
		programmata_arr=EXCLUDED.programmata_arr, programmata_dep=EXCLUDED.programmata_dep,
		actual_arr=EXCLUDED.actual_arr, actual_dep=EXCLUDED.actual_dep,
		delay_arr=EXCLUDED.delay_arr, delay_dep=EXCLUDED.delay_dep,
		actual_type=EXCLUDED.actual_type, binario_prog=EXCLUDED.binario_prog,
		binario_real=EXCLUDED.binario_real`

// storeAndamento upserts one run + its stops (batched). Returns the number
// of stops upserted.
func storeAndamento(ctx context.Context, pool *pgxpool.Pool, ref vt.TrainRef, a *vt.Andamento) (stops int, err error) {
	dataPartenza := time.UnixMilli(ref.Midnight).In(romeLoc).Format("2006-01-02")

	var runID int
	err = pool.QueryRow(ctx, `
		INSERT INTO train_runs (numero, origine_code, data_partenza, categoria, origine, destinazione,
			dest_code, tipo_treno, provvedimento, orario_partenza, orario_arrivo,
			last_delay, max_delay, last_rilevamento_at, last_rilevamento_stazione, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
		ON CONFLICT (numero, origine_code, data_partenza) DO UPDATE SET
			categoria=EXCLUDED.categoria, origine=EXCLUDED.origine, destinazione=EXCLUDED.destinazione,
			dest_code=EXCLUDED.dest_code, tipo_treno=EXCLUDED.tipo_treno,
			provvedimento=EXCLUDED.provvedimento, orario_partenza=EXCLUDED.orario_partenza,
			orario_arrivo=EXCLUDED.orario_arrivo, last_delay=EXCLUDED.last_delay,
			max_delay=EXCLUDED.max_delay, last_rilevamento_at=EXCLUDED.last_rilevamento_at,
			last_rilevamento_stazione=EXCLUDED.last_rilevamento_stazione, updated_at=NOW()
		RETURNING id`,
		fmt.Sprint(ref.Numero), ref.OrigineCode, dataPartenza,
		a.Cat(), a.Origine, a.Destinazione, a.IDDestinazione, a.TipoTreno, a.Provvedimento,
		millisToTime(a.OrarioPartenza), millisToTime(a.OrarioArrivo),
		a.Ritardo, maxDelay(a), millisToTime(a.OraUltimoRilev), nullIfDash(a.StazioneUltimo),
	).Scan(&runID)
	if err != nil {
		return 0, err
	}

	batch := &pgx.Batch{}
	n := 0
	for i, f := range a.Fermate {
		code := f.ID
		if code == "" {
			continue
		}
		batch.Queue(upsertStopSQL,
			runID, code, i, f.TipoFermata,
			millisToTime(ptrVal(f.ArrivoTeorico)), millisToTime(ptrVal(f.PartenzaTeorica)),
			millisToTime(ptrVal(f.ArrivoReale)), millisToTime(ptrVal(f.PartenzaReale)),
			f.RitardoArrivo, f.RitardoPartenza, f.ActualType, f.BinProg, f.BinReal,
		)
		n++
	}

	br := pool.SendBatch(ctx, batch)
	defer br.Close()
	for range batch.Len() {
		if _, err := br.Exec(); err != nil {
			return n, err
		}
	}
	return n, br.Close()
}

func maxDelay(a *vt.Andamento) int {
	m := a.Ritardo
	for _, f := range a.Fermate {
		if f.RitardoArrivo > m {
			m = f.RitardoArrivo
		}
		if f.RitardoPartenza > m {
			m = f.RitardoPartenza
		}
	}
	return m
}

func ptrVal(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}

func nullIfDash(s string) any {
	if s == "" || s == "--" {
		return nil
	}
	return s
}

var (
	tickerItemRe = regexp.MustCompile(`(?s)<li[^>]*>(.*?)</li>`)
	tickerTagRe  = regexp.MustCompile(`<[^>]+>`)
)

// tickerItems extracts plain-text items from the infomobilitaTicker HTML
// fragment (<ul><li>…</li></ul>) so the app can render string[] directly.
func tickerItems(html string) []string {
	var out []string
	for _, m := range tickerItemRe.FindAllStringSubmatch(html, -1) {
		text := strings.TrimSpace(tickerTagRe.ReplaceAllString(m[1], ""))
		text = strings.Join(strings.Fields(text), " ")
		if text != "" {
			out = append(out, text)
		}
	}
	if out == nil {
		out = []string{}
	}
	return out
}

// rollupToday folds today's current stops into daily_stop_stats (upserted,
// so repeated runs converge to the end-of-day truth) for the app's
// 24h/7d/30d charts. DISTINCT ON keeps one row per unique key: the same
// train number can run from different origins on the same day.
func rollupToday(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		WITH ranked AS (
			SELECT CURRENT_DATE AS run_date, r.numero, s.station_code, s.delay_arr,
				GREATEST(s.delay_arr, s.delay_dep) AS dmax,
				(r.provvedimento = 1) AS canc,
				ROW_NUMBER() OVER (PARTITION BY r.numero, s.station_code ORDER BY r.id DESC) AS rn
			FROM stops s
			JOIN train_runs r ON r.id = s.run_id
			WHERE r.data_partenza = CURRENT_DATE
		)
		INSERT INTO daily_stop_stats (run_date, numero, station_code, delay_arr_final, delay_max, cancelled, samples)
		SELECT run_date, numero, station_code, delay_arr, dmax, canc, 1
		FROM ranked WHERE rn = 1
		ON CONFLICT (run_date, numero, station_code) DO UPDATE SET
			delay_arr_final = EXCLUDED.delay_arr_final, delay_max = EXCLUDED.delay_max,
			cancelled = EXCLUDED.cancelled, samples = EXCLUDED.samples`)
	return err
}

// rollupTrainToday folds today's runs into daily_train_stats (upserted, so
// repeated runs converge to the end-of-day truth). One row per run, kept
// forever, so the app's train/global "total" stats survive the 30-day
// train_runs retention window. Region attribution is frozen with the same
// rule fetchOverview uses live: last stop with actual data, else origine.
func rollupTrainToday(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO daily_train_stats (run_date, numero, origine_code, origine, destinazione, last_delay, max_delay, provvedimento, region_id, region_station)
		SELECT r.data_partenza, r.numero, r.origine_code, r.origine, r.destinazione, r.last_delay, r.max_delay, r.provvedimento,
			COALESCE(sl.region_id, so.region_id), COALESCE(sl.code, so.code)
		FROM train_runs r
		LEFT JOIN LATERAL (
			SELECT stat.region_id AS region_id, st.station_code AS code
			FROM stops st
			LEFT JOIN stations stat ON stat.code = st.station_code
			WHERE st.run_id = r.id
				AND (st.actual_arr IS NOT NULL OR st.actual_dep IS NOT NULL)
			ORDER BY st.order_idx DESC
			LIMIT 1
		) sl ON true
		LEFT JOIN stations so ON so.code = r.origine_code
		WHERE r.data_partenza = CURRENT_DATE
		ON CONFLICT (run_date, numero, origine_code) DO UPDATE SET
			origine = EXCLUDED.origine, destinazione = EXCLUDED.destinazione,
			last_delay = EXCLUDED.last_delay, max_delay = EXCLUDED.max_delay,
			provvedimento = EXCLUDED.provvedimento, region_id = EXCLUDED.region_id,
			region_station = EXCLUDED.region_station`)
	return err
}

// cleanupOldRuns deletes runs (cascading to stops) older than the retention
// window. Daily aggregates in daily_stop_stats and daily_train_stats are
// kept forever.
func cleanupOldRuns(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx,
		`DELETE FROM train_runs WHERE data_partenza < NOW() - make_interval(days => $1)`,
		runRetentionDays)
	return err
}

// Cycle runs one full discovery + detail pass.
func Cycle(ctx context.Context, pool *pgxpool.Pool, client *vt.Client, cfg Config) error {
	stations, err := db.MajorStations(ctx, pool, cfg.MajorsOnly)
	if err != nil {
		return fmt.Errorf("stations: %w", err)
	}
	now := time.Now()

	// 1. Boards in parallel → candidate train numbers.
	numSet := map[int]struct{}{}
	var mu sync.Mutex
	sem := make(chan struct{}, cfg.Workers)
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
	log.Printf("discovered %d trains on %d stations", len(numSet), len(stations))

	// 2. Detail per train (bounded parallelism).
	var wg2 sync.WaitGroup
	var stopTotal atomic.Int64
	for numero := range numSet {
		wg2.Add(1)
		go func(numero int) {
			defer wg2.Done()
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
	wg2.Wait()
	log.Printf("stops upserted: %d", stopTotal.Load())

	// 3. Rollup + retention.
	if err := rollupToday(ctx, pool); err != nil {
		log.Printf("rollup: %v", err)
	}
	if err := rollupTrainToday(ctx, pool); err != nil {
		log.Printf("rollup-train: %v", err)
	}
	if err := cleanupOldRuns(ctx, pool); err != nil {
		log.Printf("cleanup: %v", err)
	}

	// 4. National counters + ticker.
	if stats, err := client.Statistiche(ctx); err == nil {
		_, _ = pool.Exec(ctx, `
			INSERT INTO info_news (kind, payload) VALUES ('stats', $1)
			ON CONFLICT (kind) DO UPDATE SET payload=EXCLUDED.payload, fetched_at=NOW()`,
			stats)
	} else {
		log.Printf("statistiche: %v", err)
	}
	if tick, err := client.InfomobilitaTicker(ctx); err == nil {
		_, _ = pool.Exec(ctx, `
			INSERT INTO info_news (kind, payload) VALUES ('ticker', $1)
			ON CONFLICT (kind) DO UPDATE SET payload=EXCLUDED.payload, fetched_at=NOW()`,
			tickerItems(tick))
	} else {
		log.Printf("ticker: %v", err)
	}
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
