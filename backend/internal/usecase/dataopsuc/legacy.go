package dataopsuc

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/legacy"
)

// LegacyDump describes the extractor output currently staged for a store.
type LegacyDump struct {
	UploadedAt time.Time        `json:"uploaded_at"`
	SourceSHA  string           `json:"source_sha256"`
	Tables     map[string]int64 `json:"tables"`
	FileName   string           `json:"file_name"`
	SizeBytes  int64            `json:"size_bytes"`
}

const legacyCurrent = "current"

// StageLegacyDump unpacks an uploaded extractor archive (.zip or .tar.gz) and replaces whatever
// dump was staged for this store. Returns what the manifest says is inside.
func (s *Service) StageLegacyDump(storeID uuid.UUID, archivePath, fileName string) (*LegacyDump, error) {
	root, err := s.storeDir(storeID, "legacy")
	if err != nil {
		return nil, err
	}
	dst := filepath.Join(root, legacyCurrent)
	tmp := dst + ".new"
	_ = os.RemoveAll(tmp)
	if err := os.MkdirAll(tmp, 0o750); err != nil {
		return nil, fmt.Errorf("create dump dir: %w", err)
	}

	if err := extractArchive(archivePath, tmp); err != nil {
		_ = os.RemoveAll(tmp)
		return nil, err
	}
	dir, err := findManifestDir(tmp)
	if err != nil {
		_ = os.RemoveAll(tmp)
		return nil, err
	}
	// the manifest may sit one level down (the archive contains the dump folder itself)
	if dir != tmp {
		if err := hoist(dir, tmp); err != nil {
			_ = os.RemoveAll(tmp)
			return nil, err
		}
	}

	info, err := readManifest(tmp)
	if err != nil {
		_ = os.RemoveAll(tmp)
		return nil, err
	}
	st, _ := os.Stat(archivePath)
	info.FileName = fileName
	if st != nil {
		info.SizeBytes = st.Size()
	}
	info.UploadedAt = time.Now()

	_ = os.RemoveAll(dst)
	if err := os.Rename(tmp, dst); err != nil {
		return nil, fmt.Errorf("stage dump: %w", err)
	}
	// remember what we told the user, so the page still shows it after a restart
	if b, err := json.Marshal(info); err == nil {
		_ = os.WriteFile(filepath.Join(dst, "_upload.json"), b, 0o640)
	}
	_ = os.Remove(archivePath)
	return info, nil
}

// StagedLegacyDump returns the dump currently staged for the store, if any.
func (s *Service) StagedLegacyDump(storeID uuid.UUID) (*LegacyDump, error) {
	root, err := s.storeDir(storeID, "legacy")
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(root, legacyCurrent)
	if _, err := os.Stat(filepath.Join(dir, "manifest.json")); err != nil {
		return nil, nil
	}
	info, err := readManifest(dir)
	if err != nil {
		return nil, err
	}
	if b, err := os.ReadFile(filepath.Join(dir, "_upload.json")); err == nil {
		var saved LegacyDump
		if json.Unmarshal(b, &saved) == nil {
			info.UploadedAt = saved.UploadedAt
			info.FileName = saved.FileName
			info.SizeBytes = saved.SizeBytes
		}
	}
	return info, nil
}

// DiscardLegacyDump deletes the staged dump.
func (s *Service) DiscardLegacyDump(storeID uuid.UUID) error {
	root, err := s.storeDir(storeID, "legacy")
	if err != nil {
		return err
	}
	return os.RemoveAll(filepath.Join(root, legacyCurrent))
}

// StartLegacyImport runs the staged dump through the same stages as `cmd/migrate-legacy`.
// A dry run does all the work inside a transaction that is rolled back at the end.
func (s *Service) StartLegacyImport(ctx context.Context, actor Actor, storeID uuid.UUID, dryRun bool) (*Job, error) {
	root, err := s.storeDir(storeID, "legacy")
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(root, legacyCurrent)
	if _, err := os.Stat(filepath.Join(dir, "manifest.json")); err != nil {
		return nil, domain.ErrLegacyDumpMissing
	}
	code, _, err := s.storeIdent(ctx, storeID)
	if err != nil {
		return nil, err
	}
	imp, err := legacy.New(s.db, legacy.Options{Dir: dir, StoreCode: code, DryRun: dryRun, Log: s.log})
	if err != nil {
		return nil, domain.ErrLegacyDumpInvalid.Wrap(err)
	}

	j, err := s.start(storeID, JobLegacyImport, actor)
	if err != nil {
		return nil, err
	}
	s.run(j, func(ctx context.Context, j *Job) (string, any, error) {
		s.update(j.ID, "import", 5)
		rep, err := imp.Run(ctx)
		if err != nil {
			return "", rep, err
		}
		action := "legacy.import"
		if dryRun {
			action = "legacy.import.dry_run"
		}
		if err := s.writeAudit(ctx, actor, storeID, action, code, map[string]any{"stages": len(rep.Stages), "source_sha256": rep.SourceSHA}); err != nil {
			s.log.Warn("legacy import audit failed", "err", err)
		}
		return "", rep, nil
	})
	return j, nil
}

// ---------------------------------------------------------------------------
// archive helpers
// ---------------------------------------------------------------------------

func readManifest(dir string) (*LegacyDump, error) {
	m, err := legacy.LoadManifest(dir)
	if err != nil {
		return nil, domain.ErrLegacyDumpInvalid.Wrap(err)
	}
	out := &LegacyDump{SourceSHA: m.SourceSHA256, Tables: map[string]int64{}}
	for _, t := range m.Tables {
		out.Tables[t.Name] = int64(t.Rows)
	}
	return out, nil
}

// findManifestDir locates manifest.json at the root or one level down.
func findManifestDir(root string) (string, error) {
	if _, err := os.Stat(filepath.Join(root, "manifest.json")); err == nil {
		return root, nil
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return "", fmt.Errorf("read dump: %w", err)
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		p := filepath.Join(root, e.Name())
		if _, err := os.Stat(filepath.Join(p, "manifest.json")); err == nil {
			return p, nil
		}
	}
	return "", domain.ErrLegacyDumpInvalid.With("reason", "manifest.json")
}

// hoist moves the contents of sub up into root.
func hoist(sub, root string) error {
	entries, err := os.ReadDir(sub)
	if err != nil {
		return fmt.Errorf("read dump: %w", err)
	}
	for _, e := range entries {
		if err := os.Rename(filepath.Join(sub, e.Name()), filepath.Join(root, e.Name())); err != nil {
			return fmt.Errorf("move %s: %w", e.Name(), err)
		}
	}
	return os.RemoveAll(sub)
}

func extractArchive(path, dst string) error {
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open upload: %w", err)
	}
	defer f.Close()
	magic := make([]byte, 2)
	if _, err := io.ReadFull(f, magic); err != nil {
		return domain.ErrLegacyDumpInvalid.Wrap(err)
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("seek upload: %w", err)
	}
	switch {
	case magic[0] == 'P' && magic[1] == 'K':
		return extractZip(path, dst)
	case magic[0] == 0x1f && magic[1] == 0x8b:
		return extractTarGz(f, dst)
	default:
		return domain.ErrLegacyDumpInvalid.With("reason", "format")
	}
}

func extractZip(path, dst string) error {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return domain.ErrLegacyDumpInvalid.Wrap(err)
	}
	defer zr.Close()
	for _, f := range zr.File {
		target, err := safeJoin(dst, f.Name)
		if err != nil {
			return err
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o750); err != nil {
				return fmt.Errorf("mkdir: %w", err)
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
			return fmt.Errorf("mkdir: %w", err)
		}
		rc, err := f.Open()
		if err != nil {
			return fmt.Errorf("read %s: %w", f.Name, err)
		}
		err = writeFile(target, rc)
		rc.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func extractTarGz(r io.Reader, dst string) error {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return domain.ErrLegacyDumpInvalid.Wrap(err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return domain.ErrLegacyDumpInvalid.Wrap(err)
		}
		target, err := safeJoin(dst, h.Name)
		if err != nil {
			return err
		}
		switch h.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o750); err != nil {
				return fmt.Errorf("mkdir: %w", err)
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
				return fmt.Errorf("mkdir: %w", err)
			}
			if err := writeFile(target, tr); err != nil {
				return err
			}
		}
	}
}

func writeFile(path string, r io.Reader) error {
	out, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o640)
	if err != nil {
		return fmt.Errorf("create %s: %w", filepath.Base(path), err)
	}
	defer out.Close()
	if _, err := io.Copy(out, r); err != nil {
		return fmt.Errorf("write %s: %w", filepath.Base(path), err)
	}
	return nil
}

// safeJoin refuses paths that would escape the destination directory (zip slip).
func safeJoin(dst, name string) (string, error) {
	clean := filepath.Clean(strings.ReplaceAll(name, "\\", "/"))
	if clean == "." {
		return dst, nil
	}
	target := filepath.Join(dst, clean)
	if !strings.HasPrefix(target, filepath.Clean(dst)+string(os.PathSeparator)) {
		return "", domain.ErrLegacyDumpInvalid.With("reason", "path")
	}
	return target, nil
}
