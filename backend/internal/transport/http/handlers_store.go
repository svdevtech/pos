package httptransport

import (
	"context"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
	"github.com/svdev/pos/internal/usecase/storeuc"
)

type StoreService interface {
	GetStore(ctx context.Context, storeID uuid.UUID) (*domain.Store, error)
	UpdateStore(ctx context.Context, actor storeuc.Actor, storeID uuid.UUID, st domain.Store) (*domain.Store, error)
	SetLogo(ctx context.Context, storeID uuid.UUID, logo []byte) error
	GetLogo(ctx context.Context, storeID uuid.UUID) ([]byte, error)
	GetSettings(ctx context.Context, storeID uuid.UUID) (domain.StoreSettings, error)
	PutSettings(ctx context.Context, actor storeuc.Actor, storeID uuid.UUID, in domain.StoreSettings) (domain.StoreSettings, error)
	ListUsers(ctx context.Context, storeID uuid.UUID) ([]domain.User, error)
	CreateUser(ctx context.Context, actor storeuc.Actor, storeID uuid.UUID, in storeuc.UserInput) (*domain.User, error)
	UpdateUser(ctx context.Context, actor storeuc.Actor, storeID, userID uuid.UUID, in storeuc.UserInput) (*domain.User, error)
	AuditLogs(ctx context.Context, storeID uuid.UUID, entity string, limit, offset int) ([]postgres.AuditRow, int64, error)
}

type AdminService interface {
	ListStores(ctx context.Context) ([]domain.Store, error)
	CreateStore(ctx context.Context, actor storeuc.Actor, in storeuc.CreateStoreInput) (*domain.Store, error)
	UpdateStoreAdmin(ctx context.Context, actor storeuc.Actor, st domain.Store) (*domain.Store, error)
}

func actorOf(r *http.Request) storeuc.Actor {
	p := PrincipalFrom(r.Context())
	return storeuc.Actor{UserID: p.UserID, Name: p.Name, IP: r.RemoteAddr}
}

func storeID(r *http.Request) uuid.UUID { return ScopeFrom(r.Context()).StoreID }

// mountAdmin: platform-admin routes (no tenant scope required)
func (s *Server) mountAdmin(r chi.Router) {
	r.Route("/admin", func(r chi.Router) {
		r.Use(requireRole("platform_admin"))
		r.Get("/stores", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Admin.ListStores(r.Context())
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.Post("/stores", func(w http.ResponseWriter, r *http.Request) {
			var in storeuc.CreateStoreInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Admin.CreateStore(r.Context(), actorOf(r), in)
			if err != nil {
				fail(w, r, err)
				return
			}
			created(w, out)
		})
		r.Patch("/stores/{id}", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			var st domain.Store
			if err := decode(r, &st); err != nil {
				fail(w, r, err)
				return
			}
			st.ID = id
			out, err := s.Admin.UpdateStoreAdmin(r.Context(), actorOf(r), st)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.Get("/import-runs", s.importRuns)
	})
}

// mountStore: current-store profile, settings, users, audit
func (s *Server) mountStore(r chi.Router) {
	r.Route("/store", func(r chi.Router) {
		r.With(requireRole(rolesAll...)).Get("/", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Store.GetStore(r.Context(), storeID(r))
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesOwner...)).Patch("/", func(w http.ResponseWriter, r *http.Request) {
			var st domain.Store
			if err := decode(r, &st); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Store.UpdateStore(r.Context(), actorOf(r), storeID(r), st)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.Get("/logo", func(w http.ResponseWriter, r *http.Request) {
			b, err := s.Store.GetLogo(r.Context(), storeID(r))
			if err != nil || len(b) == 0 {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", http.DetectContentType(b))
			w.Header().Set("Cache-Control", "private, max-age=300")
			_, _ = w.Write(b)
		})
		r.With(requireRole(rolesOwner...)).Put("/logo", func(w http.ResponseWriter, r *http.Request) {
			b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
			if err != nil {
				fail(w, r, domain.ErrBadRequest.With("reason", "logo too large (max 1 MB)"))
				return
			}
			if err := s.Store.SetLogo(r.Context(), storeID(r), b); err != nil {
				fail(w, r, err)
				return
			}
			noContent(w)
		})
		r.With(requireRole(rolesAll...)).Get("/settings", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Store.GetSettings(r.Context(), storeID(r))
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesManage...)).Put("/settings", func(w http.ResponseWriter, r *http.Request) {
			var in domain.StoreSettings
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Store.PutSettings(r.Context(), actorOf(r), storeID(r), in)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.Route("/users", func(r chi.Router) {
			r.Use(requireRole(rolesOwner...))
			r.Get("/", func(w http.ResponseWriter, r *http.Request) {
				out, err := s.Store.ListUsers(r.Context(), storeID(r))
				if err != nil {
					fail(w, r, err)
					return
				}
				ok(w, out)
			})
			r.Post("/", func(w http.ResponseWriter, r *http.Request) {
				var in storeuc.UserInput
				if err := decode(r, &in); err != nil {
					fail(w, r, err)
					return
				}
				out, err := s.Store.CreateUser(r.Context(), actorOf(r), storeID(r), in)
				if err != nil {
					fail(w, r, err)
					return
				}
				created(w, out)
			})
			r.Patch("/{id}", func(w http.ResponseWriter, r *http.Request) {
				id, err := uuidParam(r, "id")
				if err != nil {
					fail(w, r, err)
					return
				}
				var in storeuc.UserInput
				if err := decode(r, &in); err != nil {
					fail(w, r, err)
					return
				}
				out, err := s.Store.UpdateUser(r.Context(), actorOf(r), storeID(r), id, in)
				if err != nil {
					fail(w, r, err)
					return
				}
				ok(w, out)
			})
		})
		r.With(requireRole(rolesManage...)).Get("/audit-logs", func(w http.ResponseWriter, r *http.Request) {
			page, size := paging(r)
			rows, total, err := s.Store.AuditLogs(r.Context(), storeID(r), queryStr(r, "entity"), size, (page-1)*size)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, Page[postgres.AuditRow]{Items: rows, Total: total, Page: page, PageSize: size})
		})
	})
}
