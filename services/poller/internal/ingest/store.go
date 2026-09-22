package ingest

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riccardoeudizi/train-monitor-poller/internal/vt"
)

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

// storeAndamento upserts one run + its stops (batched). Returns the number
// of stops upserted.
func storeAndamento(ctx context.Context, pool *pgxpool.Pool, ref vt.TrainRef, a *vt.Andamento) (stops int, err error) {
	dataPartenza := time.UnixMilli(ref.Midnight).In(romeLoc).Format("2006-01-02")

	var runID int
	err = pool.QueryRow(ctx, upsertRunSQL,
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
