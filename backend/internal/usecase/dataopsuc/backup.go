package dataopsuc

import (
	"archive/zip"
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/svdev/pos/internal/repository/postgres"
)

// backupVersion is bumped when the archive layout changes; a restore refuses newer versions.
const backupVersion = 1

// Meta is the archive's meta.json.
type Meta struct {
	Version   int               `json:"version"`
	CreatedAt time.Time         `json:"created_at"`
	StoreCode string            `json:"store_code"`
	StoreName string            `json:"store_name"`
	Profile   map[string]any    `json:"profile"`
	Counts    map[string]int64  `json:"counts"`
	Notes     map[string]string `json:"notes,omitempty"`
}

// StartBackup writes every row of this store into a zip of JSONL files.
func (s *Service) StartBackup(ctx context.Context, actor Actor, storeID uuid.UUID) (*Job, error) {
	code, name, err := s.storeIdent(ctx, storeID)
	if err != nil {
		return nil, err
	}
	j, err := s.start(storeID, JobBackup, actor)
	if err != nil {
		return nil, err
	}
	s.run(j, func(ctx context.Context, j *Job) (string, any, error) {
		file, meta, err := s.backup(ctx, storeID, code, name, j)
		if err != nil {
			return "", nil, err
		}
		s.trimBackups(storeID)
		if err := s.writeAudit(ctx, actor, storeID, "backup.create", file, map[string]any{"counts": meta.Counts}); err != nil {
			s.log.Warn("backup audit failed", "err", err)
		}
		return file, meta, nil
	})
	return j, nil
}

func (s *Service) backup(ctx context.Context, storeID uuid.UUID, code, name string, j *Job) (string, *Meta, error) {
	dir, err := s.storeDir(storeID, "backups")
	if err != nil {
		return "", nil, err
	}
	fileName := fmt.Sprintf("pos-backup-%s-%s.zip", sanitize(code), time.Now().Format("20060102-150405"))
	path := filepath.Join(dir, fileName)
	f, err := os.Create(path)
	if err != nil {
		return "", nil, fmt.Errorf("create backup file: %w", err)
	}
	defer f.Close()

	bw := bufio.NewWriterSize(f, 1<<20)
	zw := zip.NewWriter(bw)
	meta := &Meta{Version: backupVersion, CreatedAt: time.Now(), StoreCode: code, StoreName: name, Counts: map[string]int64{}}

	// Snapshot: one consistent picture of every table for the whole dump
	err = s.db.WithTx(ctx, postgres.Scope{Bypass: true, StoreID: storeID, Snapshot: true}, func(ctx context.Context, tx pgx.Tx) error {
		profile, err := storeProfile(ctx, tx, storeID)
		if err != nil {
			return err
		}
		meta.Profile = profile

		for i, spec := range backupTables {
			s.update(j.ID, spec.name, i*95/len(backupTables))
			w, err := zw.Create(spec.name + ".jsonl")
			if err != nil {
				return fmt.Errorf("zip entry %s: %w", spec.name, err)
			}
			n, err := copyTable(ctx, tx, spec, storeID, w)
			if err != nil {
				return err
			}
			meta.Counts[spec.name] = n
		}
		return nil
	})
	if err != nil {
		_ = zw.Close()
		_ = f.Close() // Windows refuses to remove a file that is still open
		_ = os.Remove(path)
		return "", nil, err
	}

	s.update(j.ID, "meta", 97)
	mw, err := zw.Create("meta.json")
	if err != nil {
		return "", nil, fmt.Errorf("zip meta: %w", err)
	}
	if err := json.NewEncoder(mw).Encode(meta); err != nil {
		return "", nil, fmt.Errorf("write meta: %w", err)
	}
	if err := zw.Close(); err != nil {
		return "", nil, fmt.Errorf("close zip: %w", err)
	}
	if err := bw.Flush(); err != nil {
		return "", nil, fmt.Errorf("flush backup: %w", err)
	}
	return fileName, meta, nil
}

// copyTable streams `to_jsonb(row)` lines of one table into w.
func copyTable(ctx context.Context, tx pgx.Tx, spec tableSpec, storeID uuid.UUID, w interface{ Write([]byte) (int, error) }) (int64, error) {
	sql := fmt.Sprintf("SELECT to_jsonb(t) FROM %s t WHERE %s", spec.name, spec.where)
	rows, err := tx.Query(ctx, sql, storeID)
	if err != nil {
		return 0, fmt.Errorf("dump %s: %w", spec.name, err)
	}
	defer rows.Close()
	var n int64
	nl := []byte("\n")
	for rows.Next() {
		var doc []byte
		if err := rows.Scan(&doc); err != nil {
			return 0, fmt.Errorf("scan %s: %w", spec.name, err)
		}
		if _, err := w.Write(doc); err != nil {
			return 0, fmt.Errorf("write %s: %w", spec.name, err)
		}
		if _, err := w.Write(nl); err != nil {
			return 0, fmt.Errorf("write %s: %w", spec.name, err)
		}
		n++
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("dump %s: %w", spec.name, err)
	}
	return n, nil
}

// storeProfile returns the store row (minus id/code) so a restore can put the shop details back.
func storeProfile(ctx context.Context, tx pgx.Tx, storeID uuid.UUID) (map[string]any, error) {
	var doc []byte
	err := tx.QueryRow(ctx, "SELECT to_jsonb(s) - 'id' - 'code' - 'created_at' - 'updated_at' FROM stores s WHERE s.id = $1", storeID).Scan(&doc)
	if err != nil {
		return nil, fmt.Errorf("store profile: %w", err)
	}
	var out map[string]any
	if err := json.Unmarshal(doc, &out); err != nil {
		return nil, fmt.Errorf("store profile decode: %w", err)
	}
	return out, nil
}

func (s *Service) storeIdent(ctx context.Context, storeID uuid.UUID) (code, name string, err error) {
	err = s.db.WithTx(ctx, postgres.Scope{Bypass: true, StoreID: storeID}, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, "SELECT code, name FROM stores WHERE id = $1", storeID).Scan(&code, &name)
	})
	if err != nil {
		return "", "", fmt.Errorf("store: %w", err)
	}
	return code, name, nil
}

func sanitize(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			out = append(out, r)
		default:
			out = append(out, '-')
		}
	}
	if len(out) == 0 {
		return "store"
	}
	return string(out)
}
