package vt

import "testing"

func TestAndamentoCat(t *testing.T) {
	cases := []struct {
		name string
		a    Andamento
		want string
	}{
		{"categoria wins", Andamento{Categoria: " FR ", CategoriaDesc: "Regionale", CompNumero: " FR 9520"}, "FR"},
		{"falls back to descrizione", Andamento{CategoriaDesc: " Intercity ", CompNumero: " IC 123"}, "Intercity"},
		{"falls back to compNumero token", Andamento{CompNumero: " FR 9520"}, "FR"},
		{"empty everywhere", Andamento{}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.a.Cat(); got != tc.want {
				t.Fatalf("Cat() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestParseAutocomplete(t *testing.T) {
	body := []byte("9583 - REGGIO DI CALABRIA CENTRALE|9583-S11781-1757896800000\n" +
		"garbage line without pipe\n" +
		"1234 - MILANO CENTRALE|1234-S01700-1757896800000|extra\n" +
		"9584 - REGGIO DI CALABRIA CENTRALE|9584-S11781-1757896801000\n")

	refs := parseAutocomplete(body)
	if len(refs) != 2 {
		t.Fatalf("expected 2 refs, got %d (%+v)", len(refs), refs)
	}
	if got, want := refs[0], (TrainRef{Numero: 9583, OrigineCode: "S11781", Midnight: 1757896800000}); got != want {
		t.Fatalf("refs[0] = %+v, want %+v", got, want)
	}
	if got, want := refs[1], (TrainRef{Numero: 9584, OrigineCode: "S11781", Midnight: 1757896801000}); got != want {
		t.Fatalf("refs[1] = %+v, want %+v", got, want)
	}
}

func TestParseAutocompleteEmpty(t *testing.T) {
	if refs := parseAutocomplete([]byte("   \n")); len(refs) != 0 {
		t.Fatalf("expected no refs, got %+v", refs)
	}
}
