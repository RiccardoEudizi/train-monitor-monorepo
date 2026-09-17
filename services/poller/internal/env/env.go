// Package env loads KEY=VALUE pairs from a .env file in the working
// directory into the process environment (stdlib only, no dependencies).
// Existing environment variables always win.
package env

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

// Load reads .env from dir (or the current directory when empty).
// Missing file is not an error.
func Load(dir string) {
	path := ".env"
	if dir != "" {
		path = dir + "/.env"
	}
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if i := strings.Index(line, "="); i > 0 {
			key := strings.TrimSpace(line[:i])
			val := strings.TrimSpace(line[i+1:])
			if len(val) >= 2 && ((val[0] == '"' && val[len(val)-1] == '"') ||
				(val[0] == '\'' && val[len(val)-1] == '\'')) {
				val = val[1 : len(val)-1]
			}
			if _, exists := os.LookupEnv(key); !exists && key != "" {
				os.Setenv(key, val)
			}
		}
	}
}

// Int returns the integer value of key or def when unset/unparseable.
func Int(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

// Bool returns false only when key is explicitly "false"; otherwise def.
// Used for MAJORS_ONLY, which defaults to true.
func Bool(key string, def bool) bool {
	if v := os.Getenv(key); v != "" {
		return v != "false"
	}
	return def
}
