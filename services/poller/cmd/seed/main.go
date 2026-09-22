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
	env.LoadDefaults()
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
	// 1..22 prima (regioni geografiche reali), 0 per ultimo solo come
	// fallback per stazioni presenti solo nel bucket "principali".
	// 0 NON è una regione: fargli vincere l'upsert sporca il DB con
	// region_id=0 che poi affiora nei ranking come "Principali".
	regions := make([]int, 0, 23)
	for region := 1; region <= 22; region++ {
		regions = append(regions, region)
	}
	regions = append(regions, 0)
	for _, region := range regions {
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
			// Stazioni contese da più endpoint: vince la canonica.
			regionEff := region
			if c, ok := canonicalRegion[code]; ok {
				regionEff = c
			}
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
				code, name, s.Localita.NomeBreve, s.Localita.Label, regionEff,
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
