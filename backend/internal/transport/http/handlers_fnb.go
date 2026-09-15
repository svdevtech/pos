package httptransport

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/usecase/fnbuc"
)

// FnbService is the restaurant / café module: the menu the till sells from and the orders the
// kitchen works through.
type FnbService interface {
	Menu(ctx context.Context, storeID uuid.UUID, activeOnly bool) (*fnbuc.MenuView, error)
	SaveStation(ctx context.Context, storeID uuid.UUID, st domain.KitchenStation) (*domain.KitchenStation, error)
	SaveCategory(ctx context.Context, storeID uuid.UUID, c domain.MenuCategory) (*domain.MenuCategory, error)
	SaveMenuItem(ctx context.Context, storeID uuid.UUID, m domain.MenuItem) (*domain.MenuItem, error)
	SaveModifierGroup(ctx context.Context, storeID uuid.UUID, g domain.ModifierGroup) (*domain.ModifierGroup, error)
	CreateOrder(ctx context.Context, storeID uuid.UUID, actor fnbuc.Actor, in fnbuc.CreateOrderInput) (*domain.Order, error)
	Get(ctx context.Context, storeID, id uuid.UUID) (*domain.Order, error)
	List(ctx context.Context, storeID uuid.UUID, openOnly bool, since time.Time, limit int) ([]domain.Order, error)
	SetItemStatus(ctx context.Context, storeID uuid.UUID, actor fnbuc.Actor, orderID, itemID uuid.UUID, status domain.ItemStatus, made bool) (*domain.Order, error)
	SetStatus(ctx context.Context, storeID uuid.UUID, actor fnbuc.Actor, id uuid.UUID, status domain.OrderStatus) (*domain.Order, error)
}

func fnbActor(r *http.Request) fnbuc.Actor {
	a := actorOf(r)
	return fnbuc.Actor{UserID: a.UserID, Name: a.Name}
}

func (s *Server) mountFnb(r chi.Router) {
	r.Route("/fnb", func(r chi.Router) {
		// ---- menu: the till reads it, managers edit it
		r.With(requireRole(rolesAll...)).Get("/menu", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Fnb.Menu(r.Context(), storeID(r), queryStr(r, "all") != "1")
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesManage...)).Put("/menu/stations", func(w http.ResponseWriter, r *http.Request) {
			var in domain.KitchenStation
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Fnb.SaveStation(r.Context(), storeID(r), in)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesManage...)).Put("/menu/categories", func(w http.ResponseWriter, r *http.Request) {
			var in domain.MenuCategory
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Fnb.SaveCategory(r.Context(), storeID(r), in)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesManage...)).Put("/menu/items", func(w http.ResponseWriter, r *http.Request) {
			var in domain.MenuItem
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Fnb.SaveMenuItem(r.Context(), storeID(r), in)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesManage...)).Put("/menu/modifier-groups", func(w http.ResponseWriter, r *http.Request) {
			var in domain.ModifierGroup
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Fnb.SaveModifierGroup(r.Context(), storeID(r), in)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})

		// ---- orders
		r.With(requireRole(rolesSell...)).Post("/orders", func(w http.ResponseWriter, r *http.Request) {
			var in fnbuc.CreateOrderInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Fnb.CreateOrder(r.Context(), storeID(r), fnbActor(r), in)
			if err != nil {
				fail(w, r, err)
				return
			}
			created(w, out)
		})
		r.With(requireRole(rolesAll...)).Get("/orders", func(w http.ResponseWriter, r *http.Request) {
			// default: today's orders, so the kitchen and the queue screen never page
			since := time.Now().Add(-24 * time.Hour)
			if v := queryStr(r, "since"); v != "" {
				if t, err := time.Parse(time.RFC3339, v); err == nil {
					since = t
				}
			}
			out, err := s.Fnb.List(r.Context(), storeID(r), queryStr(r, "open") == "1", since, queryInt(r, "limit", 200))
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesAll...)).Get("/orders/{id}", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Fnb.Get(r.Context(), storeID(r), id)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesSell...)).Post("/orders/{id}/items/{itemId}/status", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			itemID, err := uuidParam(r, "itemId")
			if err != nil {
				fail(w, r, err)
				return
			}
			var in struct {
				Status domain.ItemStatus `json:"status"`
				// for a void after the kitchen already made it: write the food off rather than restock
				Made bool `json:"made"`
			}
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Fnb.SetItemStatus(r.Context(), storeID(r), fnbActor(r), id, itemID, in.Status, in.Made)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesSell...)).Post("/orders/{id}/status", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			var in struct {
				Status domain.OrderStatus `json:"status"`
			}
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Fnb.SetStatus(r.Context(), storeID(r), fnbActor(r), id, in.Status)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
	})
}
