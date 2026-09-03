package dataopsuc

import (
	"archive/zip"
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

// RestoreOptions controls how an archive is put back.
type RestoreOptions struct {
	// Replace wipes the store's current rows first. Without it the restore only adds rows that
	// are not there yet (ON CONFLICT DO NOTHING), which is the safe way to fill an empty store.
	Replace bool `json:"replace"`
	// Profile also restores the shop name/address/logo from the archive.
	Profile bool `json:"profile"`
}

// RestoreReport is the outcome shown to the owner.
type RestoreReport struct {
	Archive  string           `json:"archive"`
	Meta     *Meta            `json:"meta"`
	Replaced bool             `json:"replaced"`
	Deleted  map[string]int64 `json:"deleted,omitempty"`
	Inserted map[string]int64 `json:"inserted"`
	Warnings []string         `json:"warnings,omitempty"`
}

const insertChunk = 2000

// StartRestore reads a backup archive (an uploaded file, or one still on the server) into the store.
func (s *Service) StartRestore(ctx context.Context, actor Actor, storeID uuid.UUID, path, label string, opt RestoreOptions) (*Job, error) {
	if _, err := zip.OpenReader(path); err != nil {
		return nil, domain.ErrBackupInvalid.Wrap(err)
	}
	j, err := s.start(storeID, JobRestore, actor)
	if err != nil {
		return nil, err
	}
	s.run(j, func(ctx context.Context, j *Job) (string, any, error) {
		rep, err := s.restore(ctx, storeID, actor.UserID, path, label, opt, j)
		if err != nil {
			return "", nil, err
		}
		if err := s.writeAudit(ctx, actor, storeID, "backup.restore", label, map[string]any{"replace": opt.Replace, "inserted": rep.Inserted}); err != nil {
			s.log.Warn("restore audit failed", "err", err)
		}
		return label, rep, nil
	})
	return j, nil
}

func (s *Service) restore(ctx context.Context, storeID, actorID uuid.UUID, path, label string, opt RestoreOptions, j *Job) (*RestoreReport, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return nil, domain.ErrBackupInvalid.Wrap(err)
	}
	defer zr.Close()

	files := map[string]*zip.File{}
	for _, f := range zr.File {
		files[strings.TrimPrefix(f.Name, "./")] = f
	}
	metaFile, ok := files["meta.json"]
	if !ok {
		return nil, domain.ErrBackupInvalid.With("reason", "meta.json")
	}
	meta, err := readMeta(metaFile)
	if err != nil {
		return nil, err
	}
	if meta.Version > backupVersion {
		return nil, domain.ErrBackupVersion.With("version", fmt.Sprint(meta.Version))
	}

	rep := &RestoreReport{Archive: label, Meta: meta, Replaced: opt.Replace, Inserted: map[string]int64{}}
	if opt.Replace {
		rep.Deleted = map[string]int64{}
	}

	err = s.db.WithTx(ctx, postgres.Scope{Bypass: true, StoreID: storeID}, func(ctx context.Context, tx pgx.Tx) error {
		if opt.Replace {
			s.update(j.ID, "delete", 5)
			for i := len(backupTables) - 1; i >= 0; i-- {
				spec := backupTables[i]
				sql := fmt.Sprintf("DELETE FROM %s t WHERE %s", spec.name, spec.where)
				// the operator running the restore keeps their own login, otherwise a backup made
				// before they were hired would lock them out of the store they just restored
				if spec.name == "users" {
					sql += " AND t.id <> $2"
					tag, err := tx.Exec(ctx, sql, storeID, actorID)
					if err != nil {
						return fmt.Errorf("clear %s: %w", spec.name, err)
					}
					rep.Deleted[spec.name] = tag.RowsAffected()
					continue
				}
				tag, err := tx.Exec(ctx, sql, storeID)
				if err != nil {
					return fmt.Errorf("clear %s: %w", spec.name, err)
				}
				rep.Deleted[spec.name] = tag.RowsAffected()
			}
		}

		for i, spec := range backupTables {
			s.update(j.ID, spec.name, 10+i*85/len(backupTables))
			f, ok := files[spec.name+".jsonl"]
			if !ok {
				rep.Warnings = append(rep.Warnings, "missing table in archive: "+spec.name)
				continue
			}
			n, err := insertTable(ctx, tx, spec, storeID, f)
			if err != nil {
				return err
			}
			rep.Inserted[spec.name] = n
		}

		if opt.Profile && meta.Profile != nil {
			if err := applyProfile(ctx, tx, storeID, meta.Profile); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return rep, nil
}

func readMeta(f *zip.File) (*Meta, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, domain.ErrBackupInvalid.Wrap(err)
	}
	defer rc.Close()
	var m Meta
	if err := json.NewDecoder(rc).Decode(&m); err != nil {
		return nil, domain.ErrBackupInvalid.Wrap(err)
	}
	return &m, nil
}

// insertTable reads a JSONL entry and inserts it in chunks. Rows keep their original ids; the
// tenant column is rewritten so an archive can be restored into another store of this deployment.
func insertTable(ctx context.Context, tx pgx.Tx, spec tableSpec, storeID uuid.UUID, f *zip.File) (int64, error) {
	rc, err := f.Open()
	if err != nil {
		return 0, fmt.Errorf("open %s: %w", spec.name, err)
	}
	defer rc.Close()

	override := "{}"
	if spec.scoped {
		override = fmt.Sprintf(`{"store_id":%q}`, storeID.String())
	}
	sql := fmt.Sprintf(
		"INSERT INTO %s SELECT (jsonb_populate_record(NULL::%s, e || $2::jsonb)).* FROM jsonb_array_elements($1::jsonb) e ON CONFLICT DO NOTHING",
		spec.name, spec.name)

	sc := bufio.NewScanner(rc)
	sc.Buffer(make([]byte, 1<<20), 16<<20) // sale lines and dividend statements can be long rows
	batch := make([]json.RawMessage, 0, insertChunk)
	var total int64

	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		payload, err := json.Marshal(batch)
		if err != nil {
			return fmt.Errorf("encode %s: %w", spec.name, err)
		}
		tag, err := tx.Exec(ctx, sql, string(payload), override)
		if err != nil {
			return fmt.Errorf("insert %s: %w", spec.name, err)
		}
		total += tag.RowsAffected()
		batch = batch[:0]
		return nil
	}

	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		batch = append(batch, json.RawMessage(line))
		if len(batch) >= insertChunk {
			if err := flush(); err != nil {
				return 0, err
			}
		}
	}
	if err := sc.Err(); err != nil && err != io.EOF {
		return 0, fmt.Errorf("read %s: %w", spec.name, err)
	}
	if err := flush(); err != nil {
		return 0, err
	}
	return total, nil
}

func applyProfile(ctx context.Context, tx pgx.Tx, storeID uuid.UUID, profile map[string]any) error {
	doc, err := json.Marshal(profile)
	if err != nil {
		return fmt.Errorf("profile encode: %w", err)
	}
	_, err = tx.Exec(ctx, `
		UPDATE stores s SET
			name = COALESCE(p.name, s.name),
			name_en = p.name_en,
			address = p.address,
			phone = p.phone,
			tax_id = p.tax_id,
			receipt_header = p.receipt_header,
			receipt_footer = p.receipt_footer,
			default_locale = COALESCE(p.default_locale, s.default_locale),
			updated_at = now()
		FROM jsonb_populate_record(NULL::stores, $2::jsonb) p
		WHERE s.id = $1`, storeID, string(doc))
	if err != nil {
		return fmt.Errorf("restore profile: %w", err)
	}
	return nil
}
