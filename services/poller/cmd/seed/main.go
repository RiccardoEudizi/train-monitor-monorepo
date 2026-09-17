// Command seed populates stations from ViaggiaTreno elencoStazioni/0..22.
// It never touches is_major: the majors list lives in SQL
// (migrations/004_majors.sql). Run once after migrations:
//
//	go run ./cmd/seed
package main

import (
	"context"
	"log"
	"os"

	"github.com/riccardoeudizi/train-monitor-poller/internal/db"
	"github.com/riccardoeudizi/train-monitor-poller/internal/env"
	"github.com/riccardoeudizi/train-monitor-poller/internal/vt"
)

func main() {
	env.Load("")
	ctx := context.Background()
	if os.Getenv("DATABASE_URL") == "" {
		log.Fatal("DATABASE_URL not set")
	}
	pool, err := db.Pool(ctx)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	client := vt.NewClient()
	seen := map[string]bool{}
	total := 0
	// Region 0 = principals; 1..22 add the rest.
	for region := 0; region <= 22; region++ {
		list, err := client.ElencoStazioni(ctx, region)
		if err != nil {
			log.Printf("region %d: %v", region, err)
			continue
		}
		for _, s := range list {
			code := s.CodiceStazione
			if code == "" || seen[code] {
				continue
			}
			seen[code] = true
			name := s.Localita.NomeLungo
			if name == "" {
				name = code
			}
			_, err := pool.Exec(ctx, `
				INSERT INTO stations (code, name, short_name, city, region_id, lat, lon, updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
				ON CONFLICT (code) DO UPDATE SET
					name=EXCLUDED.name, short_name=EXCLUDED.short_name, city=EXCLUDED.city,
					region_id=EXCLUDED.region_id, lat=EXCLUDED.lat, lon=EXCLUDED.lon,
					updated_at=NOW()`,
				code, name, s.Localita.NomeBreve, s.Localita.Label, region,
				s.Lat, s.Lon,
			)
			if err != nil {
				log.Printf("upsert %s: %v", code, err)
				continue
			}
			total++
		}
		log.Printf("region %d: %d stations", region, len(list))
	}
	log.Printf("seeded %d stations", total)
}
