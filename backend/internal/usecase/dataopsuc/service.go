// Package dataopsuc runs the long data operations a store owner can start from the web UI:
// a logical backup of the store, a restore of such a backup, and the import of a legacy
// MS Access dump produced by tools/legacy-extract/extract.ps1.
//
// All three take minutes on a real store, far longer than an HTTP request may last, so they run as
// background jobs: the handler starts one and returns its id, and the UI polls the job.
package dataopsuc

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
	"github.com/svdev/pos/internal/usecase/storeuc"
)

// Actor mirrors storeuc.Actor so handlers can pass the same value.
type Actor = storeuc.Actor

type JobKind string

const (
	JobBackup          JobKind = "backup"
	JobRestore         JobKind = "restore"
	JobLegacyImport    JobKind = "legacy_import"
	statusRunning              = "running"
	statusDone                 = "done"
	statusError                = "error"
	jobRetention               = 24 * time.Hour
	jobTimeout                 = 3 * time.Hour
	maxBackupsPerStore         = 20
)

// Job is the status of one background data operation.
type Job struct {
	ID         uuid.UUID  `json:"id"`
	StoreID    uuid.UUID  `json:"store_id"`
	Kind       JobKind    `json:"kind"`
	Status     string     `json:"status"` // running | done | error
	Step       string     `json:"step"`
	Progress   int        `json:"progress"` // 0..100, best effort
	Error      string     `json:"error,omitempty"`
	File       string     `json:"file,omitempty"`
	Report     any        `json:"report,omitempty"`
	StartedAt  time.Time  `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
	ActorName  string     `json:"actor_name,omitempty"`
}

func (j *Job) clone() Job {
	c := *j
	return c
}

// FileInfo is one downloadable backup file.
type FileInfo struct {
	Name      string    `json:"name"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"created_at"`
}

type Service struct {
	db    *postgres.DB
	audit postgres.AuditRepo
	dir   string
	log   *slog.Logger

	mu   sync.Mutex
	jobs map[uuid.UUID]*Job
	// one running job per store: these operations must not overlap
	busy map[uuid.UUID]uuid.UUID
}

func New(db *postgres.DB, dataDir string, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{
		db:   db,
		dir:  dataDir,
		log:  log,
		jobs: map[uuid.UUID]*Job{},
		busy: map[uuid.UUID]uuid.UUID{},
	}
}

// ---------------------------------------------------------------------------
// job bookkeeping
// ---------------------------------------------------------------------------

func (s *Service) start(storeID uuid.UUID, kind JobKind, actor Actor) (*Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id, ok := s.busy[storeID]; ok {
		if j, ok := s.jobs[id]; ok && j.Status == statusRunning {
			return nil, domain.ErrDataOpBusy.With("kind", string(j.Kind))
		}
	}
	j := &Job{ID: uuid.New(), StoreID: storeID, Kind: kind, Status: statusRunning, StartedAt: time.Now(), ActorName: actor.Name}
	s.jobs[j.ID] = j
	s.busy[storeID] = j.ID
	s.pruneLocked()
	return j, nil
}

func (s *Service) update(id uuid.UUID, step string, progress int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if j, ok := s.jobs[id]; ok {
		j.Step = step
		if progress >= 0 {
			j.Progress = progress
		}
	}
}

func (s *Service) finish(id uuid.UUID, file string, report any, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.jobs[id]
	if !ok {
		return
	}
	now := time.Now()
	j.FinishedAt = &now
	j.File = file
	j.Report = report
	if err != nil {
		j.Status = statusError
		j.Error = err.Error()
		return
	}
	j.Status = statusDone
	j.Progress = 100
}

func (s *Service) pruneLocked() {
	cutoff := time.Now().Add(-jobRetention)
	for id, j := range s.jobs {
		if j.Status != statusRunning && j.FinishedAt != nil && j.FinishedAt.Before(cutoff) {
			delete(s.jobs, id)
		}
	}
}

// Job returns one job of this store.
func (s *Service) Job(storeID, id uuid.UUID) (*Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.jobs[id]
	if !ok || j.StoreID != storeID {
		return nil, domain.ErrNotFound
	}
	c := j.clone()
	return &c, nil
}

// Jobs lists this store's jobs, newest first.
func (s *Service) Jobs(storeID uuid.UUID) []Job {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Job, 0, len(s.jobs))
	for _, j := range s.jobs {
		if j.StoreID == storeID {
			out = append(out, j.clone())
		}
	}
	sort.Slice(out, func(i, k int) bool { return out[i].StartedAt.After(out[k].StartedAt) })
	return out
}

// run executes fn in the background with its own context and records the outcome on the job.
func (s *Service) run(j *Job, fn func(ctx context.Context, j *Job) (string, any, error)) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), jobTimeout)
		defer cancel()
		defer func() {
			if r := recover(); r != nil {
				s.log.Error("data op panic", "kind", j.Kind, "job", j.ID, "panic", r)
				s.finish(j.ID, "", nil, fmt.Errorf("internal error"))
			}
		}()
		file, report, err := fn(ctx, j)
		if err != nil {
			s.log.Error("data op failed", "kind", j.Kind, "job", j.ID, "err", err)
		}
		s.finish(j.ID, file, report, err)
	}()
}

// ---------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------

var safeName = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

func (s *Service) storeDir(storeID uuid.UUID, sub string) (string, error) {
	dir := filepath.Join(s.dir, sub, storeID.String())
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", fmt.Errorf("create %s dir: %w", sub, err)
	}
	return dir, nil
}

// Files lists the backups kept on the server for this store, newest first.
func (s *Service) Files(storeID uuid.UUID) ([]FileInfo, error) {
	dir, err := s.storeDir(storeID, "backups")
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read backups: %w", err)
	}
	out := make([]FileInfo, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".zip" {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, FileInfo{Name: e.Name(), Size: info.Size(), CreatedAt: info.ModTime()})
	}
	sort.Slice(out, func(i, k int) bool { return out[i].CreatedAt.After(out[k].CreatedAt) })
	return out, nil
}

// FilePath resolves a backup file name inside the store's own directory.
func (s *Service) FilePath(storeID uuid.UUID, name string) (string, error) {
	if !safeName.MatchString(name) || filepath.Ext(name) != ".zip" {
		return "", domain.ErrValidation.With("field", "name")
	}
	dir, err := s.storeDir(storeID, "backups")
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, name)
	if _, err := os.Stat(path); err != nil {
		return "", domain.ErrNotFound
	}
	return path, nil
}

// DeleteFile removes one backup file.
func (s *Service) DeleteFile(ctx context.Context, actor Actor, storeID uuid.UUID, name string) error {
	path, err := s.FilePath(storeID, name)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil {
		return fmt.Errorf("delete backup: %w", err)
	}
	return s.writeAudit(ctx, actor, storeID, "backup.delete", name, nil)
}

// SaveUpload streams an uploaded archive into the store's incoming directory and returns its path.
func (s *Service) SaveUpload(storeID uuid.UUID, sub, name string, copyTo func(dst *os.File) error) (string, error) {
	dir, err := s.storeDir(storeID, sub)
	if err != nil {
		return "", err
	}
	ext := filepath.Ext(name)
	if ext == "" {
		ext = ".zip"
	}
	f, err := os.CreateTemp(dir, fmt.Sprintf("upload-*%s", ext))
	if err != nil {
		return "", fmt.Errorf("create upload: %w", err)
	}
	defer f.Close()
	if err := copyTo(f); err != nil {
		_ = os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}

// trimBackups keeps only the newest maxBackupsPerStore files.
func (s *Service) trimBackups(storeID uuid.UUID) {
	files, err := s.Files(storeID)
	if err != nil || len(files) <= maxBackupsPerStore {
		return
	}
	dir, err := s.storeDir(storeID, "backups")
	if err != nil {
		return
	}
	for _, f := range files[maxBackupsPerStore:] {
		_ = os.Remove(filepath.Join(dir, f.Name))
	}
}

func (s *Service) writeAudit(ctx context.Context, actor Actor, storeID uuid.UUID, action, entityID string, after any) error {
	return s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		id := actor.UserID
		return s.audit.Write(ctx, domain.AuditEntry{
			StoreID: &storeID, ActorID: &id, ActorName: actor.Name,
			Action: action, Entity: "data_ops", EntityID: entityID, After: after, IP: actor.IP,
		})
	})
}
