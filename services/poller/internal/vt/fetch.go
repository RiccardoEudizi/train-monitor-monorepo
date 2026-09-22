package vt

import (
	"context"
	"encoding/json"
	"fmt"
)

// fetchJSON GETs path and decodes a JSON body into out.
// 204 / empty body → (false, nil): caller treats as nodata, not an error.
func (c *Client) fetchJSON(ctx context.Context, path, what string, out any) (bool, error) {
	body, code, err := c.get(ctx, path)
	if err != nil {
		return false, err
	}
	if code == 204 || len(body) == 0 {
		return false, nil
	}
	if code != 200 {
		return false, fmt.Errorf("%s: http %d", what, code)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return false, err
	}
	return true, nil
}

// fetchText GETs path and returns the raw body as string.
func (c *Client) fetchText(ctx context.Context, path, what string) (string, error) {
	body, code, err := c.get(ctx, path)
	if err != nil {
		return "", err
	}
	if code != 200 {
		return "", fmt.Errorf("%s: http %d", what, code)
	}
	return string(body), nil
}
