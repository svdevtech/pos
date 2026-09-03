package httptransport

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
	"github.com/svdev/pos/internal/usecase/dividenduc"
)

// DividendService is implemented by dividenduc.Service.
type DividendService interface {
	ListPeriods(ctx context.Context, storeID uuid.UUID) ([]postgres.PeriodSummary, error)
	CreatePeriod(ctx context.Context, storeID uuid.UUID, actor dividenduc.Actor, in dividenduc.CreatePeriodInput) (*dividenduc.PeriodDetail, error)
	GetPeriod(ctx context.Context, storeID, id uuid.UUID) (*dividenduc.PeriodDetail, error)
	UpdatePeriod(ctx context.Context, storeID uuid.UUID, actor dividenduc.Actor, id uuid.UUID, in dividenduc.UpdatePeriodInput) (*dividenduc.PeriodDetail, error)
	PutCriteria(ctx context.Context, storeID uuid.UUID, actor dividenduc.Actor, id uuid.UUID, in []dividenduc.CriterionInput) ([]domain.DividendCriterion, error)
	Simulate(ctx context.Context, storeID uuid.UUID, actor dividenduc.Actor, id uuid.UUID) (*domain.DividendRun, error)
	Approve(ctx context.Context, storeID uuid.UUID, actor dividenduc.Actor, id uuid.UUID) (*dividenduc.PeriodDetail, error)
	MarkPaid(ctx context.Context, storeID uuid.UUID, actor dividenduc.Actor, id uuid.UUID) (*dividenduc.PeriodDetail, error)
	Close(ctx context.Context, storeID uuid.UUID, actor dividenduc.Actor, id uuid.UUID) (*dividenduc.PeriodDetail, error)
	GetRun(ctx context.Context, storeID, runID uuid.UUID) (*domain.DividendRun, error)
	Statements(ctx context.Context, storeID, runID uuid.UUID, q string, limit, offset int) ([]domain.DividendStatement, int64, error)
	ExportCSV(ctx context.Context, storeID, runID uuid.UUID) ([]byte, string, error)
	VerifyRun(ctx context.Context, storeID, runID uuid.UUID) (*dividenduc.VerifyReport, error)
	GetStatement(ctx context.Context, storeID, id uuid.UUID) (*dividenduc.StatementDetail, error)
	AddPayout(ctx context.Context, storeID uuid.UUID, actor dividenduc.Actor, id uuid.UUID, in dividenduc.PayoutInput) (*dividenduc.StatementDetail, error)
	MemberHistory(ctx context.Context, storeID, memberID uuid.UUID) ([]postgres.MemberStatementRow, error)
}

func dividendActor(r *http.Request) dividenduc.Actor {
	p := PrincipalFrom(r.Context())
	return dividenduc.Actor{UserID: p.UserID, Name: p.Name, IP: r.RemoteAddr}
}

func (s *Server) mountDividends(r chi.Router) {
	// withID parses {name} and hands it to fn; errors are written as the envelope.
	withID := func(name string, fn func(w http.ResponseWriter, r *http.Request, id uuid.UUID)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, name)
			if err != nil {
				fail(w, r, err)
				return
			}
			fn(w, r, id)
		}
	}
	// transition wraps approve / mark-paid / close; the service is resolved per request so mounting never dereferences a nil Deps.Dividend.
	type transitionFn = func(ctx context.Context, storeID uuid.UUID, actor dividenduc.Actor, id uuid.UUID) (*dividenduc.PeriodDetail, error)
	transition := func(pick func(svc DividendService) transitionFn) http.HandlerFunc {
		return withID("id", func(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
			out, err := pick(s.Dividend)(r.Context(), storeID(r), dividendActor(r), id)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
	}

	r.Route("/dividends", func(r chi.Router) {
		r.With(requireRole(rolesAll...)).Get("/periods", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Dividend.ListPeriods(r.Context(), storeID(r))
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesManage...)).Post("/periods", func(w http.ResponseWriter, r *http.Request) {
			var in dividenduc.CreatePeriodInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Dividend.CreatePeriod(r.Context(), storeID(r), dividendActor(r), in)
			if err != nil {
				fail(w, r, err)
				return
			}
			created(w, out)
		})
		r.With(requireRole(rolesAll...)).Get("/periods/{id}", withID("id", func(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
			out, err := s.Dividend.GetPeriod(r.Context(), storeID(r), id)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		}))
		r.With(requireRole(rolesManage...)).Patch("/periods/{id}", withID("id", func(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
			var in dividenduc.UpdatePeriodInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Dividend.UpdatePeriod(r.Context(), storeID(r), dividendActor(r), id, in)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		}))
		r.With(requireRole(rolesManage...)).Put("/periods/{id}/criteria", withID("id", func(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
			var in []dividenduc.CriterionInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Dividend.PutCriteria(r.Context(), storeID(r), dividendActor(r), id, in)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		}))
		r.With(requireRole(rolesManage...)).Post("/periods/{id}/simulate", withID("id", func(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
			out, err := s.Dividend.Simulate(r.Context(), storeID(r), dividendActor(r), id)
			if err != nil {
				fail(w, r, err)
				return
			}
			created(w, out)
		}))
		r.With(requireRole(rolesOwner...)).Post("/periods/{id}/approve", transition(func(svc DividendService) transitionFn { return svc.Approve }))
		r.With(requireRole(rolesOwner...)).Post("/periods/{id}/mark-paid", transition(func(svc DividendService) transitionFn { return svc.MarkPaid }))
		r.With(requireRole(rolesOwner...)).Post("/periods/{id}/close", transition(func(svc DividendService) transitionFn { return svc.Close }))

		r.With(requireRole(rolesAll...)).Get("/runs/{id}", withID("id", func(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
			out, err := s.Dividend.GetRun(r.Context(), storeID(r), id)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		}))
		r.With(requireRole(rolesAll...)).Get("/runs/{id}/statements", withID("id", func(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
			page, size := paging(r)
			items, total, err := s.Dividend.Statements(r.Context(), storeID(r), id, queryStr(r, "q"), size, (page-1)*size)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, Page[domain.DividendStatement]{Items: items, Total: total, Page: page, PageSize: size})
		}))
		r.With(requireRole(rolesAll...)).Get("/runs/{id}/export.csv", withID("id", func(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
			b, name, err := s.Dividend.ExportCSV(r.Context(), storeID(r), id)
			if err != nil {
				fail(w, r, err)
				return
			}
			w.Header().Set("Content-Type", "text/csv; charset=utf-8")
			w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(b)
		}))
		r.With(requireRole(rolesAll...)).Get("/runs/{id}/verify", withID("id", func(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
			out, err := s.Dividend.VerifyRun(r.Context(), storeID(r), id)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		}))

		r.With(requireRole(rolesAll...)).Get("/statements/{id}", withID("id", func(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
			out, err := s.Dividend.GetStatement(r.Context(), storeID(r), id)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		}))
		r.With(requireRole(rolesOwner...)).Post("/statements/{id}/payouts", withID("id", func(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
			var in dividenduc.PayoutInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Dividend.AddPayout(r.Context(), storeID(r), dividendActor(r), id, in)
			if err != nil {
				fail(w, r, err)
				return
			}
			created(w, out)
		}))
		r.With(requireRole(rolesAll...)).Get("/members/{memberId}/history", withID("memberId", func(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
			out, err := s.Dividend.MemberHistory(r.Context(), storeID(r), id)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		}))
	})
}
