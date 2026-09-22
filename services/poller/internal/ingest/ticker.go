package ingest

import (
	"regexp"
	"strings"
)

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
