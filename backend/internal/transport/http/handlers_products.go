package httptransport

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
	"github.com/svdev/pos/internal/usecase/productuc"
)

// ProductService is implemented by productuc.Service.
type ProductService interface {
	ListCategories(ctx context.Context, storeID uuid.UUID) ([]domain.Category, error)
	CreateCategory(ctx context.Context, actor productuc.Actor, storeID uuid.UUID, in productuc.CategoryInput) (*domain.Category, error)
	UpdateCategory(ctx context.Context, actor productuc.Actor, storeID, id uuid.UUID, in productuc.CategoryInput) (*domain.Category, error)
	ListUnits(ctx context.Context, storeID uuid.UUID) ([]domain.Unit, error)
	CreateUnit(ctx context.Context, actor productuc.Actor, storeID uuid.UUID, in productuc.UnitInput) (*domain.Unit, error)
	ListSuppliers(ctx context.Context, storeID uuid.UUID, q string) ([]domain.Supplier, error)
	GetSupplier(ctx context.Context, storeID, id uuid.UUID) (*domain.Supplier, error)
	CreateSupplier(ctx context.Context, actor productuc.Actor, storeID uuid.UUID, in productuc.SupplierInput) (*domain.Supplier, error)
	UpdateSupplier(ctx context.Context, actor productuc.Actor, storeID, id uuid.UUID, in productuc.SupplierInput) (*domain.Supplier, error)
	ListProducts(ctx context.Context, storeID uuid.UUID, f postgres.ProductFilter) ([]domain.ProductView, int64, error)
	GetProduct(ctx context.Context, storeID, id uuid.UUID) (*domain.ProductView, error)
	CreateProduct(ctx context.Context, actor productuc.Actor, storeID uuid.UUID, in productuc.ProductInput) (*domain.ProductView, error)
	UpdateProduct(ctx context.Context, actor productuc.Actor, storeID, id uuid.UUID, in productuc.ProductInput) (*domain.ProductView, error)
	ArchiveProduct(ctx context.Context, actor productuc.Actor, storeID, id uuid.UUID) error
	RestoreProduct(ctx context.Context, actor productuc.Actor, storeID, id uuid.UUID) (*domain.ProductView, error)
	LookupBarcode(ctx context.Context, storeID uuid.UUID, code string) (*domain.BarcodeLookup, error)
	AddBarcode(ctx context.Context, actor productuc.Actor, storeID, productID uuid.UUID, in productuc.BarcodeInput) (*domain.ProductView, error)
	DeleteBarcode(ctx context.Context, actor productuc.Actor, storeID, productID, barcodeID uuid.UUID) error
	SetPrices(ctx context.Context, actor productuc.Actor, storeID, productID uuid.UUID, in productuc.PricesInput) (*domain.ProductView, error)
	LowStock(ctx context.Context, storeID uuid.UUID) ([]domain.ProductView, error)
	Labels(ctx context.Context, storeID uuid.UUID, ids []uuid.UUID, templateCode string, copies int) (*domain.LabelSheet, error)
	ListLabelTemplates(ctx context.Context, storeID uuid.UUID) ([]domain.LabelTemplate, error)
	CreateLabelTemplate(ctx context.Context, actor productuc.Actor, storeID uuid.UUID, in productuc.LabelTemplateInput) (*domain.LabelTemplate, error)
	UpdateLabelTemplate(ctx context.Context, actor productuc.Actor, storeID, id uuid.UUID, in productuc.LabelTemplateInput) (*domain.LabelTemplate, error)
}

func productActor(r *http.Request) productuc.Actor { return productuc.Actor(actorOf(r)) }

// --- query-string helpers shared by the catalogue and inventory handlers ---

func parseQueryUUID(r *http.Request, name string) (*uuid.UUID, error) {
	v := strings.TrimSpace(r.URL.Query().Get(name))
	if v == "" {
		return nil, nil
	}
	id, err := uuid.Parse(v)
	if err != nil {
		return nil, domain.ErrBadRequest.With("reason", "invalid "+name)
	}
	return &id, nil
}

// parseQueryBool returns nil when absent/empty, or when value is "all".
func parseQueryBool(r *http.Request, name string) (*bool, error) {
	v := strings.ToLower(strings.TrimSpace(r.URL.Query().Get(name)))
	if v == "" || v == "all" {
		return nil, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return nil, domain.ErrBadRequest.With("reason", "invalid "+name)
	}
	return &b, nil
}

// parseQueryTime accepts RFC3339 or YYYY-MM-DD (interpreted in Asia/Bangkok, start of day).
func parseQueryTime(r *http.Request, name string) (*time.Time, error) {
	v := strings.TrimSpace(r.URL.Query().Get(name))
	if v == "" {
		return nil, nil
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return &t, nil
	}
	loc, err := time.LoadLocation("Asia/Bangkok")
	if err != nil {
		loc = time.FixedZone("ICT", 7*3600)
	}
	t, err := time.ParseInLocation("2006-01-02", v, loc)
	if err != nil {
		return nil, domain.ErrBadRequest.With("reason", "invalid "+name)
	}
	return &t, nil
}

func parseUUIDList(s string) ([]uuid.UUID, error) {
	out := []uuid.UUID{}
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		id, err := uuid.Parse(part)
		if err != nil {
			return nil, domain.ErrBadRequest.With("reason", "invalid ids")
		}
		out = append(out, id)
	}
	return out, nil
}

// respond writes v (200) or the error.
func respond(w http.ResponseWriter, r *http.Request, v any, err error) {
	if err != nil {
		fail(w, r, err)
		return
	}
	ok(w, v)
}

func respondCreated(w http.ResponseWriter, r *http.Request, v any, err error) {
	if err != nil {
		fail(w, r, err)
		return
	}
	created(w, v)
}

func (s *Server) mountProducts(r chi.Router) {
	read := requireRole(rolesAll...)
	manage := requireRole(rolesManage...)
	sell := requireRole(rolesSell...)

	// ---- categories / units ----
	r.With(read).Get("/categories", func(w http.ResponseWriter, r *http.Request) {
		out, err := s.Product.ListCategories(r.Context(), storeID(r))
		respond(w, r, out, err)
	})
	r.With(manage).Post("/categories", func(w http.ResponseWriter, r *http.Request) {
		var in productuc.CategoryInput
		if err := decode(r, &in); err != nil {
			fail(w, r, err)
			return
		}
		out, err := s.Product.CreateCategory(r.Context(), productActor(r), storeID(r), in)
		respondCreated(w, r, out, err)
	})
	r.With(manage).Patch("/categories/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, err := uuidParam(r, "id")
		if err != nil {
			fail(w, r, err)
			return
		}
		var in productuc.CategoryInput
		if err := decode(r, &in); err != nil {
			fail(w, r, err)
			return
		}
		out, err := s.Product.UpdateCategory(r.Context(), productActor(r), storeID(r), id, in)
		respond(w, r, out, err)
	})
	r.With(read).Get("/units", func(w http.ResponseWriter, r *http.Request) {
		out, err := s.Product.ListUnits(r.Context(), storeID(r))
		respond(w, r, out, err)
	})
	r.With(manage).Post("/units", func(w http.ResponseWriter, r *http.Request) {
		var in productuc.UnitInput
		if err := decode(r, &in); err != nil {
			fail(w, r, err)
			return
		}
		out, err := s.Product.CreateUnit(r.Context(), productActor(r), storeID(r), in)
		respondCreated(w, r, out, err)
	})

	// ---- suppliers ----
	r.Route("/suppliers", func(r chi.Router) {
		r.With(read).Get("/", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Product.ListSuppliers(r.Context(), storeID(r), queryStr(r, "q"))
			respond(w, r, out, err)
		})
		r.With(manage).Post("/", func(w http.ResponseWriter, r *http.Request) {
			var in productuc.SupplierInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Product.CreateSupplier(r.Context(), productActor(r), storeID(r), in)
			respondCreated(w, r, out, err)
		})
		r.With(read).Get("/{id}", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Product.GetSupplier(r.Context(), storeID(r), id)
			respond(w, r, out, err)
		})
		r.With(manage).Patch("/{id}", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			var in productuc.SupplierInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Product.UpdateSupplier(r.Context(), productActor(r), storeID(r), id, in)
			respond(w, r, out, err)
		})
	})

	// ---- products ----
	r.Route("/products", func(r chi.Router) {
		r.With(read).Get("/", func(w http.ResponseWriter, r *http.Request) {
			page, size := paging(r)
			f := postgres.ProductFilter{Q: queryStr(r, "q"), Barcode: queryStr(r, "barcode"), Limit: size, Offset: (page - 1) * size}
			var err error
			if f.CategoryID, err = parseQueryUUID(r, "category_id"); err != nil {
				fail(w, r, err)
				return
			}
			if f.Active, err = parseQueryBool(r, "active"); err != nil {
				fail(w, r, err)
				return
			}
			if f.Archived, err = parseQueryBool(r, "archived"); err != nil {
				fail(w, r, err)
				return
			}
			if f.Archived == nil && strings.ToLower(queryStr(r, "archived")) != "all" {
				notArchived := false // default: hide archived products unless archived=true|all
				f.Archived = &notArchived
			}
			if ls, err := parseQueryBool(r, "low_stock"); err != nil {
				fail(w, r, err)
				return
			} else if ls != nil {
				f.LowStock = *ls
			}
			items, total, err := s.Product.ListProducts(r.Context(), storeID(r), f)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, Page[domain.ProductView]{Items: items, Total: total, Page: page, PageSize: size})
		})
		r.With(manage).Post("/", func(w http.ResponseWriter, r *http.Request) {
			var in productuc.ProductInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Product.CreateProduct(r.Context(), productActor(r), storeID(r), in)
			respondCreated(w, r, out, err)
		})
		r.With(read).Get("/low-stock", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Product.LowStock(r.Context(), storeID(r))
			respond(w, r, out, err)
		})
		r.With(read).Get("/labels", func(w http.ResponseWriter, r *http.Request) {
			ids, err := parseUUIDList(queryStr(r, "ids"))
			if err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Product.Labels(r.Context(), storeID(r), ids, queryStr(r, "template"), queryInt(r, "copies", 1))
			respond(w, r, out, err)
		})
		r.With(sell).Get("/by-barcode/{code}", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Product.LookupBarcode(r.Context(), storeID(r), chi.URLParam(r, "code"))
			respond(w, r, out, err)
		})
		r.With(read).Get("/{id}", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Product.GetProduct(r.Context(), storeID(r), id)
			respond(w, r, out, err)
		})
		r.With(manage).Patch("/{id}", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			var in productuc.ProductInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Product.UpdateProduct(r.Context(), productActor(r), storeID(r), id, in)
			respond(w, r, out, err)
		})
		r.With(manage).Delete("/{id}", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			if err := s.Product.ArchiveProduct(r.Context(), productActor(r), storeID(r), id); err != nil {
				fail(w, r, err)
				return
			}
			noContent(w)
		})
		r.With(manage).Post("/{id}/restore", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Product.RestoreProduct(r.Context(), productActor(r), storeID(r), id)
			respond(w, r, out, err)
		})
		r.With(manage).Post("/{id}/barcodes", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			var in productuc.BarcodeInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Product.AddBarcode(r.Context(), productActor(r), storeID(r), id, in)
			respondCreated(w, r, out, err)
		})
		r.With(manage).Delete("/{id}/barcodes/{barcodeId}", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			bid, err := uuidParam(r, "barcodeId")
			if err != nil {
				fail(w, r, err)
				return
			}
			if err := s.Product.DeleteBarcode(r.Context(), productActor(r), storeID(r), id, bid); err != nil {
				fail(w, r, err)
				return
			}
			noContent(w)
		})
		r.With(manage).Put("/{id}/prices", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			var in productuc.PricesInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Product.SetPrices(r.Context(), productActor(r), storeID(r), id, in)
			respond(w, r, out, err)
		})
	})

	// ---- label templates ----
	r.Route("/label-templates", func(r chi.Router) {
		r.With(read).Get("/", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Product.ListLabelTemplates(r.Context(), storeID(r))
			respond(w, r, out, err)
		})
		r.With(manage).Post("/", func(w http.ResponseWriter, r *http.Request) {
			var in productuc.LabelTemplateInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Product.CreateLabelTemplate(r.Context(), productActor(r), storeID(r), in)
			respondCreated(w, r, out, err)
		})
		r.With(manage).Patch("/{id}", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			var in productuc.LabelTemplateInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Product.UpdateLabelTemplate(r.Context(), productActor(r), storeID(r), id, in)
			respond(w, r, out, err)
		})
	})
}
