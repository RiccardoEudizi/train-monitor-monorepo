package db

import (
	"context"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Pool connects from DATABASE_URL.
func Pool(ctx context.Context) (*pgxpool.Pool, error) {
	return pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
}

// MajorStations returns S-codes flagged is_major (see migrations/004_majors.sql).
func MajorStations(ctx context.Context, pool *pgxpool.Pool, majorsOnly bool) ([]string, error) {
	q := `SELECT code FROM stations ORDER BY code`
	if majorsOnly {
		q = `SELECT code FROM stations WHERE is_major = TRUE ORDER BY code`
	}
	rows, err := pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, err
		}
		out = append(out, code)
	}
	return out, rows.Err()
}
