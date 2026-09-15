package httptransport

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
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
	Subscribe(ctx context.Context, storeID uuid.UUID) <-chan fnbuc.Event
	TableTokens(ctx context.Context, storeID uuid.UUID, ensure []string) ([]fnbuc.TableToken, error)
	RotateTableToken(ctx context.Context, storeID uuid.UUID, tableCode string) (*fnbuc.TableToken, error)
	TableByToken(ctx context.Context, token string) (*fnbuc.TableView, error)
	TableOrders(ctx context.Context, token string) ([]domain.Order, error)
	TableCreateOrder(ctx context.Context, token string, lines []fnbuc.LineInput, note string) (*domain.Order, error)
	SubscribeTable(ctx context.Context, token string) (<-chan fnbuc.Event, error)
	Quote(ctx context.Context, storeID uuid.UUID, orderIDs []uuid.UUID) (*fnbuc.CheckoutQuote, error)
	Checkout(ctx context.Context, storeID uuid.UUID, actor fnbuc.Actor, in fnbuc.CheckoutInput) (*domain.Sale, error)
	Floor(ctx context.Context, storeID uuid.UUID, activeOnly bool) (*fnbuc.FloorView, error)
	SaveZone(ctx context.Context, storeID uuid.UUID, z domain.FloorZone) (*domain.FloorZone, error)
	SaveTable(ctx context.Context, storeID uuid.UUID, t domain.FloorTable) (*domain.FloorTable, error)
}

// streamEvents writes order events as server-sent events until the client goes away. A comment
// line every 25 s keeps proxies from closing an idle connection.
func streamEvents(w http.ResponseWriter, r *http.Request, events <-chan fnbuc.Event) {
	fl, ok := w.(http.Flusher)
	if !ok {
		fail(w, r, domain.ErrValidation.With("reason", "streaming unsupported"))
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("retry: 3000\n\n"))
	fl.Flush()
	tick := time.NewTicker(25 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-tick.C:
			if _, err := w.Write([]byte(": ping\n\n")); err != nil {
				return
			}
			fl.Flush()
		case ev, open := <-events:
			if !open {
				return
			}
			body, err := json.Marshal(ev)
			if err != nil {
				continue
			}
			if _, err := w.Write([]byte("event: order\ndata: " + string(body) + "\n\n")); err != nil {
				return
			}
			fl.Flush()
		}
	}
}

// mountPublicFnb is what a customer's phone reaches after scanning a table's QR: no sign-in,
// the token in the URL is the whole authority, and the auth rate limiter keeps guessing slow.
func (s *Server) mountPublicFnb(r chi.Router) {
	r.Route("/public/fnb/t/{token}", func(r chi.Router) {
		r.Use(s.authRL.middleware)
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Fnb.TableByToken(r.Context(), chi.URLParam(r, "token"))
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.Get("/orders", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Fnb.TableOrders(r.Context(), chi.URLParam(r, "token"))
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.Post("/orders", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Lines []fnbuc.LineInput `json:"lines"`
				Note  string            `json:"note"`
			}
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Fnb.TableCreateOrder(r.Context(), chi.URLParam(r, "token"), in.Lines, in.Note)
			if err != nil {
				fail(w, r, err)
				return
			}
			created(w, out)
		})
		r.Get("/stream", func(w http.ResponseWriter, r *http.Request) {
			events, err := s.Fnb.SubscribeTable(r.Context(), chi.URLParam(r, "token"))
			if err != nil {
				fail(w, r, err)
				return
			}
			streamEvents(w, r, events)
		})
	})
}

// uuidList parses a comma-separated list of ids from a query string.
func uuidList(v string) ([]uuid.UUID, error) {
	var out []uuid.UUID
	for _, part := range strings.Split(v, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		id, err := uuid.Parse(part)
		if err != nil {
			return nil, domain.ErrValidation.With("field", "ids")
		}
		out = append(out, id)
	}
	return out, nil
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

		// ---- live updates for the kitchen, the floor and the counter
		r.With(requireRole(rolesAll...)).Get("/stream", func(w http.ResponseWriter, r *http.Request) {
			streamEvents(w, r, s.Fnb.Subscribe(r.Context(), storeID(r)))
		})

		// ---- the room: zones and tables, drawn by every screen, edited by managers
		r.With(requireRole(rolesAll...)).Get("/floor", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Fnb.Floor(r.Context(), storeID(r), queryStr(r, "all") != "1")
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesManage...)).Put("/floor/zones", func(w http.ResponseWriter, r *http.Request) {
			var in domain.FloorZone
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Fnb.SaveZone(r.Context(), storeID(r), in)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesManage...)).Put("/floor/tables", func(w http.ResponseWriter, r *http.Request) {
			var in domain.FloorTable
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Fnb.SaveTable(r.Context(), storeID(r), in)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})

		// ---- checkout: the orders become a bill in the sales module
		r.With(requireRole(rolesSell...)).Get("/checkout/quote", func(w http.ResponseWriter, r *http.Request) {
			ids, err := uuidList(queryStr(r, "ids"))
			if err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Fnb.Quote(r.Context(), storeID(r), ids)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesSell...)).Post("/checkout", func(w http.ResponseWriter, r *http.Request) {
			var in fnbuc.CheckoutInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Fnb.Checkout(r.Context(), storeID(r), fnbActor(r), in)
			if err != nil {
				fail(w, r, err)
				return
			}
			created(w, out)
		})

		// ---- tables: the QR each one shows
		r.With(requireRole(rolesSell...)).Get("/tables", func(w http.ResponseWriter, r *http.Request) {
			var ensure []string
			if v := queryStr(r, "ensure"); v != "" {
				ensure = strings.Split(v, ",")
			}
			out, err := s.Fnb.TableTokens(r.Context(), storeID(r), ensure)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesManage...)).Post("/tables/{code}/rotate", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Fnb.RotateTableToken(r.Context(), storeID(r), chi.URLParam(r, "code"))
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
