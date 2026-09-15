package fnbuc

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

// ---------------------------------------------------------------------------
// Reports: menu engineering, ingredient usage and waste, sales by hour, head office
// ---------------------------------------------------------------------------

// MenuLine is one dish over the period with its class in the Kasavana–Smith grid: a star
// sells well and earns well, a plowhorse sells well on a thin margin, a puzzle earns well but
// rarely sells, a dog neither.
type MenuLine struct {
	MenuItemID *uuid.UUID      `json:"menu_item_id,omitempty"`
	Name       string          `json:"name"`
	Category   string          `json:"category"`
	Qty        decimal.Decimal `json:"qty"`
	Orders     int             `json:"orders"`
	Revenue    decimal.Decimal `json:"revenue"`
	Cost       decimal.Decimal `json:"cost"`
	Margin     decimal.Decimal `json:"margin"`
	MarginPct  decimal.Decimal `json:"margin_pct"`
	UnitMargin decimal.Decimal `json:"unit_margin"`
	SharePct   decimal.Decimal `json:"share_pct"`
	Class      string          `json:"class"` // star | plowhorse | puzzle | dog
}

type MenuReport struct {
	From     string          `json:"from"`
	To       string          `json:"to"`
	Lines    []MenuLine      `json:"lines"`
	Qty      decimal.Decimal `json:"qty"`
	Revenue  decimal.Decimal `json:"revenue"`
	Cost     decimal.Decimal `json:"cost"`
	Margin   decimal.Decimal `json:"margin"`
	AvgShare decimal.Decimal `json:"avg_share_pct"`
	AvgUnit  decimal.Decimal `json:"avg_unit_margin"`
}

func (r *MenuReport) CSVTable() ([]string, [][]string) {
	rows := make([][]string, 0, len(r.Lines))
	for _, l := range r.Lines {
		rows = append(rows, []string{l.Name, l.Category, l.Qty.String(), fmt.Sprint(l.Orders), l.Revenue.StringFixed(2), l.Cost.StringFixed(2), l.Margin.StringFixed(2), l.MarginPct.StringFixed(1), l.SharePct.StringFixed(1), l.Class})
	}
	return []string{"item", "category", "qty", "orders", "revenue", "cost", "margin", "margin_pct", "share_pct", "class"}, rows
}

func pctOf(part, whole decimal.Decimal) decimal.Decimal {
	if whole.IsZero() {
		return decimal.Zero
	}
	return part.Mul(decimal.NewFromInt(100)).Div(whole).Round(1)
}

func (s *Service) MenuReport(ctx context.Context, storeID uuid.UUID, from, to time.Time) (*MenuReport, error) {
	out := &MenuReport{From: from.Format("2006-01-02"), To: to.AddDate(0, 0, -1).Format("2006-01-02"), Lines: []MenuLine{}}
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		rows, err := s.repo.MenuSales(ctx, storeID, from, to)
		if err != nil {
			return err
		}
		for _, r := range rows {
			l := MenuLine{MenuItemID: r.MenuItemID, Name: r.Name, Category: r.Category, Qty: r.Qty, Orders: r.Orders, Revenue: r.Revenue, Cost: r.Cost, Margin: domain.Money(r.Revenue.Sub(r.Cost))}
			l.MarginPct = pctOf(l.Margin, l.Revenue)
			if r.Qty.IsPositive() {
				l.UnitMargin = domain.Money(l.Margin.Div(r.Qty))
			}
			out.Lines = append(out.Lines, l)
			out.Qty = out.Qty.Add(r.Qty)
			out.Revenue = out.Revenue.Add(r.Revenue)
			out.Cost = out.Cost.Add(r.Cost)
		}
		out.Margin = domain.Money(out.Revenue.Sub(out.Cost))
		n := int64(len(out.Lines))
		if n == 0 {
			return nil
		}
		// popularity threshold: 70 % of an even share (Kasavana & Smith); margin threshold: the
		// average unit margin across the dishes sold
		out.AvgShare = decimal.NewFromInt(100).Div(decimal.NewFromInt(n)).Mul(decimal.NewFromFloat(0.7)).Round(1)
		if out.Qty.IsPositive() {
			out.AvgUnit = domain.Money(out.Margin.Div(out.Qty))
		}
		for i := range out.Lines {
			l := &out.Lines[i]
			l.SharePct = pctOf(l.Qty, out.Qty)
			popular := l.SharePct.GreaterThanOrEqual(out.AvgShare)
			profitable := l.UnitMargin.GreaterThanOrEqual(out.AvgUnit)
			switch {
			case popular && profitable:
				l.Class = "star"
			case popular:
				l.Class = "plowhorse"
			case profitable:
				l.Class = "puzzle"
			default:
				l.Class = "dog"
			}
		}
		return nil
	})
	return out, err
}

type IngredientLine struct {
	ProductID uuid.UUID       `json:"product_id"`
	Name      string          `json:"name"`
	Unit      string          `json:"unit"`
	Used      decimal.Decimal `json:"used"`
	UsedCost  decimal.Decimal `json:"used_cost"`
	Waste     decimal.Decimal `json:"waste"`
	WasteCost decimal.Decimal `json:"waste_cost"`
	OnHand    decimal.Decimal `json:"on_hand"`
}

type IngredientReport struct {
	From      string           `json:"from"`
	To        string           `json:"to"`
	Lines     []IngredientLine `json:"lines"`
	UsedCost  decimal.Decimal  `json:"used_cost"`
	WasteCost decimal.Decimal  `json:"waste_cost"`
}

func (r *IngredientReport) CSVTable() ([]string, [][]string) {
	rows := make([][]string, 0, len(r.Lines))
	for _, l := range r.Lines {
		rows = append(rows, []string{l.Name, l.Unit, l.Used.String(), l.UsedCost.StringFixed(2), l.Waste.String(), l.WasteCost.StringFixed(2), l.OnHand.String()})
	}
	return []string{"ingredient", "unit", "used", "used_cost", "waste", "waste_cost", "on_hand"}, rows
}

func (s *Service) IngredientReport(ctx context.Context, storeID uuid.UUID, from, to time.Time) (*IngredientReport, error) {
	out := &IngredientReport{From: from.Format("2006-01-02"), To: to.AddDate(0, 0, -1).Format("2006-01-02"), Lines: []IngredientLine{}}
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		rows, err := s.repo.IngredientUsage(ctx, storeID, from, to)
		if err != nil {
			return err
		}
		for _, r := range rows {
			out.Lines = append(out.Lines, IngredientLine{ProductID: r.ProductID, Name: r.Name, Unit: r.Unit, Used: r.Used, UsedCost: domain.Money(r.UsedCost), Waste: r.Waste, WasteCost: domain.Money(r.WasteCost), OnHand: r.OnHand})
			out.UsedCost = out.UsedCost.Add(r.UsedCost)
			out.WasteCost = out.WasteCost.Add(r.WasteCost)
		}
		out.UsedCost, out.WasteCost = domain.Money(out.UsedCost), domain.Money(out.WasteCost)
		return nil
	})
	return out, err
}

type HourLine struct {
	Hour    int             `json:"hour"`
	Orders  int             `json:"orders"`
	Items   decimal.Decimal `json:"items"`
	Revenue decimal.Decimal `json:"revenue"`
}

type HoursReport struct {
	From  string     `json:"from"`
	To    string     `json:"to"`
	Days  int        `json:"days"`
	Lines []HourLine `json:"lines"`
}

func (r *HoursReport) CSVTable() ([]string, [][]string) {
	rows := make([][]string, 0, len(r.Lines))
	for _, l := range r.Lines {
		rows = append(rows, []string{fmt.Sprintf("%02d:00", l.Hour), fmt.Sprint(l.Orders), l.Items.String(), l.Revenue.StringFixed(2)})
	}
	return []string{"hour", "orders", "items", "revenue"}, rows
}

func (s *Service) HoursReport(ctx context.Context, storeID uuid.UUID, from, to time.Time) (*HoursReport, error) {
	out := &HoursReport{From: from.Format("2006-01-02"), To: to.AddDate(0, 0, -1).Format("2006-01-02"), Days: int(to.Sub(from).Hours()/24 + 0.5), Lines: []HourLine{}}
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		rows, err := s.repo.HourlySales(ctx, storeID, from, to)
		if err != nil {
			return err
		}
		for _, r := range rows {
			out.Lines = append(out.Lines, HourLine{Hour: r.Hour, Orders: r.Orders, Items: r.Items, Revenue: r.Revenue})
		}
		return nil
	})
	return out, err
}

// StoreSummary is one store on the head-office screen.
type StoreSummary struct {
	StoreID    uuid.UUID       `json:"store_id"`
	Code       string          `json:"code"`
	Name       string          `json:"name"`
	Kind       string          `json:"kind"`
	Bills      int             `json:"bills"`
	Net        decimal.Decimal `json:"net"`
	OpenOrders int             `json:"open_orders"`
}

type HQReport struct {
	From   string          `json:"from"`
	To     string          `json:"to"`
	Stores []StoreSummary  `json:"stores"`
	Bills  int             `json:"bills"`
	Net    decimal.Decimal `json:"net"`
}

func (r *HQReport) CSVTable() ([]string, [][]string) {
	rows := make([][]string, 0, len(r.Stores))
	for _, l := range r.Stores {
		rows = append(rows, []string{l.Code, l.Name, l.Kind, fmt.Sprint(l.Bills), l.Net.StringFixed(2), fmt.Sprint(l.OpenOrders)})
	}
	return []string{"code", "store", "kind", "bills", "net", "open_orders"}, rows
}

// HQ is every store side by side, for the platform owner; runs with RLS bypassed.
func (s *Service) HQ(ctx context.Context, from, to time.Time) (*HQReport, error) {
	out := &HQReport{From: from.Format("2006-01-02"), To: to.AddDate(0, 0, -1).Format("2006-01-02"), Stores: []StoreSummary{}}
	err := s.db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, _ pgx.Tx) error {
		rows, err := s.repo.StoreSummaries(ctx, from, to)
		if err != nil {
			return err
		}
		for _, r := range rows {
			out.Stores = append(out.Stores, StoreSummary{StoreID: r.StoreID, Code: r.Code, Name: r.Name, Kind: r.Kind, Bills: r.Bills, Net: r.Net, OpenOrders: r.OpenOrders})
			out.Bills += r.Bills
			out.Net = out.Net.Add(r.Net)
		}
		return nil
	})
	return out, err
}
