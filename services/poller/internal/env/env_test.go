package env

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInt(t *testing.T) {
	t.Setenv("TM_TEST_INT", "")
	if got := Int("TM_TEST_INT", 40); got != 40 {
		t.Fatalf("empty should fall back to default: got %d", got)
	}
	t.Setenv("TM_TEST_INT", "7")
	if got := Int("TM_TEST_INT", 40); got != 7 {
		t.Fatalf("should parse override: got %d", got)
	}
	t.Setenv("TM_TEST_INT", "not-a-number")
	if got := Int("TM_TEST_INT", 40); got != 40 {
		t.Fatalf("unparseable should fall back to default: got %d", got)
	}
}

func TestBoolFalseOnlyOnExplicitFalse(t *testing.T) {
	t.Setenv("TM_TEST_BOOL", "")
	if got := Bool("TM_TEST_BOOL", true); got != true {
		t.Fatalf("unset should return default true, got %v", got)
	}
	t.Setenv("TM_TEST_BOOL", "false")
	if got := Bool("TM_TEST_BOOL", true); got != false {
		t.Fatalf("explicit false should win, got %v", got)
	}
	t.Setenv("TM_TEST_BOOL", "1")
	if got := Bool("TM_TEST_BOOL", false); got != true {
		t.Fatalf("any non-false value should be true, got %v", got)
	}
}

func TestLoadParsesAndSkipsExisting(t *testing.T) {
	// A pre-existing env var must win over the .env file.
	t.Setenv("TM_TEST_WINS", "from-env")

	dir := t.TempDir()
	content := "# comment\n" +
		"TM_TEST_A=1\n" +
		"TM_TEST_B = \"two\"\n" +
		"TM_TEST_C='three'\n" +
		"TM_TEST_WINS=from-file\n" +
		"\n" +
		"# TM_TEST_D=ignored\n" +
		"TM_TEST_QUOTED_UNBALANCED=\"x\n"
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	Load(dir)

	if got := os.Getenv("TM_TEST_A"); got != "1" {
		t.Fatalf("TM_TEST_A = %q, want 1", got)
	}
	if got := os.Getenv("TM_TEST_B"); got != "two" {
		t.Fatalf("TM_TEST_B = %q, want two (quotes stripped)", got)
	}
	if got := os.Getenv("TM_TEST_C"); got != "three" {
		t.Fatalf("TM_TEST_C = %q, want three (quotes stripped)", got)
	}
	if got := os.Getenv("TM_TEST_WINS"); got != "from-env" {
		t.Fatalf("existing env should win, got %q", got)
	}
	if _, ok := os.LookupEnv("TM_TEST_D"); ok {
		t.Fatalf("commented key should not be set")
	}
	if got := os.Getenv("TM_TEST_QUOTED_UNBALANCED"); got != "\"x" {
		t.Fatalf("unbalanced quotes should be kept raw, got %q", got)
	}
}
