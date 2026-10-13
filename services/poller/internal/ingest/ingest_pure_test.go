package ingest

import (
	"testing"
	"time"

	"github.com/riccardoeudizi/train-monitor-poller/internal/vt"
)

// TestUnchanged covers the write-reduction gate with no database: only a
// change in delay / provvedimento / ultimo rilevamento counts as new info.
func TestUnchanged(t *testing.T) {
	st := activeState{lastDelay: 5, provvedimento: 0, lastRilevMs: 1757896800000}

	cases := []struct {
		name string
		a    vt.Andamento
		want bool
	}{
		{"identical", vt.Andamento{Ritardo: 5, Provvedimento: 0, OraUltimoRilev: 1757896800000}, true},
		{"delay moved", vt.Andamento{Ritardo: 9, Provvedimento: 0, OraUltimoRilev: 1757896800000}, false},
		{"provvedimento moved", vt.Andamento{Ritardo: 5, Provvedimento: 1, OraUltimoRilev: 1757896800000}, false},
		{"rilevamento moved", vt.Andamento{Ritardo: 5, Provvedimento: 0, OraUltimoRilev: 1757896800001}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := unchanged(&tc.a, st); got != tc.want {
				t.Fatalf("unchanged() = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestMidnightMillisRoundTrip proves data_partenza -> ViaggiaTreno midnight
// millis -> data_partenza round-trips across DST boundaries in Europe/Rome.
func TestMidnightMillisRoundTrip(t *testing.T) {
	dates := []string{
		"2026-01-01", // CET
		"2026-03-29", // spring-forward day
		"2026-06-15", // CEST
		"2026-10-25", // fall-back day
		"2026-12-31", // CET
	}
	for _, d := range dates {
		ms, err := midnightMillis(d)
		if err != nil {
			t.Fatalf("midnightMillis(%q): %v", d, err)
		}
		back := time.UnixMilli(ms).In(romeLoc).Format("2006-01-02")
		if back != d {
			t.Fatalf("round-trip: %s -> %d -> %s", d, ms, back)
		}
	}
}

func TestMidnightMillisRejectsBadDate(t *testing.T) {
	if _, err := midnightMillis("not-a-date"); err == nil {
		t.Fatal("expected an error for a malformed date")
	}
}
