// Package legacy imports the legacy MS Access POS dump produced by tools/legacy-extract/extract.ps1
// into the new PostgreSQL schema for one store, idempotently, with a reconciliation report.
package legacy

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/shopspring/decimal"
)

// Manifest mirrors manifest.json written by extract.ps1.
type Manifest struct {
	Format       string          `json:"format"`
	ExtractedAt  string          `json:"extracted_at"`
	SourcePath   string          `json:"source_path"`
	SourceSize   int64           `json:"source_size"`
	SourceSHA256 string          `json:"source_sha256"`
	Timezone     string          `json:"timezone"`
	Tables       []ManifestTable `json:"tables"`
	dir          string
}

type ManifestTable struct {
	Name    string `json:"name"`
	File    string `json:"file"`
	Rows    int    `json:"rows"`
	OrderBy string `json:"order_by"`
	Columns []struct {
		Name string `json:"name"`
		Type string `json:"type"`
	} `json:"columns"`
	SHA256 string `json:"sha256"`
}

// LoadManifest reads <dir>/manifest.json.
func LoadManifest(dir string) (*Manifest, error) {
	b, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return nil, fmt.Errorf("read manifest: %w", err)
	}
	var m Manifest
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("parse manifest: %w", err)
	}
	if !strings.HasSuffix(m.Format, "-legacy-dump/1") {
		return nil, fmt.Errorf("unexpected manifest format %q", m.Format)
	}
	m.dir = dir
	return &m, nil
}

func (m *Manifest) Table(name string) (*ManifestTable, bool) {
	for i := range m.Tables {
		if m.Tables[i].Name == name {
			return &m.Tables[i], true
		}
	}
	return nil, false
}

func (m *Manifest) Path(table string) string {
	if t, ok := m.Table(table); ok {
		return filepath.Join(m.dir, t.File)
	}
	return filepath.Join(m.dir, table+".jsonl")
}

// Validate checks every table file exists, has the declared line count, and (optionally) the declared sha256.
func (m *Manifest) Validate(checkHash bool) []string {
	var problems []string
	for _, t := range m.Tables {
		p := filepath.Join(m.dir, t.File)
		f, err := os.Open(p)
		if err != nil {
			problems = append(problems, fmt.Sprintf("%s: missing file %s", t.Name, t.File))
			continue
		}
		n := 0
		h := sha256.New()
		r := bufio.NewReaderSize(io.TeeReader(f, h), 1<<20)
		for {
			line, err := r.ReadBytes('\n')
			if len(line) > 0 && strings.TrimSpace(string(line)) != "" {
				n++
			}
			if err != nil {
				break
			}
		}
		f.Close()
		if n != t.Rows {
			problems = append(problems, fmt.Sprintf("%s: %d rows in file, manifest says %d", t.Name, n, t.Rows))
		}
		if checkHash && t.SHA256 != "" && !strings.EqualFold(hex.EncodeToString(h.Sum(nil)), t.SHA256) {
			problems = append(problems, fmt.Sprintf("%s: sha256 mismatch", t.Name))
		}
	}
	return problems
}

// Row is one JSONL record (column name → value as decoded by encoding/json).
type Row map[string]any

// EachRow streams a JSONL file; fn receives the 1-based line number and the row.
func EachRow(path string, fn func(n int, r Row) error) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 64<<20)
	n := 0
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		n++
		var r Row
		if err := json.Unmarshal([]byte(line), &r); err != nil {
			return fmt.Errorf("%s line %d: %w", filepath.Base(path), n, err)
		}
		if err := fn(n, r); err != nil {
			return fmt.Errorf("%s line %d: %w", filepath.Base(path), n, err)
		}
	}
	return sc.Err()
}

// ReadAll loads a (small) JSONL file fully.
func ReadAll(path string) ([]Row, error) {
	var out []Row
	err := EachRow(path, func(_ int, r Row) error {
		out = append(out, r)
		return nil
	})
	return out, err
}

// ---- typed accessors ---------------------------------------------------------

func (r Row) Str(k string) string {
	switch v := r[k].(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(v)
	case float64:
		return decimal.NewFromFloat(v).String()
	case bool:
		if v {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprint(v)
	}
}

func (r Row) Dec(k string) decimal.Decimal {
	switch v := r[k].(type) {
	case nil:
		return decimal.Zero
	case float64:
		return decimal.NewFromFloat(v)
	case string:
		d, err := decimal.NewFromString(strings.TrimSpace(v))
		if err != nil {
			return decimal.Zero
		}
		return d
	default:
		return decimal.Zero
	}
}

func (r Row) Int(k string) int {
	return int(r.Dec(k).IntPart())
}

func (r Row) IsNull(k string) bool { return r[k] == nil }

// Bangkok is the legacy system's wall-clock zone.
var Bangkok = mustZone("Asia/Bangkok")

func mustZone(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		return time.FixedZone("ICT", 7*3600)
	}
	return loc
}

// Time parses the extractor's naive "2006-01-02T15:04:05" as Bangkok wall time.
func (r Row) Time(k string) (time.Time, bool) {
	s := r.Str(k)
	if s == "" {
		return time.Time{}, false
	}
	t, err := time.ParseInLocation("2006-01-02T15:04:05", s, Bangkok)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

// Date returns the date part of a naive timestamp column.
func (r Row) Date(k string) (time.Time, bool) {
	t, ok := r.Time(k)
	if !ok {
		return t, false
	}
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, Bangkok), true
}
