package httptransport

import (
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/usecase/dataopsuc"
	"github.com/svdev/pos/internal/usecase/storeuc"
)

// DataOpsService covers backup, restore and the legacy MS Access import, all started from the
// owner's "data" screen and all executed as background jobs.
type DataOpsService interface {
	Jobs(storeID uuid.UUID) []dataopsuc.Job
	Job(storeID, id uuid.UUID) (*dataopsuc.Job, error)

	StartBackup(ctx context.Context, actor storeuc.Actor, storeID uuid.UUID) (*dataopsuc.Job, error)
	Files(storeID uuid.UUID) ([]dataopsuc.FileInfo, error)
	FilePath(storeID uuid.UUID, name string) (string, error)
	DeleteFile(ctx context.Context, actor storeuc.Actor, storeID uuid.UUID, name string) error
	SaveUpload(storeID uuid.UUID, sub, name string, copyTo func(dst *os.File) error) (string, error)
	StartRestore(ctx context.Context, actor storeuc.Actor, storeID uuid.UUID, path, label string, opt dataopsuc.RestoreOptions) (*dataopsuc.Job, error)

	StagedLegacyDump(storeID uuid.UUID) (*dataopsuc.LegacyDump, error)
	StageLegacyDump(storeID uuid.UUID, archivePath, fileName string) (*dataopsuc.LegacyDump, error)
	DiscardLegacyDump(storeID uuid.UUID) error
	StartLegacyImport(ctx context.Context, actor storeuc.Actor, storeID uuid.UUID, dryRun bool) (*dataopsuc.Job, error)
}

// uploads are big (a full legacy dump is ~100 MB, a backup of a busy store more)
const maxUploadBytes = 4 << 30

// mountDataOps: owner-only backup / restore / legacy import.
func (s *Server) mountDataOps(r chi.Router) {
	r.Route("/store/data", func(r chi.Router) {
		r.Use(requireRole(rolesOwner...))

		r.Get("/jobs", func(w http.ResponseWriter, r *http.Request) {
			if s.DataOps == nil {
				fail(w, r, domain.ErrFeatureDisabled)
				return
			}
			ok(w, s.DataOps.Jobs(storeID(r)))
		})
		r.Get("/jobs/{id}", func(w http.ResponseWriter, r *http.Request) {
			if s.DataOps == nil {
				fail(w, r, domain.ErrFeatureDisabled)
				return
			}
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			job, err := s.DataOps.Job(storeID(r), id)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, job)
		})

		// ---- backups ------------------------------------------------------
		r.Post("/backups", func(w http.ResponseWriter, r *http.Request) {
			if s.DataOps == nil {
				fail(w, r, domain.ErrFeatureDisabled)
				return
			}
			job, err := s.DataOps.StartBackup(r.Context(), actorOf(r), storeID(r))
			if err != nil {
				fail(w, r, err)
				return
			}
			created(w, job)
		})
		r.Get("/backups", func(w http.ResponseWriter, r *http.Request) {
			if s.DataOps == nil {
				fail(w, r, domain.ErrFeatureDisabled)
				return
			}
			files, err := s.DataOps.Files(storeID(r))
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, files)
		})
		r.Get("/backups/{name}", func(w http.ResponseWriter, r *http.Request) {
			if s.DataOps == nil {
				fail(w, r, domain.ErrFeatureDisabled)
				return
			}
			name := chi.URLParam(r, "name")
			path, err := s.DataOps.FilePath(storeID(r), name)
			if err != nil {
				fail(w, r, err)
				return
			}
			w.Header().Set("Content-Type", "application/zip")
			w.Header().Set("Content-Disposition", "attachment; filename=\""+filepath.Base(path)+"\"")
			http.ServeFile(w, r, path)
		})
		r.Delete("/backups/{name}", func(w http.ResponseWriter, r *http.Request) {
			if s.DataOps == nil {
				fail(w, r, domain.ErrFeatureDisabled)
				return
			}
			if err := s.DataOps.DeleteFile(r.Context(), actorOf(r), storeID(r), chi.URLParam(r, "name")); err != nil {
				fail(w, r, err)
				return
			}
			noContent(w)
		})

		// ---- restore ------------------------------------------------------
		r.Post("/restore", func(w http.ResponseWriter, r *http.Request) {
			if s.DataOps == nil {
				fail(w, r, domain.ErrFeatureDisabled)
				return
			}
			sid := storeID(r)
			opt := dataopsuc.RestoreOptions{}
			var path, label string

			if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
				fh, form, err := openUpload(w, r, "file")
				if err != nil {
					fail(w, r, err)
					return
				}
				defer fh.Close()
				opt.Replace = form.Value["replace"] != nil && form.Value["replace"][0] == "true"
				opt.Profile = form.Value["profile"] != nil && form.Value["profile"][0] == "true"
				label = firstValue(form.Value["file_name"])
				saved, err := s.DataOps.SaveUpload(sid, "restore", label, func(dst *os.File) error {
					_, cerr := io.Copy(dst, fh)
					return cerr
				})
				if err != nil {
					fail(w, r, err)
					return
				}
				path = saved
			} else {
				var in struct {
					Name    string `json:"name"`
					Replace bool   `json:"replace"`
					Profile bool   `json:"profile"`
				}
				if err := decode(r, &in); err != nil {
					fail(w, r, err)
					return
				}
				p, err := s.DataOps.FilePath(sid, in.Name)
				if err != nil {
					fail(w, r, err)
					return
				}
				path, label, opt.Replace, opt.Profile = p, in.Name, in.Replace, in.Profile
			}

			job, err := s.DataOps.StartRestore(r.Context(), actorOf(r), sid, path, label, opt)
			if err != nil {
				fail(w, r, err)
				return
			}
			created(w, job)
		})

		// ---- legacy MS Access import --------------------------------------
		r.Get("/legacy", func(w http.ResponseWriter, r *http.Request) {
			if s.DataOps == nil {
				fail(w, r, domain.ErrFeatureDisabled)
				return
			}
			dump, err := s.DataOps.StagedLegacyDump(storeID(r))
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, dump)
		})
		r.Post("/legacy/upload", func(w http.ResponseWriter, r *http.Request) {
			if s.DataOps == nil {
				fail(w, r, domain.ErrFeatureDisabled)
				return
			}
			sid := storeID(r)
			fh, form, err := openUpload(w, r, "file")
			if err != nil {
				fail(w, r, err)
				return
			}
			defer fh.Close()
			name := firstValue(form.Value["file_name"])
			saved, err := s.DataOps.SaveUpload(sid, "legacy-uploads", name, func(dst *os.File) error {
				_, cerr := io.Copy(dst, fh)
				return cerr
			})
			if err != nil {
				fail(w, r, err)
				return
			}
			dump, err := s.DataOps.StageLegacyDump(sid, saved, name)
			if err != nil {
				_ = os.Remove(saved)
				fail(w, r, err)
				return
			}
			created(w, dump)
		})
		r.Delete("/legacy", func(w http.ResponseWriter, r *http.Request) {
			if s.DataOps == nil {
				fail(w, r, domain.ErrFeatureDisabled)
				return
			}
			if err := s.DataOps.DiscardLegacyDump(storeID(r)); err != nil {
				fail(w, r, err)
				return
			}
			noContent(w)
		})
		r.Post("/legacy/import", func(w http.ResponseWriter, r *http.Request) {
			if s.DataOps == nil {
				fail(w, r, domain.ErrFeatureDisabled)
				return
			}
			var in struct {
				DryRun bool `json:"dry_run"`
			}
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			job, err := s.DataOps.StartLegacyImport(r.Context(), actorOf(r), storeID(r), in.DryRun)
			if err != nil {
				fail(w, r, err)
				return
			}
			created(w, job)
		})
	})
}

// openUpload returns the first file of a multipart form together with the parsed form.
func openUpload(w http.ResponseWriter, r *http.Request, field string) (multipart.File, *multipart.Form, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		return nil, nil, domain.ErrValidation.Wrap(err)
	}
	form := r.MultipartForm
	files := form.File[field]
	if len(files) == 0 {
		return nil, nil, domain.ErrValidation.With("field", field)
	}
	fh, err := files[0].Open()
	if err != nil {
		return nil, nil, domain.ErrValidation.Wrap(err)
	}
	if form.Value == nil {
		form.Value = map[string][]string{}
	}
	if form.Value["file_name"] == nil {
		form.Value["file_name"] = []string{filepath.Base(files[0].Filename)}
	}
	return fh, form, nil
}

func firstValue(v []string) string {
	if len(v) == 0 {
		return ""
	}
	return v[0]
}
