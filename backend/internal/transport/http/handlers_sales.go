package httptransport

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
	"github.com/svdev/pos/internal/usecase/salesuc"
)

type SalesService interface {
	Quote(ctx context.Context, storeID uuid.UUID, in salesuc.CreateSaleInput) (*salesuc.Totals, []salesuc.CartLine, error)
	Create(ctx context.Context, storeID uuid.UUID, actor salesuc.Actor, in salesuc.CreateSaleInput) (*domain.Sale, error)
	Get(ctx context.Context, storeID, id uuid.UUID) (*domain.Sale, error)
	GetByDocNo(ctx context.Context, storeID uuid.UUID, docNo string) (*domain.Sale, error)
	List(ctx context.Context, storeID uuid.UUID, f postgres.SaleFilter) ([]domain.Sale, int64, error)
	Summary(ctx context.Context, storeID uuid.UUID, from, to time.Time, shiftID *uuid.UUID) (*postgres.DailySummary, error)
	Cancel(ctx context.Context, storeID uuid.UUID, actor salesuc.Actor, id uuid.UUID, reason string) (*domain.Sale, error)
	Return(ctx context.Context, storeID uuid.UUID, actor salesuc.Actor, saleID uuid.UUID, in salesuc.ReturnInput) (*domain.SaleReturn, error)
	ListReturns(ctx context.Context, storeID uuid.UUID, saleID *uuid.UUID, limit, offset int) ([]domain.SaleReturn, int64, error)
	Receipt(ctx context.Context, storeID, saleID uuid.UUID) (*salesuc.Receipt, error)
	Hold(ctx context.Context, storeID uuid.UUID, actor salesuc.Actor, label string, memberID *uuid.UUID, cart any) (*domain.HeldBill, error)
	ListHeld(ctx context.Context, storeID uuid.UUID) ([]domain.HeldBill, error)
	DeleteHeld(ctx context.Context, storeID, id uuid.UUID) error
	OpenShift(ctx context.Context, storeID uuid.UUID, actor salesuc.Actor, terminal string, openingFloat decimal.Decimal, note string) (*domain.Shift, error)
	CurrentShift(ctx context.Context, storeID uuid.UUID, actor salesuc.Actor) (*domain.Shift, error)
	CloseShift(ctx context.Context, storeID uuid.UUID, actor salesuc.Actor, shiftID uuid.UUID, counted decimal.Decimal, note string) (*salesuc.CloseShiftResult, error)
	ShiftReport(ctx context.Context, storeID, shiftID uuid.UUID) (*salesuc.CloseShiftResult, error)
	ListShifts(ctx context.Context, storeID uuid.UUID, limit, offset int) ([]domain.Shift, int64, error)
	DrawerOp(ctx context.Context, storeID uuid.UUID, actor salesuc.Actor, reason string, amount decimal.Decimal, note string) error
	DrawerLogs(ctx context.Context, storeID uuid.UUID, from, to time.Time, limit, offset int) ([]postgres.DrawerLog, int64, error)
}

func salesActor(r *http.Request) salesuc.Actor {
	p := PrincipalFrom(r.Context())
	return salesuc.Actor{UserID: p.UserID, Name: p.Name, IP: r.RemoteAddr}
}

// dateRange parses ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive) in Bangkok time; defaults to today.
func dateRange(r *http.Request) (time.Time, time.Time) {
	loc, _ := time.LoadLocation("Asia/Bangkok")
	if loc == nil {
		loc = time.FixedZone("ICT", 7*3600)
	}
	now := time.Now().In(loc)
	from := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	to := from.AddDate(0, 0, 1)
	if v := queryStr(r, "from"); v != "" {
		if t, err := time.ParseInLocation("2006-01-02", v, loc); err == nil {
			from = t
		}
	}
	if v := queryStr(r, "to"); v != "" {
		if t, err := time.ParseInLocation("2006-01-02", v, loc); err == nil {
			to = t.AddDate(0, 0, 1)
		}
	} else if queryStr(r, "from") != "" {
		to = from.AddDate(0, 0, 1)
	}
	return from, to
}

func optUUID(s string) *uuid.UUID {
	if s == "" {
		return nil
	}
	id, err := uuid.Parse(s)
	if err != nil {
		return nil
	}
	return &id
}

func (s *Server) mountSales(r chi.Router) {
	r.Route("/sales", func(r chi.Router) {
		r.With(requireRole(rolesSell...)).Post("/quote", func(w http.ResponseWriter, r *http.Request) {
			var in salesuc.CreateSaleInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			tot, lines, err := s.Sales.Quote(r.Context(), storeID(r), in)
			if err != nil {
				fail(w, r, err)
				return
			}
			type ql struct {
				ProductID   uuid.UUID       `json:"product_id"`
				Description string          `json:"description"`
				Qty         decimal.Decimal `json:"qty"`
				UnitPrice   decimal.Decimal `json:"unit_price"`
				Discount    decimal.Decimal `json:"discount"`
				PromoDisc   decimal.Decimal `json:"promo_discount"`
				LineTotal   decimal.Decimal `json:"line_total"`
				IsFree      bool            `json:"is_free"`
			}
			out := make([]ql, len(lines))
			for i, l := range lines {
				out[i] = ql{l.ProductID, l.Description, l.Qty, l.UnitPrice, l.Discount, l.PromoDisc, l.LineTotal(), l.IsFree}
			}
			ok(w, map[string]any{"gross": tot.Gross, "line_discount": tot.LineDiscount, "bill_discount": tot.BillDiscount, "net": tot.Net, "lines": out})
		})
		r.With(requireRole(rolesSell...)).Post("/", func(w http.ResponseWriter, r *http.Request) {
			var in salesuc.CreateSaleInput
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			if in.SoldAt != nil && !PrincipalFrom(r.Context()).HasRole(rolesManage...) {
				in.SoldAt = nil
			}
			out, err := s.Sales.Create(r.Context(), storeID(r), salesActor(r), in)
			if err != nil {
				fail(w, r, err)
				return
			}
			created(w, out)
		})
		r.With(requireRole(rolesAll...)).Get("/", func(w http.ResponseWriter, r *http.Request) {
			page, size := paging(r)
			from, to := dateRange(r)
			f := postgres.SaleFilter{From: &from, To: &to, MemberID: optUUID(queryStr(r, "member_id")), CashierID: optUUID(queryStr(r, "cashier_id")),
				ShiftID: optUUID(queryStr(r, "shift_id")), Status: queryStr(r, "status"), ARStatus: queryStr(r, "ar_status"), DocNo: queryStr(r, "doc_no"), Limit: size, Offset: (page - 1) * size}
			if queryStr(r, "all") == "1" {
				f.From, f.To = nil, nil
			}
			items, total, err := s.Sales.List(r.Context(), storeID(r), f)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, Page[domain.Sale]{Items: items, Total: total, Page: page, PageSize: size})
		})
		r.With(requireRole(rolesAll...)).Get("/summary", func(w http.ResponseWriter, r *http.Request) {
			from, to := dateRange(r)
			out, err := s.Sales.Summary(r.Context(), storeID(r), from, to, optUUID(queryStr(r, "shift_id")))
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesAll...)).Get("/by-doc/{docNo}", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Sales.GetByDocNo(r.Context(), storeID(r), chi.URLParam(r, "docNo"))
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesAll...)).Get("/returns", func(w http.ResponseWriter, r *http.Request) {
			page, size := paging(r)
			items, total, err := s.Sales.ListReturns(r.Context(), storeID(r), optUUID(queryStr(r, "sale_id")), size, (page-1)*size)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, Page[domain.SaleReturn]{Items: items, Total: total, Page: page, PageSize: size})
		})
		r.Route("/{id}", func(r chi.Router) {
			r.With(requireRole(rolesAll...)).Get("/", func(w http.ResponseWriter, r *http.Request) {
				id, err := uuidParam(r, "id")
				if err != nil {
					fail(w, r, err)
					return
				}
				out, err := s.Sales.Get(r.Context(), storeID(r), id)
				if err != nil {
					fail(w, r, err)
					return
				}
				ok(w, out)
			})
			r.With(requireRole(rolesAll...)).Get("/receipt", func(w http.ResponseWriter, r *http.Request) {
				id, err := uuidParam(r, "id")
				if err != nil {
					fail(w, r, err)
					return
				}
				out, err := s.Sales.Receipt(r.Context(), storeID(r), id)
				if err != nil {
					fail(w, r, err)
					return
				}
				ok(w, out)
			})
			r.With(requireRole(rolesManage...)).Post("/cancel", func(w http.ResponseWriter, r *http.Request) {
				id, err := uuidParam(r, "id")
				if err != nil {
					fail(w, r, err)
					return
				}
				var in struct {
					Reason string `json:"reason"`
				}
				_ = decode(r, &in)
				out, err := s.Sales.Cancel(r.Context(), storeID(r), salesActor(r), id, in.Reason)
				if err != nil {
					fail(w, r, err)
					return
				}
				ok(w, out)
			})
			r.With(requireRole(rolesManage...)).Post("/returns", func(w http.ResponseWriter, r *http.Request) {
				id, err := uuidParam(r, "id")
				if err != nil {
					fail(w, r, err)
					return
				}
				var in salesuc.ReturnInput
				if err := decode(r, &in); err != nil {
					fail(w, r, err)
					return
				}
				out, err := s.Sales.Return(r.Context(), storeID(r), salesActor(r), id, in)
				if err != nil {
					fail(w, r, err)
					return
				}
				created(w, out)
			})
		})
	})

	r.Route("/held-bills", func(r chi.Router) {
		r.Use(requireRole(rolesSell...))
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Sales.ListHeld(r.Context(), storeID(r))
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.Post("/", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Label    string     `json:"label"`
				MemberID *uuid.UUID `json:"member_id"`
				Cart     any        `json:"cart"`
			}
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Sales.Hold(r.Context(), storeID(r), salesActor(r), in.Label, in.MemberID, in.Cart)
			if err != nil {
				fail(w, r, err)
				return
			}
			created(w, out)
		})
		r.Delete("/{id}", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			if err := s.Sales.DeleteHeld(r.Context(), storeID(r), id); err != nil {
				fail(w, r, err)
				return
			}
			noContent(w)
		})
	})

	r.Route("/shifts", func(r chi.Router) {
		r.With(requireRole(rolesSell...)).Post("/open", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Terminal     string          `json:"terminal"`
				OpeningFloat decimal.Decimal `json:"opening_float"`
				Note         string          `json:"note"`
			}
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Sales.OpenShift(r.Context(), storeID(r), salesActor(r), in.Terminal, in.OpeningFloat, in.Note)
			if err != nil {
				fail(w, r, err)
				return
			}
			created(w, out)
		})
		r.With(requireRole(rolesSell...)).Get("/current", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Sales.CurrentShift(r.Context(), storeID(r), salesActor(r))
			if err != nil {
				fail(w, r, err)
				return
			}
			if out == nil {
				ok(w, map[string]any{"shift": nil})
				return
			}
			ok(w, map[string]any{"shift": out})
		})
		r.With(requireRole(rolesAll...)).Get("/", func(w http.ResponseWriter, r *http.Request) {
			page, size := paging(r)
			items, total, err := s.Sales.ListShifts(r.Context(), storeID(r), size, (page-1)*size)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, Page[domain.Shift]{Items: items, Total: total, Page: page, PageSize: size})
		})
		r.With(requireRole(rolesSell...)).Post("/{id}/close", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			var in struct {
				CountedCash decimal.Decimal `json:"counted_cash"`
				Note        string          `json:"note"`
			}
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Sales.CloseShift(r.Context(), storeID(r), salesActor(r), id, in.CountedCash, in.Note)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesAll...)).Get("/{id}", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Sales.ShiftReport(r.Context(), storeID(r), id)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
	})

	r.Route("/drawer", func(r chi.Router) {
		r.With(requireRole(rolesSell...)).Post("/", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Reason string          `json:"reason"`
				Amount decimal.Decimal `json:"amount"`
				Note   string          `json:"note"`
			}
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			if in.Reason == "" {
				in.Reason = "no_sale"
			}
			if err := s.Sales.DrawerOp(r.Context(), storeID(r), salesActor(r), in.Reason, in.Amount, in.Note); err != nil {
				fail(w, r, err)
				return
			}
			noContent(w)
		})
		r.With(requireRole(rolesManage...)).Get("/logs", func(w http.ResponseWriter, r *http.Request) {
			page, size := paging(r)
			from, to := dateRange(r)
			items, total, err := s.Sales.DrawerLogs(r.Context(), storeID(r), from, to, size, (page-1)*size)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, Page[postgres.DrawerLog]{Items: items, Total: total, Page: page, PageSize: size})
		})
	})
}
