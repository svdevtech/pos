// Package reportuc assembles the management reports (sales, inventory, AR, purchases, expenses, P&L,
// dashboard) from read-only aggregate queries and renders them as JSON structs or CSV.
package reportuc

import (
	"bytes"
	"context"
	"encoding/csv"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

type Service struct {
	db     *postgres.DB
	rep    postgres.ReportRepo
	sales  postgres.SaleRepo
	shifts postgres.ShiftRepo
	drawer postgres.DrawerRepo
}

func New(db *postgres.DB) *Service { return &Service{db: db} }

// ---------------------------------------------------------------------------
// Pure helpers: business-day ranges, year parsing, CSV
// ---------------------------------------------------------------------------

const dateLayout = "2006-01-02"

// Location is the store business-day timezone.
var Location = bangkok()

func bangkok() *time.Location {
	if loc, err := time.LoadLocation("Asia/Bangkok"); err == nil {
		return loc
	}
	return time.FixedZone("ICT", 7*3600)
}

// Range is an inclusive business-day range. Start/End are the Bangkok-midnight bounds (End exclusive).
type Range struct {
	From  string    `json:"from"`
	To    string    `json:"to"`
	Group string    `json:"group,omitempty"`
	Start time.Time `json:"-"`
	End   time.Time `json:"-"`
}

// Days is the number of business days covered by the range.
func (r Range) Days() int { return int(r.End.Sub(r.Start).Hours()/24 + 0.5) }

// ParseRange parses ?from&to (YYYY-MM-DD, inclusive) and ?group (day|month, default day).
// Missing bounds default to the other bound, or to today when both are empty.
func ParseRange(from, to, group string, now time.Time) (Range, error) {
	g, err := ParseGroup(group)
	if err != nil {
		return Range{}, err
	}
	today := dayStart(now.In(Location))
	var start, end time.Time
	switch {
	case from == "" && to == "":
		start, end = today, today
	case from == "":
		if end, err = parseDay(to, "to"); err != nil {
			return Range{}, err
		}
		start = end
	case to == "":
		if start, err = parseDay(from, "from"); err != nil {
			return Range{}, err
		}
		end = start
	default:
		if start, err = parseDay(from, "from"); err != nil {
			return Range{}, err
		}
		if end, err = parseDay(to, "to"); err != nil {
			return Range{}, err
		}
	}
	if end.Before(start) {
		return Range{}, domain.ErrValidation.With("field", "to")
	}
	return Range{From: start.Format(dateLayout), To: end.Format(dateLayout), Group: g, Start: start, End: end.AddDate(0, 0, 1)}, nil
}

// ParseGroup validates ?group; empty means day.
func ParseGroup(group string) (string, error) {
	switch group {
	case "", "day":
		return "day", nil
	case "month":
		return "month", nil
	}
	return "", domain.ErrValidation.With("field", "group")
}

// ParseDate parses a single YYYY-MM-DD (default today) and returns it with its Bangkok-midnight start.
func ParseDate(s, field string, now time.Time) (string, time.Time, error) {
	if s == "" {
		d := dayStart(now.In(Location))
		return d.Format(dateLayout), d, nil
	}
	d, err := parseDay(s, field)
	if err != nil {
		return "", time.Time{}, err
	}
	return d.Format(dateLayout), d, nil
}

// ParseYear accepts a Gregorian year or a Buddhist-era year (>= 2500, converted by −543); empty = current year.
func ParseYear(s string, now time.Time) (int, error) {
	if s == "" {
		return now.In(Location).Year(), nil
	}
	y, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return 0, domain.ErrValidation.With("field", "year")
	}
	if y >= 2500 {
		y -= 543
	}
	if y < 1990 || y > 2200 {
		return 0, domain.ErrValidation.With("field", "year")
	}
	return y, nil
}

func parseDay(s, field string) (time.Time, error) {
	t, err := time.ParseInLocation(dateLayout, strings.TrimSpace(s), Location)
	if err != nil {
		return time.Time{}, domain.ErrValidation.With("field", field)
	}
	return t, nil
}

func dayStart(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, Location)
}

// Tabular is implemented by every report so the HTTP layer can stream it as CSV.
type Tabular interface {
	CSVTable() (header []string, rows [][]string)
}

// CSV renders a report as UTF-8 CSV with a BOM (so Excel opens Thai text correctly).
func CSV(t Tabular) []byte {
	header, rows := t.CSVTable()
	return EncodeCSV(header, rows)
}

// EncodeCSV writes header + rows with encoding/csv, prefixed by the UTF-8 BOM.
func EncodeCSV(header []string, rows [][]string) []byte {
	var buf bytes.Buffer
	buf.Write([]byte{0xEF, 0xBB, 0xBF})
	w := csv.NewWriter(&buf)
	w.UseCRLF = true
	if len(header) > 0 {
		_ = w.Write(header)
	}
	for _, r := range rows {
		_ = w.Write(r)
	}
	w.Flush()
	return buf.Bytes()
}

func money(d decimal.Decimal) string { return d.StringFixed(2) }
func qty(d decimal.Decimal) string   { return d.StringFixed(3) }
func ts(t time.Time) string          { return t.In(Location).Format(time.RFC3339) }
func tsp(t *time.Time) string {
	if t == nil {
		return ""
	}
	return ts(*t)
}
func itoa(n int64) string { return strconv.FormatInt(n, 10) }
func uidp(id *uuid.UUID) string {
	if id == nil {
		return ""
	}
	return id.String()
}

// pct returns part/whole*100 rounded to 2 dp (0 when whole is 0).
func pct(part, whole decimal.Decimal) decimal.Decimal {
	if whole.IsZero() {
		return decimal.Zero
	}
	return part.Div(whole).Mul(decimal.NewFromInt(100)).Round(2)
}

// avg returns total/n rounded to 2 dp (0 when n is 0).
func avg(total decimal.Decimal, n int64) decimal.Decimal {
	if n == 0 {
		return decimal.Zero
	}
	return total.Div(decimal.NewFromInt(n)).Round(2)
}

var monthTH = [...]string{"มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"}
var monthEN = [...]string{"January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"}

func (s *Service) read(ctx context.Context, storeID uuid.UUID, fn func(ctx context.Context) error) error {
	return s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error { return fn(ctx) })
}

// ---------------------------------------------------------------------------
// 1. Daily sales
// ---------------------------------------------------------------------------

type DailySales struct {
	Range
	Rows  []postgres.PeriodSalesRow `json:"rows"`
	Total postgres.PeriodSalesRow   `json:"total"`
}

func (s *Service) DailySales(ctx context.Context, storeID uuid.UUID, rg Range) (*DailySales, error) {
	out := &DailySales{Range: rg}
	err := s.read(ctx, storeID, func(ctx context.Context) error {
		var err error
		out.Rows, err = s.rep.PeriodSales(ctx, storeID, rg.Start, rg.End, rg.Group)
		return err
	})
	if err != nil {
		return nil, err
	}
	t := &out.Total
	t.Period = "total"
	for i := range out.Rows {
		r := &out.Rows[i]
		r.Margin = r.Net.Sub(r.Cost)
		r.MarginPct = pct(r.Margin, r.Net)
		t.Bills += r.Bills
		t.Cancelled += r.Cancelled
		t.Gross, t.Discount, t.Net, t.Cost = t.Gross.Add(r.Gross), t.Discount.Add(r.Discount), t.Net.Add(r.Net), t.Cost.Add(r.Cost)
		t.Cash, t.Credit, t.Transfer = t.Cash.Add(r.Cash), t.Credit.Add(r.Credit), t.Transfer.Add(r.Transfer)
		t.Card, t.QR, t.Other = t.Card.Add(r.Card), t.QR.Add(r.QR), t.Other.Add(r.Other)
	}
	t.Margin = t.Net.Sub(t.Cost)
	t.MarginPct = pct(t.Margin, t.Net)
	return out, nil
}

func (d *DailySales) CSVTable() ([]string, [][]string) {
	h := []string{"date", "bills", "gross", "discount", "net", "cancelled", "cash", "credit", "transfer", "card", "qr", "other", "cost", "margin", "margin_pct"}
	rows := make([][]string, 0, len(d.Rows)+1)
	line := func(r postgres.PeriodSalesRow) []string {
		return []string{r.Period, itoa(r.Bills), money(r.Gross), money(r.Discount), money(r.Net), itoa(r.Cancelled), money(r.Cash), money(r.Credit),
			money(r.Transfer), money(r.Card), money(r.QR), money(r.Other), money(r.Cost), money(r.Margin), money(r.MarginPct)}
	}
	for _, r := range d.Rows {
		rows = append(rows, line(r))
	}
	rows = append(rows, line(d.Total))
	return h, rows
}

// ---------------------------------------------------------------------------
// 2. Sales by product
// ---------------------------------------------------------------------------

type ProductSalesQuery struct {
	Range
	CategoryID *uuid.UUID
	Limit      int
	Sort       string // qty | net | margin
}

type ProductSales struct {
	Range
	CategoryID *uuid.UUID                 `json:"category_id,omitempty"`
	Sort       string                     `json:"sort"`
	Limit      int                        `json:"limit"`
	Rows       []postgres.ProductSalesRow `json:"rows"`
	Total      postgres.ProductSalesRow   `json:"total"`
}

func (s *Service) SalesByProduct(ctx context.Context, storeID uuid.UUID, q ProductSalesQuery) (*ProductSales, error) {
	switch q.Sort {
	case "", "net":
		q.Sort = "net"
	case "qty", "margin":
	default:
		return nil, domain.ErrValidation.With("field", "sort")
	}
	if q.Limit <= 0 {
		q.Limit = 200
	}
	if q.Limit > 1000 {
		q.Limit = 1000
	}
	out := &ProductSales{Range: q.Range, CategoryID: q.CategoryID, Sort: q.Sort, Limit: q.Limit}
	err := s.read(ctx, storeID, func(ctx context.Context) error {
		var err error
		out.Rows, err = s.rep.SalesByProduct(ctx, storeID, q.Start, q.End, q.CategoryID, q.Limit, q.Sort)
		return err
	})
	if err != nil {
		return nil, err
	}
	out.Total.Name = "total"
	for _, r := range out.Rows {
		t := &out.Total
		t.Qty, t.Gross, t.Discount, t.Net = t.Qty.Add(r.Qty), t.Gross.Add(r.Gross), t.Discount.Add(r.Discount), t.Net.Add(r.Net)
		t.Cost, t.Margin = t.Cost.Add(r.Cost), t.Margin.Add(r.Margin)
	}
	return out, nil
}

func (p *ProductSales) CSVTable() ([]string, [][]string) {
	h := []string{"product_id", "sku", "name", "category", "unit", "qty", "gross", "discount", "net", "cost", "margin"}
	rows := make([][]string, 0, len(p.Rows)+1)
	line := func(r postgres.ProductSalesRow) []string {
		return []string{uidp(r.ProductID), r.SKU, r.Name, r.Category, r.Unit, qty(r.Qty), money(r.Gross), money(r.Discount), money(r.Net), money(r.Cost), money(r.Margin)}
	}
	for _, r := range p.Rows {
		rows = append(rows, line(r))
	}
	rows = append(rows, line(p.Total))
	return h, rows
}

// ---------------------------------------------------------------------------
// 3. Sales by category
// ---------------------------------------------------------------------------

type CategorySales struct {
	Range
	Rows  []postgres.CategorySalesRow `json:"rows"`
	Total postgres.CategorySalesRow   `json:"total"`
}

func (s *Service) SalesByCategory(ctx context.Context, storeID uuid.UUID, rg Range) (*CategorySales, error) {
	out := &CategorySales{Range: rg}
	err := s.read(ctx, storeID, func(ctx context.Context) error {
		var err error
		out.Rows, err = s.rep.SalesByCategory(ctx, storeID, rg.Start, rg.End)
		return err
	})
	if err != nil {
		return nil, err
	}
	t := &out.Total
	t.Category = "total"
	for i := range out.Rows {
		r := &out.Rows[i]
		r.MarginPct = pct(r.Margin, r.Net)
		t.Qty, t.Gross, t.Discount, t.Net = t.Qty.Add(r.Qty), t.Gross.Add(r.Gross), t.Discount.Add(r.Discount), t.Net.Add(r.Net)
		t.Cost, t.Margin = t.Cost.Add(r.Cost), t.Margin.Add(r.Margin)
	}
	t.MarginPct = pct(t.Margin, t.Net)
	return out, nil
}

func (c *CategorySales) CSVTable() ([]string, [][]string) {
	h := []string{"category_id", "category", "bills", "qty", "gross", "discount", "net", "cost", "margin", "margin_pct"}
	rows := make([][]string, 0, len(c.Rows)+1)
	line := func(r postgres.CategorySalesRow) []string {
		return []string{uidp(r.CategoryID), r.Category, itoa(r.Bills), qty(r.Qty), money(r.Gross), money(r.Discount), money(r.Net), money(r.Cost), money(r.Margin), money(r.MarginPct)}
	}
	for _, r := range c.Rows {
		rows = append(rows, line(r))
	}
	rows = append(rows, line(c.Total))
	return h, rows
}

// ---------------------------------------------------------------------------
// 4. Sales by cashier
// ---------------------------------------------------------------------------

type CashierSales struct {
	Range
	Rows  []postgres.CashierSalesRow `json:"rows"`
	Total postgres.CashierSalesRow   `json:"total"`
}

func (s *Service) SalesByCashier(ctx context.Context, storeID uuid.UUID, rg Range) (*CashierSales, error) {
	out := &CashierSales{Range: rg}
	err := s.read(ctx, storeID, func(ctx context.Context) error {
		var err error
		out.Rows, err = s.rep.SalesByCashier(ctx, storeID, rg.Start, rg.End)
		return err
	})
	if err != nil {
		return nil, err
	}
	t := &out.Total
	t.Cashier = "total"
	for i := range out.Rows {
		r := &out.Rows[i]
		r.AvgBill = avg(r.Net, r.Bills)
		t.Bills += r.Bills
		t.Cancelled += r.Cancelled
		t.Net = t.Net.Add(r.Net)
	}
	t.AvgBill = avg(t.Net, t.Bills)
	return out, nil
}

func (c *CashierSales) CSVTable() ([]string, [][]string) {
	h := []string{"cashier_id", "cashier", "bills", "net", "cancelled", "avg_bill"}
	rows := make([][]string, 0, len(c.Rows)+1)
	line := func(r postgres.CashierSalesRow) []string {
		return []string{uidp(r.CashierID), r.Cashier, itoa(r.Bills), money(r.Net), itoa(r.Cancelled), money(r.AvgBill)}
	}
	for _, r := range c.Rows {
		rows = append(rows, line(r))
	}
	rows = append(rows, line(c.Total))
	return h, rows
}

// ---------------------------------------------------------------------------
// 5. Sales by hour
// ---------------------------------------------------------------------------

type HourlySales struct {
	Range
	Rows []postgres.HourSalesRow `json:"rows"` // always 24 buckets, hour 0..23
}

func (s *Service) SalesByHour(ctx context.Context, storeID uuid.UUID, rg Range) (*HourlySales, error) {
	out := &HourlySales{Range: rg}
	err := s.read(ctx, storeID, func(ctx context.Context) error {
		rows, err := s.rep.SalesByHour(ctx, storeID, rg.Start, rg.End)
		if err != nil {
			return err
		}
		out.Rows = fillHours(rows)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// fillHours expands sparse hour rows into 24 buckets.
func fillHours(rows []postgres.HourSalesRow) []postgres.HourSalesRow {
	out := make([]postgres.HourSalesRow, 24)
	for i := range out {
		out[i].Hour = i
	}
	for _, r := range rows {
		if r.Hour >= 0 && r.Hour < 24 {
			out[r.Hour].Bills, out[r.Hour].Net = r.Bills, r.Net
		}
	}
	return out
}

func (h *HourlySales) CSVTable() ([]string, [][]string) {
	rows := make([][]string, 0, 24)
	for _, r := range h.Rows {
		rows = append(rows, []string{strconv.Itoa(r.Hour), itoa(r.Bills), money(r.Net)})
	}
	return []string{"hour", "bills", "net"}, rows
}

// ---------------------------------------------------------------------------
// 6. Product movement
// ---------------------------------------------------------------------------

type ProductMovement struct {
	Range
	Product        postgres.ProductBrief  `json:"product"`
	OpeningBalance decimal.Decimal        `json:"opening_balance"`
	In             decimal.Decimal        `json:"in"`
	Out            decimal.Decimal        `json:"out"`
	ClosingBalance decimal.Decimal        `json:"closing_balance"`
	Rows           []postgres.MovementRow `json:"rows"`
}

func (s *Service) ProductMovement(ctx context.Context, storeID, productID uuid.UUID, rg Range) (*ProductMovement, error) {
	out := &ProductMovement{Range: rg}
	err := s.read(ctx, storeID, func(ctx context.Context) error {
		p, err := s.rep.ProductBrief(ctx, storeID, productID)
		if err != nil {
			return err
		}
		out.Product = *p
		if out.OpeningBalance, err = s.rep.MovementOpening(ctx, storeID, productID, rg.Start); err != nil {
			return err
		}
		out.Rows, err = s.rep.Movements(ctx, storeID, productID, rg.Start, rg.End)
		return err
	})
	if err != nil {
		return nil, err
	}
	bal := out.OpeningBalance
	for i := range out.Rows {
		r := &out.Rows[i]
		bal = bal.Add(r.QtyDelta)
		r.Balance = bal
		if r.QtyDelta.IsPositive() {
			out.In = out.In.Add(r.QtyDelta)
		} else {
			out.Out = out.Out.Add(r.QtyDelta.Abs())
		}
	}
	out.ClosingBalance = bal
	return out, nil
}

func (p *ProductMovement) CSVTable() ([]string, [][]string) {
	h := []string{"at", "type", "doc_no", "qty_delta", "balance", "balance_after", "unit_cost", "ref_type", "note", "by"}
	rows := make([][]string, 0, len(p.Rows)+2)
	rows = append(rows, []string{p.From, "opening", "", "", qty(p.OpeningBalance), "", "", "", p.Product.SKU + " " + p.Product.Name, ""})
	for _, r := range p.Rows {
		cost := ""
		if r.UnitCost != nil {
			cost = r.UnitCost.StringFixed(4)
		}
		rows = append(rows, []string{ts(r.At), r.Type, r.DocNo, qty(r.QtyDelta), qty(r.Balance), qty(r.BalanceAfter), cost, r.RefType, r.Note, r.By})
	}
	rows = append(rows, []string{p.To, "closing", "", "", qty(p.ClosingBalance), "", "", "", "in " + qty(p.In) + " / out " + qty(p.Out), ""})
	return h, rows
}

// ---------------------------------------------------------------------------
// 7. Inventory status
// ---------------------------------------------------------------------------

type InventoryTotals struct {
	Products    int             `json:"products"`
	Units       decimal.Decimal `json:"units"`
	CostValue   decimal.Decimal `json:"cost_value"`
	RetailValue decimal.Decimal `json:"retail_value"`
}

type InventoryStatus struct {
	AsOf   string                   `json:"as_of"`
	Filter postgres.InventoryFilter `json:"-"`
	Rows   []postgres.InventoryRow  `json:"rows"`
	Total  InventoryTotals          `json:"total"`
}

func (s *Service) InventoryStatus(ctx context.Context, storeID uuid.UUID, f postgres.InventoryFilter) (*InventoryStatus, error) {
	out := &InventoryStatus{AsOf: time.Now().In(Location).Format(dateLayout), Filter: f}
	err := s.read(ctx, storeID, func(ctx context.Context) error {
		var err error
		out.Rows, err = s.rep.InventoryStatus(ctx, storeID, f)
		return err
	})
	if err != nil {
		return nil, err
	}
	out.Total.Products = len(out.Rows)
	for _, r := range out.Rows {
		if r.Stock.IsPositive() {
			out.Total.Units = out.Total.Units.Add(r.Stock)
			out.Total.CostValue = out.Total.CostValue.Add(r.StockValue)
			out.Total.RetailValue = out.Total.RetailValue.Add(r.Stock.Mul(r.SellPrice))
		}
	}
	out.Total.RetailValue = out.Total.RetailValue.Round(2)
	return out, nil
}

func (i *InventoryStatus) CSVTable() ([]string, [][]string) {
	h := []string{"product_id", "sku", "name", "category", "unit", "stock", "min_level1", "min_level2", "cost_avg", "sell_price", "stock_value", "last_sold_at", "last_received_at"}
	rows := make([][]string, 0, len(i.Rows)+1)
	for _, r := range i.Rows {
		rows = append(rows, []string{r.ProductID.String(), r.SKU, r.Name, r.Category, r.Unit, qty(r.Stock), qty(r.MinLevel1), qty(r.MinLevel2),
			r.CostAvg.StringFixed(4), money(r.SellPrice), money(r.StockValue), tsp(r.LastSoldAt), tsp(r.LastReceivedAt)})
	}
	rows = append(rows, []string{"", "", "total", strconv.Itoa(i.Total.Products) + " products", "", qty(i.Total.Units), "", "", "", money(i.Total.RetailValue), money(i.Total.CostValue), "", ""})
	return h, rows
}

// ---------------------------------------------------------------------------
// 8. Dead stock
// ---------------------------------------------------------------------------

type DeadStock struct {
	AsOf       string                  `json:"as_of"`
	Days       int                     `json:"days"`
	Since      string                  `json:"since"`
	CategoryID *uuid.UUID              `json:"category_id,omitempty"`
	Rows       []postgres.DeadStockRow `json:"rows"`
	Total      InventoryTotals         `json:"total"`
}

func (s *Service) DeadStock(ctx context.Context, storeID uuid.UUID, days int, categoryID *uuid.UUID) (*DeadStock, error) {
	if days <= 0 {
		days = 90
	}
	if days > 3650 {
		days = 3650
	}
	today := dayStart(time.Now().In(Location))
	since := today.AddDate(0, 0, -days)
	out := &DeadStock{AsOf: today.Format(dateLayout), Days: days, Since: since.Format(dateLayout), CategoryID: categoryID}
	err := s.read(ctx, storeID, func(ctx context.Context) error {
		var err error
		out.Rows, err = s.rep.DeadStock(ctx, storeID, since, categoryID)
		return err
	})
	if err != nil {
		return nil, err
	}
	out.Total.Products = len(out.Rows)
	for _, r := range out.Rows {
		out.Total.Units = out.Total.Units.Add(r.Stock)
		out.Total.CostValue = out.Total.CostValue.Add(r.StockValue)
	}
	return out, nil
}

func (d *DeadStock) CSVTable() ([]string, [][]string) {
	h := []string{"product_id", "sku", "name", "category", "unit", "stock", "cost_avg", "stock_value", "last_sold_at"}
	rows := make([][]string, 0, len(d.Rows)+1)
	for _, r := range d.Rows {
		rows = append(rows, []string{r.ProductID.String(), r.SKU, r.Name, r.Category, r.Unit, qty(r.Stock), r.CostAvg.StringFixed(4), money(r.StockValue), tsp(r.LastSoldAt)})
	}
	rows = append(rows, []string{"", "", "total", strconv.Itoa(d.Total.Products) + " products", "", qty(d.Total.Units), "", money(d.Total.CostValue), ""})
	return h, rows
}

// ---------------------------------------------------------------------------
// 9. AR aging per member
// ---------------------------------------------------------------------------

type ARAging struct {
	AsOf  string                `json:"as_of"`
	Rows  []postgres.ARAgingRow `json:"rows"`
	Total postgres.ARAgingRow   `json:"total"`
}

func (s *Service) ARAging(ctx context.Context, storeID uuid.UUID, asOf string, asOfStart time.Time) (*ARAging, error) {
	out := &ARAging{AsOf: asOf}
	err := s.read(ctx, storeID, func(ctx context.Context) error {
		var err error
		out.Rows, err = s.rep.ARAgingByMember(ctx, storeID, asOf, asOfStart.AddDate(0, 0, 1))
		return err
	})
	if err != nil {
		return nil, err
	}
	t := &out.Total
	t.Name = "total"
	for _, r := range out.Rows {
		t.Bills += r.Bills
		t.Balance, t.B0_30, t.B31_60 = t.Balance.Add(r.Balance), t.B0_30.Add(r.B0_30), t.B31_60.Add(r.B31_60)
		t.B61_90, t.B90Plus = t.B61_90.Add(r.B61_90), t.B90Plus.Add(r.B90Plus)
		if r.OldestDue != nil && (t.OldestDue == nil || r.OldestDue.Before(*t.OldestDue)) {
			d := *r.OldestDue
			t.OldestDue = &d
		}
	}
	return out, nil
}

func (a *ARAging) CSVTable() ([]string, [][]string) {
	h := []string{"member_id", "member_code", "name", "phone", "bills", "balance", "b0_30", "b31_60", "b61_90", "b90_plus", "oldest_due"}
	rows := make([][]string, 0, len(a.Rows)+1)
	for _, r := range a.Rows {
		rows = append(rows, []string{r.MemberID.String(), r.MemberCode, r.Name, r.Phone, itoa(r.Bills), money(r.Balance), money(r.B0_30), money(r.B31_60), money(r.B61_90), money(r.B90Plus), tsp(r.OldestDue)})
	}
	t := a.Total
	rows = append(rows, []string{"", "", "total", "", itoa(t.Bills), money(t.Balance), money(t.B0_30), money(t.B31_60), money(t.B61_90), money(t.B90Plus), tsp(t.OldestDue)})
	return h, rows
}

// ---------------------------------------------------------------------------
// 10. AR statement
// ---------------------------------------------------------------------------

type ARStatement struct {
	Range
	Member         postgres.MemberBrief      `json:"member"`
	OpeningBalance decimal.Decimal           `json:"opening_balance"`
	Charges        decimal.Decimal           `json:"charges"`
	Payments       decimal.Decimal           `json:"payments"`
	ClosingBalance decimal.Decimal           `json:"closing_balance"`
	Rows           []postgres.ARStatementRow `json:"rows"`
}

func (s *Service) ARStatement(ctx context.Context, storeID, memberID uuid.UUID, rg Range) (*ARStatement, error) {
	out := &ARStatement{Range: rg}
	err := s.read(ctx, storeID, func(ctx context.Context) error {
		m, err := s.rep.MemberBrief(ctx, storeID, memberID)
		if err != nil {
			return err
		}
		out.Member = *m
		if out.OpeningBalance, err = s.rep.ARBalanceBefore(ctx, storeID, memberID, rg.Start); err != nil {
			return err
		}
		out.Rows, err = s.rep.ARStatementRows(ctx, storeID, memberID, rg.Start, rg.End)
		return err
	})
	if err != nil {
		return nil, err
	}
	bal := out.OpeningBalance
	for i := range out.Rows {
		r := &out.Rows[i]
		bal = bal.Add(r.Debit).Sub(r.Credit)
		r.Balance = bal
		out.Charges = out.Charges.Add(r.Debit)
		out.Payments = out.Payments.Add(r.Credit)
	}
	out.ClosingBalance = bal
	return out, nil
}

func (a *ARStatement) CSVTable() ([]string, [][]string) {
	h := []string{"at", "kind", "doc_no", "sale_doc_no", "net", "debit", "credit", "balance", "method", "note"}
	rows := make([][]string, 0, len(a.Rows)+2)
	rows = append(rows, []string{a.From, "opening", "", "", "", "", "", money(a.OpeningBalance), "", a.Member.MemberCode + " " + a.Member.Name})
	for _, r := range a.Rows {
		rows = append(rows, []string{ts(r.At), r.Kind, r.DocNo, r.SaleDocNo, money(r.Net), money(r.Debit), money(r.Credit), money(r.Balance), r.Method, r.Note})
	}
	rows = append(rows, []string{a.To, "closing", "", "", "", money(a.Charges), money(a.Payments), money(a.ClosingBalance), "", ""})
	return h, rows
}

// ---------------------------------------------------------------------------
// 11. Purchases
// ---------------------------------------------------------------------------

type SupplierPurchases struct {
	Range
	Rows  []postgres.SupplierPurchaseRow `json:"rows"`
	Total postgres.SupplierPurchaseRow   `json:"total"`
}

func (s *Service) SupplierPurchases(ctx context.Context, storeID uuid.UUID, rg Range) (*SupplierPurchases, error) {
	out := &SupplierPurchases{Range: rg}
	err := s.read(ctx, storeID, func(ctx context.Context) error {
		var err error
		out.Rows, err = s.rep.SupplierPurchases(ctx, storeID, rg.Start, rg.End)
		return err
	})
	if err != nil {
		return nil, err
	}
	out.Total.Supplier = "total"
	for _, r := range out.Rows {
		out.Total.Receipts += r.Receipts
		out.Total.Total = out.Total.Total.Add(r.Total)
	}
	return out, nil
}

func (p *SupplierPurchases) CSVTable() ([]string, [][]string) {
	rows := make([][]string, 0, len(p.Rows)+1)
	for _, r := range p.Rows {
		rows = append(rows, []string{uidp(r.SupplierID), r.Supplier, itoa(r.Receipts), money(r.Total)})
	}
	rows = append(rows, []string{"", "total", itoa(p.Total.Receipts), money(p.Total.Total)})
	return []string{"supplier_id", "supplier", "receipts", "total"}, rows
}

type Purchases struct {
	Range
	SupplierID *uuid.UUID             `json:"supplier_id,omitempty"`
	Rows       []postgres.PurchaseRow `json:"rows"`
	Total      postgres.PurchaseRow   `json:"total"` // sums posted receipts only
}

func (s *Service) Purchases(ctx context.Context, storeID uuid.UUID, rg Range, supplierID *uuid.UUID) (*Purchases, error) {
	out := &Purchases{Range: rg, SupplierID: supplierID}
	err := s.read(ctx, storeID, func(ctx context.Context) error {
		var err error
		out.Rows, err = s.rep.Purchases(ctx, storeID, rg.Start, rg.End, supplierID)
		return err
	})
	if err != nil {
		return nil, err
	}
	t := &out.Total
	t.DocNo, t.Status = "total", domain.ReceiptPosted
	for _, r := range out.Rows {
		if r.Status != domain.ReceiptPosted {
			continue
		}
		t.Lines += r.Lines
		t.Qty, t.Subtotal, t.VAT, t.Total = t.Qty.Add(r.Qty), t.Subtotal.Add(r.Subtotal), t.VAT.Add(r.VAT), t.Total.Add(r.Total)
	}
	return out, nil
}

func (p *Purchases) CSVTable() ([]string, [][]string) {
	h := []string{"id", "doc_no", "supplier_id", "supplier", "supplier_ref", "received_at", "received_by", "status", "lines", "qty", "subtotal", "vat", "total"}
	rows := make([][]string, 0, len(p.Rows)+1)
	for _, r := range p.Rows {
		rows = append(rows, []string{r.ID.String(), r.DocNo, uidp(r.SupplierID), r.Supplier, r.SupplierRef, ts(r.ReceivedAt), r.ReceivedBy, r.Status, itoa(r.Lines), qty(r.Qty), money(r.Subtotal), money(r.VAT), money(r.Total)})
	}
	t := p.Total
	rows = append(rows, []string{"", "total", "", "", "", "", "", t.Status, itoa(t.Lines), qty(t.Qty), money(t.Subtotal), money(t.VAT), money(t.Total)})
	return h, rows
}

// ---------------------------------------------------------------------------
// 12. Expenses summary
// ---------------------------------------------------------------------------

type ExpensesSummary struct {
	Range
	Rows   []postgres.ExpensePeriodRow `json:"rows"`    // per period per type
	ByType []postgres.ExpensePeriodRow `json:"by_type"` // whole range per type
	Count  int64                       `json:"count"`
	Total  decimal.Decimal             `json:"total"`
}

func (s *Service) ExpensesSummary(ctx context.Context, storeID uuid.UUID, rg Range) (*ExpensesSummary, error) {
	out := &ExpensesSummary{Range: rg}
	err := s.read(ctx, storeID, func(ctx context.Context) error {
		var err error
		if out.Rows, err = s.rep.ExpensesByType(ctx, storeID, rg.From, rg.To, rg.Group); err != nil {
			return err
		}
		out.ByType, err = s.rep.ExpensesByType(ctx, storeID, rg.From, rg.To, "")
		return err
	})
	if err != nil {
		return nil, err
	}
	for _, r := range out.ByType {
		out.Count += r.Count
		out.Total = out.Total.Add(r.Amount)
	}
	return out, nil
}

func (e *ExpensesSummary) CSVTable() ([]string, [][]string) {
	rows := make([][]string, 0, len(e.Rows)+len(e.ByType)+1)
	for _, r := range e.Rows {
		rows = append(rows, []string{r.Period, uidp(r.TypeID), r.Type, itoa(r.Count), money(r.Amount)})
	}
	for _, r := range e.ByType {
		rows = append(rows, []string{"total", uidp(r.TypeID), r.Type, itoa(r.Count), money(r.Amount)})
	}
	rows = append(rows, []string{"total", "", "total", itoa(e.Count), money(e.Total)})
	return []string{"period", "type_id", "type", "count", "amount"}, rows
}

// ---------------------------------------------------------------------------
// 13. Profit & loss (cash basis)
// ---------------------------------------------------------------------------

type ProfitLoss struct {
	Range
	Bills           int64                       `json:"bills"`
	GrossSales      decimal.Decimal             `json:"gross_sales"`
	Discounts       decimal.Decimal             `json:"discounts"`
	NetSales        decimal.Decimal             `json:"net_sales"`
	ReturnsCount    int64                       `json:"returns_count"`
	ReturnsRefunded decimal.Decimal             `json:"returns_refunded"`
	NetRevenue      decimal.Decimal             `json:"net_revenue"`   // net_sales − returns_refunded
	CostOfGoods     decimal.Decimal             `json:"cost_of_goods"` // Σ sold qty×cost_avg − cost of restocked returns
	GrossProfit     decimal.Decimal             `json:"gross_profit"`  // net_revenue − cost_of_goods
	Expenses        []postgres.ExpensePeriodRow `json:"expenses"`
	ExpensesTotal   decimal.Decimal             `json:"expenses_total"`
	NetProfit       decimal.Decimal             `json:"net_profit"` // gross_profit − expenses_total
	MarginPct       decimal.Decimal             `json:"margin_pct"` // gross_profit / net_revenue
}

func (s *Service) ProfitLoss(ctx context.Context, storeID uuid.UUID, rg Range) (*ProfitLoss, error) {
	out := &ProfitLoss{Range: rg}
	err := s.read(ctx, storeID, func(ctx context.Context) error {
		st, err := s.rep.SalesTotals(ctx, storeID, rg.Start, rg.End)
		if err != nil {
			return err
		}
		rt, err := s.rep.ReturnTotals(ctx, storeID, rg.Start, rg.End)
		if err != nil {
			return err
		}
		out.Bills, out.GrossSales, out.Discounts, out.NetSales = st.Bills, st.Gross, st.Discount, st.Net
		out.ReturnsCount, out.ReturnsRefunded = rt.Count, rt.Refunded
		out.CostOfGoods = st.Cost.Sub(rt.RestockCost)
		out.Expenses, err = s.rep.ExpensesByType(ctx, storeID, rg.From, rg.To, "")
		return err
	})
	if err != nil {
		return nil, err
	}
	out.NetRevenue = out.NetSales.Sub(out.ReturnsRefunded)
	out.GrossProfit = out.NetRevenue.Sub(out.CostOfGoods)
	for _, e := range out.Expenses {
		out.ExpensesTotal = out.ExpensesTotal.Add(e.Amount)
	}
	out.NetProfit = out.GrossProfit.Sub(out.ExpensesTotal)
	out.MarginPct = pct(out.GrossProfit, out.NetRevenue)
	return out, nil
}

func (p *ProfitLoss) CSVTable() ([]string, [][]string) {
	rows := [][]string{
		{"bills", itoa(p.Bills)},
		{"gross_sales", money(p.GrossSales)},
		{"discounts", money(p.Discounts)},
		{"net_sales", money(p.NetSales)},
		{"returns_count", itoa(p.ReturnsCount)},
		{"returns_refunded", money(p.ReturnsRefunded)},
		{"net_revenue", money(p.NetRevenue)},
		{"cost_of_goods", money(p.CostOfGoods)},
		{"gross_profit", money(p.GrossProfit)},
	}
	for _, e := range p.Expenses {
		rows = append(rows, []string{"expense: " + e.Type, money(e.Amount)})
	}
	rows = append(rows, []string{"expenses_total", money(p.ExpensesTotal)}, []string{"net_profit", money(p.NetProfit)}, []string{"margin_pct", money(p.MarginPct)})
	return []string{"item", "amount"}, rows
}

// ---------------------------------------------------------------------------
// 14. Monthly chart
// ---------------------------------------------------------------------------

type MonthChartRow struct {
	MonthIndex  int             `json:"month_index"`
	MonthNameTH string          `json:"month_name_th"`
	MonthNameEN string          `json:"month_name_en"`
	Bills       int64           `json:"bills"`
	Net         decimal.Decimal `json:"net"`
}

type MonthlyChart struct {
	Year   int             `json:"year"`
	YearBE int             `json:"year_be"`
	Source string          `json:"source"` // mv | live
	Rows   []MonthChartRow `json:"rows"`
	Bills  int64           `json:"bills"`
	Net    decimal.Decimal `json:"net"`
}

func (s *Service) MonthlyChart(ctx context.Context, storeID uuid.UUID, year int) (*MonthlyChart, error) {
	out := &MonthlyChart{Year: year, YearBE: year + 543}
	err := s.read(ctx, storeID, func(ctx context.Context) error {
		populated, err := s.rep.MonthlyMVPopulated(ctx)
		if err != nil {
			return err
		}
		var rows []postgres.MonthRow
		if populated {
			if rows, err = s.rep.MonthlyFromMV(ctx, storeID, year); err != nil {
				return err
			}
			out.Source = "mv"
		}
		if len(rows) == 0 {
			from := time.Date(year, 1, 1, 0, 0, 0, 0, Location)
			if rows, err = s.rep.MonthlyLive(ctx, storeID, from, from.AddDate(1, 0, 0)); err != nil {
				return err
			}
			out.Source = "live"
		}
		out.Rows = fillMonths(rows)
		return nil
	})
	if err != nil {
		return nil, err
	}
	for _, r := range out.Rows {
		out.Bills += r.Bills
		out.Net = out.Net.Add(r.Net)
	}
	return out, nil
}

// fillMonths expands sparse month rows into 12 named buckets.
func fillMonths(rows []postgres.MonthRow) []MonthChartRow {
	out := make([]MonthChartRow, 12)
	for i := range out {
		out[i] = MonthChartRow{MonthIndex: i + 1, MonthNameTH: monthTH[i], MonthNameEN: monthEN[i]}
	}
	for _, r := range rows {
		if r.Month >= 1 && r.Month <= 12 {
			out[r.Month-1].Bills, out[r.Month-1].Net = r.Bills, r.Net
		}
	}
	return out
}

func (m *MonthlyChart) CSVTable() ([]string, [][]string) {
	rows := make([][]string, 0, 13)
	for _, r := range m.Rows {
		rows = append(rows, []string{strconv.Itoa(r.MonthIndex), r.MonthNameTH, r.MonthNameEN, itoa(r.Bills), money(r.Net)})
	}
	rows = append(rows, []string{"", "total", "", itoa(m.Bills), money(m.Net)})
	return []string{"month_index", "month_name_th", "month_name_en", "bills", "net"}, rows
}

// RefreshMonthlyChart rebuilds monthly_sales_mv. The view is store-independent (one row per store per
// month) and is rebuilt as a whole, so this runs with RLS bypassed; the HTTP layer restricts it to managers.
func (s *Service) RefreshMonthlyChart(ctx context.Context) error {
	return s.db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, _ pgx.Tx) error {
		return s.rep.RefreshMonthlyMV(ctx)
	})
}

// ---------------------------------------------------------------------------
// 15. Dashboard
// ---------------------------------------------------------------------------

type DashboardToday struct {
	Bills     int64           `json:"bills"`
	Net       decimal.Decimal `json:"net"`
	Cash      decimal.Decimal `json:"cash"`
	Credit    decimal.Decimal `json:"credit"`
	AvgBill   decimal.Decimal `json:"avg_bill"`
	Cancelled int64           `json:"cancelled"`
}

type OpenShift struct {
	ID       uuid.UUID `json:"id"`
	OpenedAt time.Time `json:"opened_at"`
	Cashier  string    `json:"cashier"`
	Terminal string    `json:"terminal"`
}

type Dashboard struct {
	Date          string                     `json:"date"`
	Today         DashboardToday             `json:"today"`
	MonthToDate   decimal.Decimal            `json:"month_to_date_net"`
	MTDBills      int64                      `json:"month_to_date_bills"`
	LowStockCount int64                      `json:"low_stock_count"`
	AROutstanding decimal.Decimal            `json:"ar_outstanding_total"`
	OpenShift     *OpenShift                 `json:"open_shift"`
	TopProducts   []postgres.ProductSalesRow `json:"top_products"`
	Hourly        []postgres.HourSalesRow    `json:"hourly"`
}

func (s *Service) Dashboard(ctx context.Context, storeID uuid.UUID) (*Dashboard, error) {
	now := time.Now().In(Location)
	today := dayStart(now)
	tomorrow := today.AddDate(0, 0, 1)
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, Location)
	out := &Dashboard{Date: today.Format(dateLayout)}
	err := s.read(ctx, storeID, func(ctx context.Context) error {
		day, err := s.rep.PeriodSales(ctx, storeID, today, tomorrow, "day")
		if err != nil {
			return err
		}
		for _, r := range day {
			out.Today.Bills += r.Bills
			out.Today.Cancelled += r.Cancelled
			out.Today.Net, out.Today.Cash, out.Today.Credit = out.Today.Net.Add(r.Net), out.Today.Cash.Add(r.Cash), out.Today.Credit.Add(r.Credit)
		}
		out.Today.AvgBill = avg(out.Today.Net, out.Today.Bills)
		mtd, err := s.rep.SalesTotals(ctx, storeID, monthStart, tomorrow)
		if err != nil {
			return err
		}
		out.MonthToDate, out.MTDBills = mtd.Net, mtd.Bills
		if out.LowStockCount, err = s.rep.LowStockCount(ctx, storeID); err != nil {
			return err
		}
		if out.AROutstanding, err = s.rep.AROutstanding(ctx, storeID); err != nil {
			return err
		}
		sh, err := s.shifts.CurrentOpen(ctx, storeID, nil, "")
		if err != nil {
			return err
		}
		if sh != nil {
			out.OpenShift = &OpenShift{ID: sh.ID, OpenedAt: sh.OpenedAt, Cashier: sh.CashierName, Terminal: sh.Terminal}
		}
		if out.TopProducts, err = s.rep.SalesByProduct(ctx, storeID, today, tomorrow, nil, 5, "net"); err != nil {
			return err
		}
		hours, err := s.rep.SalesByHour(ctx, storeID, today, tomorrow)
		if err != nil {
			return err
		}
		out.Hourly = fillHours(hours)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (d *Dashboard) CSVTable() ([]string, [][]string) {
	shift := ""
	if d.OpenShift != nil {
		shift = d.OpenShift.ID.String() + " " + d.OpenShift.Cashier + " " + ts(d.OpenShift.OpenedAt)
	}
	rows := [][]string{
		{"date", d.Date},
		{"today_bills", itoa(d.Today.Bills)},
		{"today_net", money(d.Today.Net)},
		{"today_cash", money(d.Today.Cash)},
		{"today_credit", money(d.Today.Credit)},
		{"today_avg_bill", money(d.Today.AvgBill)},
		{"today_cancelled", itoa(d.Today.Cancelled)},
		{"month_to_date_net", money(d.MonthToDate)},
		{"month_to_date_bills", itoa(d.MTDBills)},
		{"low_stock_count", itoa(d.LowStockCount)},
		{"ar_outstanding_total", money(d.AROutstanding)},
		{"open_shift", shift},
	}
	for _, p := range d.TopProducts {
		rows = append(rows, []string{"top_product: " + p.SKU + " " + p.Name, money(p.Net)})
	}
	for _, h := range d.Hourly {
		rows = append(rows, []string{"hour_" + strconv.Itoa(h.Hour), money(h.Net)})
	}
	return []string{"item", "value"}, rows
}

// ---------------------------------------------------------------------------
// 16. Shift report
// ---------------------------------------------------------------------------

type ShiftReport struct {
	Shift         *domain.Shift              `json:"shift"`
	Summary       *postgres.DailySummary     `json:"summary"`
	Drawer        []postgres.DrawerLog       `json:"drawer"`
	Expenses      []postgres.ShiftExpenseRow `json:"expenses"`
	ExpensesTotal decimal.Decimal            `json:"expenses_total"`
	ExpectedCash  decimal.Decimal            `json:"expected_cash"`
	CountedCash   *decimal.Decimal           `json:"counted_cash,omitempty"`
	Variance      *decimal.Decimal           `json:"variance,omitempty"`
}

func (s *Service) ShiftReport(ctx context.Context, storeID, shiftID uuid.UUID) (*ShiftReport, error) {
	out := &ShiftReport{}
	err := s.read(ctx, storeID, func(ctx context.Context) error {
		sh, err := s.shifts.Get(ctx, storeID, shiftID)
		if err != nil {
			return err
		}
		out.Shift = sh
		end := time.Now().Add(time.Second)
		if sh.ClosedAt != nil {
			end = sh.ClosedAt.Add(time.Second)
		}
		if out.Summary, err = s.sales.Summary(ctx, storeID, sh.OpenedAt, end, &shiftID); err != nil {
			return err
		}
		logs, _, err := s.drawer.List(ctx, storeID, sh.OpenedAt.Add(-time.Second), end, 1000, 0)
		if err != nil {
			return err
		}
		out.Drawer = []postgres.DrawerLog{}
		for i := len(logs) - 1; i >= 0; i-- { // DrawerRepo.List is newest-first; report oldest-first
			if logs[i].ShiftID != nil && *logs[i].ShiftID == shiftID {
				out.Drawer = append(out.Drawer, logs[i])
			}
		}
		out.Expenses, err = s.rep.ExpensesByShift(ctx, storeID, shiftID)
		return err
	})
	if err != nil {
		return nil, err
	}
	for _, e := range out.Expenses {
		out.ExpensesTotal = out.ExpensesTotal.Add(e.Amount)
	}
	sh := out.Shift
	if sh.ExpectedCash != nil {
		out.ExpectedCash = *sh.ExpectedCash
	} else {
		out.ExpectedCash = sh.OpeningFloat.Add(sh.CashSales).Add(sh.CashIn).Sub(sh.CashOut)
	}
	out.CountedCash, out.Variance = sh.CountedCash, sh.Variance
	return out, nil
}

func (r *ShiftReport) CSVTable() ([]string, [][]string) {
	sh := r.Shift
	rows := [][]string{
		{"shift", "id", sh.ID.String(), ""},
		{"shift", "cashier", sh.CashierName, ""},
		{"shift", "terminal", sh.Terminal, ""},
		{"shift", "status", sh.Status, ""},
		{"shift", "opened_at", ts(sh.OpenedAt), ""},
		{"shift", "closed_at", tsp(sh.ClosedAt), ""},
		{"shift", "opening_float", "", money(sh.OpeningFloat)},
		{"shift", "cash_sales", "", money(sh.CashSales)},
		{"shift", "cash_in", "", money(sh.CashIn)},
		{"shift", "cash_out", "", money(sh.CashOut)},
		{"shift", "expected_cash", "", money(r.ExpectedCash)},
	}
	if r.CountedCash != nil {
		rows = append(rows, []string{"shift", "counted_cash", "", money(*r.CountedCash)})
	}
	if r.Variance != nil {
		rows = append(rows, []string{"shift", "variance", "", money(*r.Variance)})
	}
	if r.Summary != nil {
		rows = append(rows, []string{"sales", "bills", itoa(r.Summary.Bills), ""}, []string{"sales", "cancelled", itoa(r.Summary.Cancelled), ""},
			[]string{"sales", "gross", "", money(r.Summary.Gross)}, []string{"sales", "discount", "", money(r.Summary.Discount)}, []string{"sales", "net", "", money(r.Summary.Net)})
		for _, m := range []string{"cash", "credit", "transfer", "card", "qr", "other"} {
			if v, ok := r.Summary.ByMethod[m]; ok {
				rows = append(rows, []string{"payment", m, "", money(v)})
			}
		}
	}
	for _, d := range r.Drawer {
		rows = append(rows, []string{"drawer", d.Reason, ts(d.OccurredAt) + " " + d.UserName + " " + d.Note, money(d.Amount)})
	}
	for _, e := range r.Expenses {
		rows = append(rows, []string{"expense", e.Type, e.ExpensedAt + " " + e.PaidFrom + " " + e.Note, money(e.Amount)})
	}
	rows = append(rows, []string{"expense", "total", "", money(r.ExpensesTotal)})
	return []string{"section", "item", "detail", "amount"}, rows
}
