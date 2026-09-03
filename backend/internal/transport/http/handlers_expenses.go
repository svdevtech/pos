package httptransport

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
	"github.com/svdev/pos/internal/usecase/expenseuc"
)

type ExpenseService interface {
	ListTypes(ctx context.Context, storeID uuid.UUID) ([]domain.ExpenseType, error)
	SaveType(ctx context.Context, storeID uuid.UUID, t domain.ExpenseType) (*domain.ExpenseType, error)
	Create(ctx context.Context, storeID uuid.UUID, actor expenseuc.Actor, in expenseuc.ExpenseInput) (*domain.Expense, error)
	Update(ctx context.Context, storeID uuid.UUID, actor expenseuc.Actor, id uuid.UUID, in expenseuc.ExpenseInput) (*domain.Expense, error)
	Delete(ctx context.Context, storeID uuid.UUID, actor expenseuc.Actor, id uuid.UUID) error
	List(ctx context.Context, storeID uuid.UUID, f postgres.ExpenseFilter, page, size int) (*expenseuc.ListResult, error)
}

func expenseActor(r *http.Request) expenseuc.Actor {
	p := PrincipalFrom(r.Context())
	return expenseuc.Actor{UserID: p.UserID, Name: p.Name, IP: r.RemoteAddr}
}

func (s *Server) mountExpenses(r chi.Router) {
	r.Route("/expenses", func(r chi.Router) {
		r.With(requireRole(rolesAll...)).Get("/types", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Expense.ListTypes(r.Context(), storeID(r))
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesManage...)).Post("/types", func(w http.ResponseWriter, r *http.Request) {
			var t domain.ExpenseType
			if err := decode(r, &t); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Expense.SaveType(r.Context(), storeID(r), t)
			if err != nil {
				fail(w, r, err)
				return
			}
			created(w, out)
		})
		r.With(requireRole(rolesManage...)).Patch("/types/{id}", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			var t domain.ExpenseType
			if err := decode(r, &t); err != nil {
				fail(w, r, err)
				return
			}
			t.ID = id
			out, err := s.Expense.SaveType(r.Context(), storeID(r), t)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesAll...)).Get("/", func(w http.ResponseWriter, r *http.Request) {
			page, size := paging(r)
			f := postgres.ExpenseFilter{TypeID: optUUID(queryStr(r, "type_id")), Limit: size, Offset: (page - 1) * size}
			if queryStr(r, "from") != "" || queryStr(r, "to") != "" {
				from, to := dateRange(r)
				f.From, f.To = &from, &to
			}
			out, err := s.Expense.List(r.Context(), storeID(r), f, page, size)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesSell...)).Post("/", func(w http.ResponseWriter, r *http.Request) {
			var in expenseuc.ExpenseInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Expense.Create(r.Context(), storeID(r), expenseActor(r), in)
			if err != nil {
				fail(w, r, err)
				return
			}
			created(w, out)
		})
		r.With(requireRole(rolesManage...)).Patch("/{id}", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			var in expenseuc.ExpenseInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Expense.Update(r.Context(), storeID(r), expenseActor(r), id, in)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesManage...)).Delete("/{id}", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			if err := s.Expense.Delete(r.Context(), storeID(r), expenseActor(r), id); err != nil {
				fail(w, r, err)
				return
			}
			noContent(w)
		})
	})
}
