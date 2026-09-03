package httptransport

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
	"github.com/svdev/pos/internal/usecase/aruc"
)

type ARService interface {
	Pay(ctx context.Context, storeID uuid.UUID, actor aruc.Actor, in aruc.PaymentInput) ([]domain.ARPayment, error)
	Accounts(ctx context.Context, storeID uuid.UUID, q string, limit, offset int) ([]postgres.ARAccount, int64, error)
	MemberBills(ctx context.Context, storeID, memberID uuid.UUID) (*aruc.MemberBills, error)
	Payments(ctx context.Context, storeID uuid.UUID, f postgres.ARFilter) ([]domain.ARPayment, int64, error)
	Aging(ctx context.Context, storeID uuid.UUID, asOf time.Time) (*aruc.Aging, error)
}

func (s *Server) mountAR(r chi.Router) {
	r.Route("/ar", func(r chi.Router) {
		r.With(requireRole(rolesAll...)).Get("/accounts", func(w http.ResponseWriter, r *http.Request) {
			page, size := paging(r)
			items, total, err := s.AR.Accounts(r.Context(), storeID(r), queryStr(r, "q"), size, (page-1)*size)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, Page[postgres.ARAccount]{Items: items, Total: total, Page: page, PageSize: size})
		})
		r.With(requireRole(rolesAll...)).Get("/members/{id}/bills", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.AR.MemberBills(r.Context(), storeID(r), id)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesSell...)).Post("/payments", func(w http.ResponseWriter, r *http.Request) {
			var in aruc.PaymentInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			p := PrincipalFrom(r.Context())
			out, err := s.AR.Pay(r.Context(), storeID(r), aruc.Actor{UserID: p.UserID, Name: p.Name, IP: r.RemoteAddr}, in)
			if err != nil {
				fail(w, r, err)
				return
			}
			created(w, out)
		})
		r.With(requireRole(rolesAll...)).Get("/payments", func(w http.ResponseWriter, r *http.Request) {
			page, size := paging(r)
			f := postgres.ARFilter{MemberID: optUUID(queryStr(r, "member_id")), SaleID: optUUID(queryStr(r, "sale_id")), Limit: size, Offset: (page - 1) * size}
			if queryStr(r, "from") != "" || queryStr(r, "to") != "" {
				from, to := dateRange(r)
				f.From, f.To = &from, &to
			}
			items, total, err := s.AR.Payments(r.Context(), storeID(r), f)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, Page[domain.ARPayment]{Items: items, Total: total, Page: page, PageSize: size})
		})
		r.With(requireRole(rolesAll...)).Get("/aging", func(w http.ResponseWriter, r *http.Request) {
			asOf := time.Now()
			if v := queryStr(r, "as_of"); v != "" {
				if t, err := time.Parse("2006-01-02", v); err == nil {
					asOf = t
				}
			}
			out, err := s.AR.Aging(r.Context(), storeID(r), asOf)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
	})
}
