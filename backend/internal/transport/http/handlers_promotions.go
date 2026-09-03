package httptransport

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/usecase/promouc"
)

type PromotionService interface {
	List(ctx context.Context, storeID uuid.UUID, activeOnly bool) ([]domain.Promotion, error)
	Create(ctx context.Context, storeID uuid.UUID, actor promouc.Actor, p domain.Promotion) (*domain.Promotion, error)
	Update(ctx context.Context, storeID uuid.UUID, actor promouc.Actor, p domain.Promotion) (*domain.Promotion, error)
	Delete(ctx context.Context, storeID uuid.UUID, actor promouc.Actor, id uuid.UUID) error
}

func promoActor(r *http.Request) promouc.Actor {
	p := PrincipalFrom(r.Context())
	return promouc.Actor{UserID: p.UserID, Name: p.Name, IP: r.RemoteAddr}
}

func (s *Server) mountPromotions(r chi.Router) {
	r.Route("/promotions", func(r chi.Router) {
		r.With(requireRole(rolesAll...)).Get("/", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Promo.List(r.Context(), storeID(r), queryStr(r, "active") == "1")
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesSell...)).Get("/active", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Promo.List(r.Context(), storeID(r), true)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesManage...)).Post("/", func(w http.ResponseWriter, r *http.Request) {
			var p domain.Promotion
			if err := decode(r, &p); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Promo.Create(r.Context(), storeID(r), promoActor(r), p)
			if err != nil {
				fail(w, r, err)
				return
			}
			created(w, out)
		})
		r.With(requireRole(rolesManage...)).Put("/{id}", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			var p domain.Promotion
			if err := decode(r, &p); err != nil {
				fail(w, r, err)
				return
			}
			p.ID = id
			out, err := s.Promo.Update(r.Context(), storeID(r), promoActor(r), p)
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
			if err := s.Promo.Delete(r.Context(), storeID(r), promoActor(r), id); err != nil {
				fail(w, r, err)
				return
			}
			noContent(w)
		})
	})
}
