// Package vt is a minimal ViaggiaTreno client.
// Base: http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/
// Train identity is the triple (numero, origineCode, midnightMillis).
package vt

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const BaseURL = "http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno"

// RomeLoc is the timezone ViaggiaTreno timestamps are expressed in.
var RomeLoc = func() *time.Location {
	loc, err := time.LoadLocation("Europe/Rome")
	if err != nil {
		return time.UTC
	}
	return loc
}()

type Client struct {
	http *http.Client
}

func NewClient() *Client {
	return &Client{http: &http.Client{Timeout: 10 * time.Second}}
}

func (c *Client) get(ctx context.Context, path string) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", BaseURL+path, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; TrainMonitorV2/1.0)")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}

// BoardEntry is one row of partenze/arrivi. Only the train number is
// used for discovery; the rest is left to andamentoTreno.
type BoardEntry struct {
	NumeroTreno int `json:"numeroTreno"`
}

// Board fetches partenze or arrivi for a station at time t.
// The datetime format is the infamous JS-Date-like string ViaggiaTreno wants.
func (c *Client) Board(ctx context.Context, kind, station string, t time.Time) ([]BoardEntry, error) {
	stamp := t.In(RomeLoc).Format("Mon Jan 02 2006 15:04:05")
	body, code, err := c.get(ctx, "/"+kind+"/"+station+"/"+url.PathEscape(stamp))
	if err != nil {
		return nil, err
	}
	if code == 204 || len(body) == 0 {
		return nil, nil
	}
	if code != 200 {
		return nil, fmt.Errorf("board %s %s: http %d", kind, station, code)
	}
	var out []BoardEntry
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// TrainRef is one disambiguated (numero, origine, midnightMillis) triple.
type TrainRef struct {
	Numero      int
	OrigineCode string
	Midnight    int64
}

// Autocomplete resolves a train number to its origin triple(s).
// Raw format per line: "9583 - REGGIO DI CALABRIA CENTRALE|9583-S11781-1757896800000"
func (c *Client) Autocomplete(ctx context.Context, numero int) ([]TrainRef, error) {
	body, code, err := c.get(ctx, fmt.Sprintf("/cercaNumeroTrenoTrenoAutocomplete/%d", numero))
	if err != nil {
		return nil, err
	}
	if code == 204 {
		return nil, nil
	}
	if code != 200 {
		return nil, fmt.Errorf("autocomplete %d: http %d", numero, code)
	}
	var refs []TrainRef
	for _, line := range strings.Split(strings.TrimSpace(string(body)), "\n") {
		parts := strings.Split(line, "|")
		if len(parts) != 2 {
			continue
		}
		fields := strings.Split(parts[1], "-")
		if len(fields) != 3 {
			continue
		}
		var mid int64
		fmt.Sscan(fields[2], &mid)
		var n int
		fmt.Sscan(fields[0], &n)
		refs = append(refs, TrainRef{Numero: n, OrigineCode: fields[1], Midnight: mid})
	}
	return refs, nil
}

// Fermata is one stop of andamentoTreno (trimmed to what we store).
type Fermata struct {
	ID              string `json:"id"`
	Stazione        string `json:"stazione"`
	TipoFermata     string `json:"tipoFermata"`
	ArrivoReale     *int64 `json:"arrivoReale"`
	PartenzaReale   *int64 `json:"partenzaReale"`
	ArrivoTeorico   *int64 `json:"arrivo_teorico"`
	PartenzaTeorica *int64 `json:"partenza_teorica"`
	RitardoArrivo   int    `json:"ritardoArrivo"`
	RitardoPartenza int    `json:"ritardoPartenza"`
	ActualType      int    `json:"actualFermataType"`
	BinProg         string `json:"binarioProgrammatoPartenzaDescrizione"`
	BinReal         string `json:"binarioEffettivoPartenzaDescrizione"`
}

// Andamento is the full andamentoTreno payload (trimmed to what we store).
type Andamento struct {
	NumeroTreno    int       `json:"numeroTreno"`
	Categoria      string    `json:"categoria"`
	CategoriaDesc  string    `json:"categoriaDescrizione"`
	CompNumero     string    `json:"compNumeroTreno"`
	Origine        string    `json:"origine"`
	Destinazione   string    `json:"destinazione"`
	IDDestinazione string    `json:"idDestinazione"`
	OrarioPartenza int64     `json:"orarioPartenza"`
	OrarioArrivo   int64     `json:"orarioArrivo"`
	Ritardo        int       `json:"ritardo"`
	TipoTreno      string    `json:"tipoTreno"`
	Provvedimento  int       `json:"provvedimento"`
	OraUltimoRilev int64     `json:"oraUltimoRilevamento"`
	StazioneUltimo string    `json:"stazioneUltimoRilevamento"`
	Fermate        []Fermata `json:"fermate"`
}

// Cat returns the trimmed category, falling back to categoriaDescrizione
// and finally to the first token of compNumeroTreno (e.g. " FR 9520").
func (a *Andamento) Cat() string {
	if c := strings.TrimSpace(a.Categoria); c != "" {
		return c
	}
	if c := strings.TrimSpace(a.CategoriaDesc); c != "" {
		return c
	}
	return strings.TrimSpace(strings.Split(a.CompNumero, " ")[0])
}

// AndamentoTreno fetches full detail. Returns (nil, nil) on 204 (cancelled/nodata).
func (c *Client) AndamentoTreno(ctx context.Context, ref TrainRef) (*Andamento, error) {
	body, code, err := c.get(ctx, fmt.Sprintf("/andamentoTreno/%s/%d/%d", ref.OrigineCode, ref.Numero, ref.Midnight))
	if err != nil {
		return nil, err
	}
	if code == 204 || len(body) == 0 {
		return nil, nil
	}
	if code != 200 {
		return nil, fmt.Errorf("andamento %d: http %d", ref.Numero, code)
	}
	var a Andamento
	if err := json.Unmarshal(body, &a); err != nil {
		return nil, err
	}
	return &a, nil
}

// StationInfo is one row of elencoStazioni.
type StationInfo struct {
	CodiceStazione string  `json:"codiceStazione"`
	Lat            float64 `json:"lat"`
	Lon            float64 `json:"lon"`
	Localita       struct {
		NomeLungo string `json:"nomeLungo"`
		NomeBreve string `json:"nomeBreve"`
		Label     string `json:"label"`
		ID        string `json:"id"`
	} `json:"localita"`
}

// ElencoStazioni lists stations for a region (0 = principals).
func (c *Client) ElencoStazioni(ctx context.Context, region int) ([]StationInfo, error) {
	body, code, err := c.get(ctx, fmt.Sprintf("/elencoStazioni/%d", region))
	if err != nil {
		return nil, err
	}
	if code != 200 {
		return nil, fmt.Errorf("elencoStazioni %d: http %d", region, code)
	}
	var out []StationInfo
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// Statistiche returns {treniGiorno, treniCircolanti}.
func (c *Client) Statistiche(ctx context.Context) (map[string]any, error) {
	ts := time.Now().UnixMilli()
	body, code, err := c.get(ctx, fmt.Sprintf("/statistiche/%d", ts))
	if err != nil {
		return nil, err
	}
	if code != 200 {
		return nil, fmt.Errorf("statistiche: http %d", code)
	}
	var out map[string]any
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// InfomobilitaTicker returns the raw HTML ticker fragment.
func (c *Client) InfomobilitaTicker(ctx context.Context) (string, error) {
	body, code, err := c.get(ctx, "/infomobilitaTicker")
	if err != nil {
		return "", err
	}
	if code != 200 {
		return "", fmt.Errorf("ticker: http %d", code)
	}
	return string(body), nil
}
