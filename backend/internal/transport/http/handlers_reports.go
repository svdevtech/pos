package httptransport

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/svdev/pos/internal/repository/postgres"
	"github.com/svdev/pos/internal/usecase/reportuc"
)

// ReportService is implemented by the reports use case.
type ReportService interface {
	DailySales(ctx context.Context, storeID uuid.UUID, rg reportuc.Range) (*reportuc.DailySales, error)
	SalesByProduct(ctx context.Context, storeID uuid.UUID, q reportuc.ProductSalesQuery) (*reportuc.ProductSales, error)
	SalesByCategory(ctx context.Context, storeID uuid.UUID, rg reportuc.Range) (*reportuc.CategorySales, error)
	SalesByCashier(ctx context.Context, storeID uuid.UUID, rg reportuc.Range) (*reportuc.CashierSales, error)
	SalesByHour(ctx context.Context, storeID uuid.UUID, rg reportuc.Range) (*reportuc.HourlySales, error)
	ProductMovement(ctx context.Context, storeID, productID uuid.UUID, rg reportuc.Range) (*reportuc.ProductMovement, error)
	InventoryStatus(ctx context.Context, storeID uuid.UUID, f postgres.InventoryFilter) (*reportuc.InventoryStatus, error)
	DeadStock(ctx context.Context, storeID uuid.UUID, days int, categoryID *uuid.UUID) (*reportuc.DeadStock, error)
	ARAging(ctx context.Context, storeID uuid.UUID, asOf string, asOfStart time.Time) (*reportuc.ARAging, error)
	ARStatement(ctx context.Context, storeID, memberID uuid.UUID, rg reportuc.Range) (*reportuc.ARStatement, error)
	SupplierPurchases(ctx context.Context, storeID uuid.UUID, rg reportuc.Range) (*reportuc.SupplierPurchases, error)
	Purchases(ctx context.Context, storeID uuid.UUID, rg reportuc.Range, supplierID *uuid.UUID) (*reportuc.Purchases, error)
	ExpensesSummary(ctx context.Context, storeID uuid.UUID, rg reportuc.Range) (*reportuc.ExpensesSummary, error)
	ProfitLoss(ctx context.Context, storeID uuid.UUID, rg reportuc.Range) (*reportuc.ProfitLoss, error)
	MonthlyChart(ctx context.Context, storeID uuid.UUID, year int) (*reportuc.MonthlyChart, error)
	RefreshMonthlyChart(ctx context.Context) error
	Dashboard(ctx context.Context, storeID uuid.UUID) (*reportuc.Dashboard, error)
	ShiftReport(ctx context.Context, storeID, shiftID uuid.UUID) (*reportuc.ShiftReport, error)
}

// reportRange parses ?from&to&group for report endpoints.
func reportRange(r *http.Request) (reportuc.Range, error) {
	return reportuc.ParseRange(queryStr(r, "from"), queryStr(r, "to"), queryStr(r, "group"), time.Now())
}

// wantsCSV reports whether the client asked for ?format=csv.
func wantsCSV(r *http.Request) bool { return queryStr(r, "format") == "csv" }

// writeCSV streams a report as text/csv with a UTF-8 BOM and an attachment filename <name>-<from>-<to>.csv.
func writeCSV(w http.ResponseWriter, name, from, to string, t reportuc.Tabular) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+"-"+from+"-"+to+`.csv"`)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(reportuc.CSV(t))
}

// report writes v as JSON, or as CSV when ?format=csv.
func report(w http.ResponseWriter, r *http.Request, name, from, to string, v reportuc.Tabular) {
	if wantsCSV(r) {
		writeCSV(w, name, from, to, v)
		return
	}
	ok(w, v)
}

func flag(r *http.Request, name string) bool {
	switch queryStr(r, name) {
	case "1", "true", "yes":
		return true
	}
	return false
}

func (s *Server) mountReports(r chi.Router) {
	r.Route("/reports", func(r chi.Router) {
		r.Use(requireRole(rolesAll...))

		// ranged reports: (name, fn) → GET /reports/<name>?from&to&group[&format=csv]
		ranged := func(name string, fn func(ctx context.Context, storeID uuid.UUID, rg reportuc.Range) (reportuc.Tabular, error)) {
			r.Get("/"+name, func(w http.ResponseWriter, r *http.Request) {
				rg, err := reportRange(r)
				if err != nil {
					fail(w, r, err)
					return
				}
				out, err := fn(r.Context(), storeID(r), rg)
				if err != nil {
					fail(w, r, err)
					return
				}
				report(w, r, name, rg.From, rg.To, out)
			})
		}
		ranged("daily-sales", func(ctx context.Context, id uuid.UUID, rg reportuc.Range) (reportuc.Tabular, error) {
			return s.Report.DailySales(ctx, id, rg)
		})
		ranged("sales-by-category", func(ctx context.Context, id uuid.UUID, rg reportuc.Range) (reportuc.Tabular, error) {
			return s.Report.SalesByCategory(ctx, id, rg)
		})
		ranged("sales-by-cashier", func(ctx context.Context, id uuid.UUID, rg reportuc.Range) (reportuc.Tabular, error) {
			return s.Report.SalesByCashier(ctx, id, rg)
		})
		ranged("sales-by-hour", func(ctx context.Context, id uuid.UUID, rg reportuc.Range) (reportuc.Tabular, error) {
			return s.Report.SalesByHour(ctx, id, rg)
		})
		ranged("supplier-purchases", func(ctx context.Context, id uuid.UUID, rg reportuc.Range) (reportuc.Tabular, error) {
			return s.Report.SupplierPurchases(ctx, id, rg)
		})
		ranged("expenses-summary", func(ctx context.Context, id uuid.UUID, rg reportuc.Range) (reportuc.Tabular, error) {
			return s.Report.ExpensesSummary(ctx, id, rg)
		})
		ranged("profit-loss", func(ctx context.Context, id uuid.UUID, rg reportuc.Range) (reportuc.Tabular, error) {
			return s.Report.ProfitLoss(ctx, id, rg)
		})

		r.Get("/sales-by-product", func(w http.ResponseWriter, r *http.Request) {
			rg, err := reportRange(r)
			if err != nil {
				fail(w, r, err)
				return
			}
			q := reportuc.ProductSalesQuery{Range: rg, CategoryID: optUUID(queryStr(r, "category_id")), Limit: queryInt(r, "limit", 200), Sort: queryStr(r, "sort")}
			out, err := s.Report.SalesByProduct(r.Context(), storeID(r), q)
			if err != nil {
				fail(w, r, err)
				return
			}
			report(w, r, "sales-by-product", rg.From, rg.To, out)
		})

		r.Get("/product-movement", func(w http.ResponseWriter, r *http.Request) {
			pid := optUUID(queryStr(r, "product_id"))
			if pid == nil {
				fail(w, r, validation("product_id", "required"))
				return
			}
			rg, err := reportRange(r)
			if err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Report.ProductMovement(r.Context(), storeID(r), *pid, rg)
			if err != nil {
				fail(w, r, err)
				return
			}
			report(w, r, "product-movement", rg.From, rg.To, out)
		})

		r.Get("/inventory-status", func(w http.ResponseWriter, r *http.Request) {
			f := postgres.InventoryFilter{CategoryID: optUUID(queryStr(r, "category_id")), Q: queryStr(r, "q"),
				BelowMin: flag(r, "below_min"), Zero: flag(r, "zero"), Negative: flag(r, "negative")}
			out, err := s.Report.InventoryStatus(r.Context(), storeID(r), f)
			if err != nil {
				fail(w, r, err)
				return
			}
			report(w, r, "inventory-status", out.AsOf, out.AsOf, out)
		})

		r.Get("/dead-stock", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Report.DeadStock(r.Context(), storeID(r), queryInt(r, "days", 90), optUUID(queryStr(r, "category_id")))
			if err != nil {
				fail(w, r, err)
				return
			}
			report(w, r, "dead-stock", out.Since, out.AsOf, out)
		})

		r.Get("/ar-aging", func(w http.ResponseWriter, r *http.Request) {
			asOf, start, err := reportuc.ParseDate(queryStr(r, "as_of"), "as_of", time.Now())
			if err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Report.ARAging(r.Context(), storeID(r), asOf, start)
			if err != nil {
				fail(w, r, err)
				return
			}
			report(w, r, "ar-aging", asOf, asOf, out)
		})

		r.Get("/ar-statement", func(w http.ResponseWriter, r *http.Request) {
			mid := optUUID(queryStr(r, "member_id"))
			if mid == nil {
				fail(w, r, validation("member_id", "required"))
				return
			}
			rg, err := reportRange(r)
			if err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Report.ARStatement(r.Context(), storeID(r), *mid, rg)
			if err != nil {
				fail(w, r, err)
				return
			}
			report(w, r, "ar-statement", rg.From, rg.To, out)
		})

		r.Get("/purchases", func(w http.ResponseWriter, r *http.Request) {
			rg, err := reportRange(r)
			if err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Report.Purchases(r.Context(), storeID(r), rg, optUUID(queryStr(r, "supplier_id")))
			if err != nil {
				fail(w, r, err)
				return
			}
			report(w, r, "purchases", rg.From, rg.To, out)
		})

		r.Get("/monthly-chart", func(w http.ResponseWriter, r *http.Request) {
			year, err := reportuc.ParseYear(queryStr(r, "year"), time.Now())
			if err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Report.MonthlyChart(r.Context(), storeID(r), year)
			if err != nil {
				fail(w, r, err)
				return
			}
			y := strconv.Itoa(year)
			report(w, r, "monthly-chart", y+"-01-01", y+"-12-31", out)
		})
		r.With(requireRole(rolesManage...)).Post("/monthly-chart/refresh", func(w http.ResponseWriter, r *http.Request) {
			if err := s.Report.RefreshMonthlyChart(r.Context()); err != nil {
				fail(w, r, err)
				return
			}
			ok(w, map[string]any{"refreshed_at": time.Now()})
		})

		r.Get("/dashboard", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Report.Dashboard(r.Context(), storeID(r))
			if err != nil {
				fail(w, r, err)
				return
			}
			report(w, r, "dashboard", out.Date, out.Date, out)
		})

		r.Get("/shift/{shiftId}", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "shiftId")
			if err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.Report.ShiftReport(r.Context(), storeID(r), id)
			if err != nil {
				fail(w, r, err)
				return
			}
			from := out.Shift.OpenedAt.In(reportuc.Location).Format("2006-01-02")
			to := time.Now().In(reportuc.Location).Format("2006-01-02")
			if out.Shift.ClosedAt != nil {
				to = out.Shift.ClosedAt.In(reportuc.Location).Format("2006-01-02")
			}
			report(w, r, "shift-"+id.String()[:8], from, to, out)
		})
	})
}
