package httptransport

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
	"github.com/svdev/pos/internal/usecase/inventoryuc"
)

// InventoryService is implemented by inventoryuc.Service.
type InventoryService interface {
	ListMovements(ctx context.Context, storeID uuid.UUID, f postgres.MovementFilter) ([]postgres.StockMove, int64, error)
	Valuation(ctx context.Context, storeID uuid.UUID) (domain.Valuation, error)
	PostReceipt(ctx context.Context, actor inventoryuc.Actor, storeID uuid.UUID, in inventoryuc.ReceiptInput) (*domain.PurchaseReceipt, error)
	ListReceipts(ctx context.Context, storeID uuid.UUID, f postgres.ReceiptFilter) ([]domain.PurchaseReceipt, int64, error)
	GetReceipt(ctx context.Context, storeID, id uuid.UUID) (*domain.PurchaseReceipt, error)
	CancelReceipt(ctx context.Context, actor inventoryuc.Actor, storeID, id uuid.UUID, reason string) (*domain.PurchaseReceipt, error)
	PostAdjustment(ctx context.Context, actor inventoryuc.Actor, storeID uuid.UUID, in inventoryuc.AdjustmentInput) (*domain.StockAdjustment, error)
	ListAdjustments(ctx context.Context, storeID uuid.UUID, limit, offset int) ([]domain.StockAdjustment, int64, error)
	GetAdjustment(ctx context.Context, storeID, id uuid.UUID) (*domain.StockAdjustment, error)
	CreateStockTake(ctx context.Context, actor inventoryuc.Actor, storeID uuid.UUID, in inventoryuc.StockTakeInput) (*inventoryuc.StockTakeView, error)
	UpsertCounts(ctx context.Context, actor inventoryuc.Actor, storeID, id uuid.UUID, lines []inventoryuc.CountInput) (*inventoryuc.StockTakeView, error)
	FinalizeStockTake(ctx context.Context, actor inventoryuc.Actor, storeID, id uuid.UUID) (*inventoryuc.StockTakeView, error)
	ListStockTakes(ctx context.Context, storeID uuid.UUID, limit, offset int) ([]domain.StockTake, int64, error)
	GetStockTake(ctx context.Context, storeID, id uuid.UUID) (*inventoryuc.StockTakeView, error)
}

func inventoryActor(r *http.Request) inventoryuc.Actor { return inventoryuc.Actor(actorOf(r)) }

func (s *Server) mountInventory(r chi.Router) {
	read := requireRole(rolesAll...)
	manage := requireRole(rolesManage...)

	r.Route("/inventory", func(r chi.Router) {
		r.With(read).Get("/movements", func(w http.ResponseWriter, r *http.Request) {
			page, size := paging(r)
			f := postgres.MovementFilter{Type: queryStr(r, "type"), Limit: size, Offset: (page - 1) * size}
			var err error
			if f.ProductID, err = parseQueryUUID(r, "product_id"); err != nil {
				fail(w, r, err)
				return
			}
			if f.From, err = parseQueryTime(r, "from"); err != nil {
				fail(w, r, err)
				return
			}
			if f.To, err = parseQueryTime(r, "to"); err != nil {
				fail(w, r, err)
				return
			}
			items, total, err := s.Inventory.ListMovements(r.Context(), storeID(r), f)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, Page[postgres.StockMove]{Items: items, Total: total, Page: page, PageSize: size})
		})
		r.With(read).Get("/valuation", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Inventory.Valuation(r.Context(), storeID(r))
			respond(w, r, out, err)
		})

		// ---- receipts ----
		r.Route("/receipts", func(r chi.Router) {
			r.Use(manage)
			r.Get("/", func(w http.ResponseWriter, r *http.Request) {
				page, size := paging(r)
				f := postgres.ReceiptFilter{Limit: size, Offset: (page - 1) * size}
				var err error
				if f.From, err = parseQueryTime(r, "from"); err != nil {
					fail(w, r, err)
					return
				}
				if f.To, err = parseQueryTime(r, "to"); err != nil {
					fail(w, r, err)
					return
				}
				if f.SupplierID, err = parseQueryUUID(r, "supplier_id"); err != nil {
					fail(w, r, err)
					return
				}
				items, total, err := s.Inventory.ListReceipts(r.Context(), storeID(r), f)
				if err != nil {
					fail(w, r, err)
					return
				}
				ok(w, Page[domain.PurchaseReceipt]{Items: items, Total: total, Page: page, PageSize: size})
			})
			r.Post("/", func(w http.ResponseWriter, r *http.Request) {
				var in inventoryuc.ReceiptInput
				if err := decode(r, &in); err != nil {
					fail(w, r, err)
					return
				}
				out, err := s.Inventory.PostReceipt(r.Context(), inventoryActor(r), storeID(r), in)
				respondCreated(w, r, out, err)
			})
			r.Get("/{id}", func(w http.ResponseWriter, r *http.Request) {
				id, err := uuidParam(r, "id")
				if err != nil {
					fail(w, r, err)
					return
				}
				out, err := s.Inventory.GetReceipt(r.Context(), storeID(r), id)
				respond(w, r, out, err)
			})
			r.Post("/{id}/cancel", func(w http.ResponseWriter, r *http.Request) {
				id, err := uuidParam(r, "id")
				if err != nil {
					fail(w, r, err)
					return
				}
				var in struct {
					Reason string `json:"reason"`
				}
				if r.ContentLength != 0 {
					if err := decode(r, &in); err != nil {
						fail(w, r, err)
						return
					}
				}
				out, err := s.Inventory.CancelReceipt(r.Context(), inventoryActor(r), storeID(r), id, in.Reason)
				respond(w, r, out, err)
			})
		})

		// ---- adjustments ----
		r.Route("/adjustments", func(r chi.Router) {
			r.Use(manage)
			r.Get("/", func(w http.ResponseWriter, r *http.Request) {
				page, size := paging(r)
				items, total, err := s.Inventory.ListAdjustments(r.Context(), storeID(r), size, (page-1)*size)
				if err != nil {
					fail(w, r, err)
					return
				}
				ok(w, Page[domain.StockAdjustment]{Items: items, Total: total, Page: page, PageSize: size})
			})
			r.Post("/", func(w http.ResponseWriter, r *http.Request) {
				var in inventoryuc.AdjustmentInput
				if err := decode(r, &in); err != nil {
					fail(w, r, err)
					return
				}
				out, err := s.Inventory.PostAdjustment(r.Context(), inventoryActor(r), storeID(r), in)
				respondCreated(w, r, out, err)
			})
			r.Get("/{id}", func(w http.ResponseWriter, r *http.Request) {
				id, err := uuidParam(r, "id")
				if err != nil {
					fail(w, r, err)
					return
				}
				out, err := s.Inventory.GetAdjustment(r.Context(), storeID(r), id)
				respond(w, r, out, err)
			})
		})

		// ---- stock takes ----
		r.Route("/stock-takes", func(r chi.Router) {
			r.Use(manage)
			r.Get("/", func(w http.ResponseWriter, r *http.Request) {
				page, size := paging(r)
				items, total, err := s.Inventory.ListStockTakes(r.Context(), storeID(r), size, (page-1)*size)
				if err != nil {
					fail(w, r, err)
					return
				}
				ok(w, Page[domain.StockTake]{Items: items, Total: total, Page: page, PageSize: size})
			})
			r.Post("/", func(w http.ResponseWriter, r *http.Request) {
				var in inventoryuc.StockTakeInput
				if r.ContentLength != 0 {
					if err := decode(r, &in); err != nil {
						fail(w, r, err)
						return
					}
				}
				out, err := s.Inventory.CreateStockTake(r.Context(), inventoryActor(r), storeID(r), in)
				respondCreated(w, r, out, err)
			})
			r.Get("/{id}", func(w http.ResponseWriter, r *http.Request) {
				id, err := uuidParam(r, "id")
				if err != nil {
					fail(w, r, err)
					return
				}
				out, err := s.Inventory.GetStockTake(r.Context(), storeID(r), id)
				respond(w, r, out, err)
			})
			r.Put("/{id}/lines", func(w http.ResponseWriter, r *http.Request) {
				id, err := uuidParam(r, "id")
				if err != nil {
					fail(w, r, err)
					return
				}
				var lines []inventoryuc.CountInput
				if err := decode(r, &lines); err != nil {
					fail(w, r, err)
					return
				}
				out, err := s.Inventory.UpsertCounts(r.Context(), inventoryActor(r), storeID(r), id, lines)
				respond(w, r, out, err)
			})
			r.Post("/{id}/finalize", func(w http.ResponseWriter, r *http.Request) {
				id, err := uuidParam(r, "id")
				if err != nil {
					fail(w, r, err)
					return
				}
				out, err := s.Inventory.FinalizeStockTake(r.Context(), inventoryActor(r), storeID(r), id)
				respond(w, r, out, err)
			})
		})
	})
}
