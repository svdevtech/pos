package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
)

// ReportRepo holds the read-only aggregate queries behind /reports. Every query is tenant-scoped
// (store_id = $1) and business-day boundaries are evaluated in the store timezone (Asia/Bangkok).
type ReportRepo struct{}

// reportTZ is the business-day timezone used for bucketing timestamps.
const reportTZ = "Asia/Bangkok"

// soldCond selects sales that count as revenue: everything that was not cancelled. Bills that were
// (partially) refunded keep their original net; refunds are reported separately (sale_returns).
const soldCond = `s.status <> 'cancelled'`

// periodExpr returns the SQL bucket expression and the to_char format for a group (day|month).
func periodExpr(col, group string) (expr, format string) {
	if group == "month" {
		return fmt.Sprintf(`date_trunc('month', %s AT TIME ZONE '%s')::date`, col, reportTZ), "YYYY-MM"
	}
	return fmt.Sprintf(`(%s AT TIME ZONE '%s')::date`, col, reportTZ), "YYYY-MM-DD"
}

// ---------------------------------------------------------------------------
// Daily / monthly sales
// ---------------------------------------------------------------------------

// PeriodSalesRow is one bucket (day or month) of the daily-sales report.
type PeriodSalesRow struct {
	Period    string          `json:"date"`
	Bills     int64           `json:"bills"`
	Gross     decimal.Decimal `json:"gross"`
	Discount  decimal.Decimal `json:"discount"`
	Net       decimal.Decimal `json:"net"`
	Cancelled int64           `json:"cancelled"`
	Cash      decimal.Decimal `json:"cash"`
	Credit    decimal.Decimal `json:"credit"`
	Transfer  decimal.Decimal `json:"transfer"`
	Card      decimal.Decimal `json:"card"`
	QR        decimal.Decimal `json:"qr"`
	Other     decimal.Decimal `json:"other"`
	Cost      decimal.Decimal `json:"cost"`
	Margin    decimal.Decimal `json:"margin"`
	MarginPct decimal.Decimal `json:"margin_pct"`
}

// PeriodSales buckets sales by business day or month. Cost = Σ sale_lines.qty × cost_avg of sold bills.
func (ReportRepo) PeriodSales(ctx context.Context, storeID uuid.UUID, from, to time.Time, group string) ([]PeriodSalesRow, error) {
	expr, format := periodExpr("s.sold_at", group)
	rows, err := Q(ctx).Query(ctx, `SELECT to_char(x.p, '`+format+`'),
		count(*) FILTER (WHERE x.sold),
		COALESCE(sum(x.gross) FILTER (WHERE x.sold),0)::text, COALESCE(sum(x.discount) FILTER (WHERE x.sold),0)::text, COALESCE(sum(x.net) FILTER (WHERE x.sold),0)::text,
		count(*) FILTER (WHERE NOT x.sold),
		COALESCE(sum(pm.cash) FILTER (WHERE x.sold),0)::text, COALESCE(sum(pm.credit) FILTER (WHERE x.sold),0)::text, COALESCE(sum(pm.transfer) FILTER (WHERE x.sold),0)::text,
		COALESCE(sum(pm.card) FILTER (WHERE x.sold),0)::text, COALESCE(sum(pm.qr) FILTER (WHERE x.sold),0)::text, COALESCE(sum(pm.other) FILTER (WHERE x.sold),0)::text,
		COALESCE(sum(c.cost) FILTER (WHERE x.sold),0)::text
		FROM (SELECT s.id, s.gross, s.discount, s.net, `+soldCond+` AS sold, `+expr+` AS p
			FROM sales s WHERE s.store_id=$1 AND s.sold_at>=$2 AND s.sold_at<$3) x
		LEFT JOIN LATERAL (SELECT COALESCE(sum(y.amount) FILTER (WHERE y.method='cash'),0) AS cash, COALESCE(sum(y.amount) FILTER (WHERE y.method='credit'),0) AS credit,
			COALESCE(sum(y.amount) FILTER (WHERE y.method='transfer'),0) AS transfer, COALESCE(sum(y.amount) FILTER (WHERE y.method='card'),0) AS card,
			COALESCE(sum(y.amount) FILTER (WHERE y.method='qr'),0) AS qr, COALESCE(sum(y.amount) FILTER (WHERE y.method='other'),0) AS other
			FROM sale_payments y WHERE y.sale_id=x.id) pm ON true
		LEFT JOIN LATERAL (SELECT COALESCE(sum(l.qty*l.cost_avg),0) AS cost FROM sale_lines l WHERE l.sale_id=x.id) c ON true
		GROUP BY x.p ORDER BY x.p`, storeID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PeriodSalesRow{}
	for rows.Next() {
		var r PeriodSalesRow
		var gross, disc, net, cash, credit, transfer, card, qr, other, cost string
		if err := rows.Scan(&r.Period, &r.Bills, &gross, &disc, &net, &r.Cancelled, &cash, &credit, &transfer, &card, &qr, &other, &cost); err != nil {
			return nil, err
		}
		r.Gross, r.Discount, r.Net = dec(gross), dec(disc), dec(net)
		r.Cash, r.Credit, r.Transfer, r.Card, r.QR, r.Other = dec(cash), dec(credit), dec(transfer), dec(card), dec(qr), dec(other)
		r.Cost = dec(cost).Round(2)
		out = append(out, r)
	}
	return out, rows.Err()
}

// SalesTotals is the headline aggregate of sold bills in a range.
type SalesTotals struct {
	Bills    int64           `json:"bills"`
	Gross    decimal.Decimal `json:"gross"`
	Discount decimal.Decimal `json:"discount"`
	Net      decimal.Decimal `json:"net"`
	Cost     decimal.Decimal `json:"cost"`
}

func (ReportRepo) SalesTotals(ctx context.Context, storeID uuid.UUID, from, to time.Time) (SalesTotals, error) {
	var t SalesTotals
	var gross, disc, net, cost string
	err := Q(ctx).QueryRow(ctx, `SELECT count(*), COALESCE(sum(s.gross),0)::text, COALESCE(sum(s.discount),0)::text, COALESCE(sum(s.net),0)::text,
		COALESCE((SELECT sum(l.qty*l.cost_avg) FROM sale_lines l JOIN sales s2 ON s2.id=l.sale_id
			WHERE s2.store_id=$1 AND s2.sold_at>=$2 AND s2.sold_at<$3 AND s2.status <> 'cancelled'),0)::text
		FROM sales s WHERE s.store_id=$1 AND s.sold_at>=$2 AND s.sold_at<$3 AND `+soldCond, storeID, from, to).Scan(&t.Bills, &gross, &disc, &net, &cost)
	if err != nil {
		return t, err
	}
	t.Gross, t.Discount, t.Net, t.Cost = dec(gross), dec(disc), dec(net), dec(cost).Round(2)
	return t, nil
}

// ReturnTotals summarises sale_returns in a range. RestockCost is the cost value of returned goods put back on the shelf.
type ReturnTotals struct {
	Count       int64           `json:"count"`
	Refunded    decimal.Decimal `json:"refunded"`
	RestockCost decimal.Decimal `json:"restock_cost"`
}

func (ReportRepo) ReturnTotals(ctx context.Context, storeID uuid.UUID, from, to time.Time) (ReturnTotals, error) {
	var t ReturnTotals
	var refunded, cost string
	err := Q(ctx).QueryRow(ctx, `SELECT count(*), COALESCE(sum(r.refund_amount),0)::text,
		COALESCE((SELECT sum(rl.qty*sl.cost_avg) FROM sale_return_lines rl JOIN sale_lines sl ON sl.id=rl.sale_line_id JOIN sale_returns r2 ON r2.id=rl.return_id
			WHERE r2.store_id=$1 AND r2.restock AND r2.returned_at>=$2 AND r2.returned_at<$3),0)::text
		FROM sale_returns r WHERE r.store_id=$1 AND r.returned_at>=$2 AND r.returned_at<$3`, storeID, from, to).Scan(&t.Count, &refunded, &cost)
	if err != nil {
		return t, err
	}
	t.Refunded, t.RestockCost = dec(refunded), dec(cost).Round(2)
	return t, nil
}

// ---------------------------------------------------------------------------
// Sales by product / category / cashier / hour
// ---------------------------------------------------------------------------

type ProductSalesRow struct {
	ProductID *uuid.UUID      `json:"product_id"`
	SKU       string          `json:"sku"`
	Name      string          `json:"name"`
	Category  string          `json:"category"`
	Unit      string          `json:"unit"`
	Qty       decimal.Decimal `json:"qty"`
	Gross     decimal.Decimal `json:"gross"`
	Discount  decimal.Decimal `json:"discount"`
	Net       decimal.Decimal `json:"net"`
	Cost      decimal.Decimal `json:"cost"`
	Margin    decimal.Decimal `json:"margin"`
}

// SalesByProduct aggregates sold lines per product. sort ∈ qty|net|margin (default net).
func (ReportRepo) SalesByProduct(ctx context.Context, storeID uuid.UUID, from, to time.Time, categoryID *uuid.UUID, limit int, sort string) ([]ProductSalesRow, error) {
	order := `sum(l.line_total)`
	switch sort {
	case "qty":
		order = `sum(l.qty)`
	case "margin":
		order = `sum(l.line_total) - sum(l.qty*l.cost_avg)`
	}
	rows, err := Q(ctx).Query(ctx, `SELECT l.product_id, COALESCE(p.sku, l.sku, ''), COALESCE(p.name, l.description), COALESCE(c.name,''), COALESCE(u.name,''),
		sum(l.qty)::text, sum(l.line_total + l.discount)::text, sum(l.discount)::text, sum(l.line_total)::text, sum(l.qty*l.cost_avg)::text
		FROM sale_lines l JOIN sales s ON s.id=l.sale_id
		LEFT JOIN products p ON p.id=l.product_id LEFT JOIN product_categories c ON c.id=p.category_id LEFT JOIN units u ON u.id=p.unit_id
		WHERE s.store_id=$1 AND s.sold_at>=$2 AND s.sold_at<$3 AND `+soldCond+` AND ($4::uuid IS NULL OR p.category_id=$4::uuid)
		GROUP BY 1,2,3,4,5 ORDER BY `+order+` DESC, 3 LIMIT $5`, storeID, from, to, categoryID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProductSalesRow{}
	for rows.Next() {
		var r ProductSalesRow
		var qty, gross, disc, net, cost string
		if err := rows.Scan(&r.ProductID, &r.SKU, &r.Name, &r.Category, &r.Unit, &qty, &gross, &disc, &net, &cost); err != nil {
			return nil, err
		}
		r.Qty, r.Gross, r.Discount, r.Net, r.Cost = dec(qty), dec(gross), dec(disc), dec(net), dec(cost).Round(2)
		r.Margin = r.Net.Sub(r.Cost)
		out = append(out, r)
	}
	return out, rows.Err()
}

type CategorySalesRow struct {
	CategoryID *uuid.UUID      `json:"category_id"`
	Category   string          `json:"category"`
	Bills      int64           `json:"bills"`
	Qty        decimal.Decimal `json:"qty"`
	Gross      decimal.Decimal `json:"gross"`
	Discount   decimal.Decimal `json:"discount"`
	Net        decimal.Decimal `json:"net"`
	Cost       decimal.Decimal `json:"cost"`
	Margin     decimal.Decimal `json:"margin"`
	MarginPct  decimal.Decimal `json:"margin_pct"`
}

func (ReportRepo) SalesByCategory(ctx context.Context, storeID uuid.UUID, from, to time.Time) ([]CategorySalesRow, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT p.category_id, COALESCE(c.name,''), count(DISTINCT s.id), sum(l.qty)::text, sum(l.line_total + l.discount)::text,
		sum(l.discount)::text, sum(l.line_total)::text, sum(l.qty*l.cost_avg)::text
		FROM sale_lines l JOIN sales s ON s.id=l.sale_id
		LEFT JOIN products p ON p.id=l.product_id LEFT JOIN product_categories c ON c.id=p.category_id
		WHERE s.store_id=$1 AND s.sold_at>=$2 AND s.sold_at<$3 AND `+soldCond+`
		GROUP BY 1,2 ORDER BY sum(l.line_total) DESC, 2`, storeID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CategorySalesRow{}
	for rows.Next() {
		var r CategorySalesRow
		var qty, gross, disc, net, cost string
		if err := rows.Scan(&r.CategoryID, &r.Category, &r.Bills, &qty, &gross, &disc, &net, &cost); err != nil {
			return nil, err
		}
		r.Qty, r.Gross, r.Discount, r.Net, r.Cost = dec(qty), dec(gross), dec(disc), dec(net), dec(cost).Round(2)
		r.Margin = r.Net.Sub(r.Cost)
		out = append(out, r)
	}
	return out, rows.Err()
}

type CashierSalesRow struct {
	CashierID *uuid.UUID      `json:"cashier_id"`
	Cashier   string          `json:"cashier"`
	Bills     int64           `json:"bills"`
	Net       decimal.Decimal `json:"net"`
	Cancelled int64           `json:"cancelled"`
	AvgBill   decimal.Decimal `json:"avg_bill"`
}

func (ReportRepo) SalesByCashier(ctx context.Context, storeID uuid.UUID, from, to time.Time) ([]CashierSalesRow, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT s.cashier_id, COALESCE(NULLIF(s.cashier_name,''), u.display_name, ''),
		count(*) FILTER (WHERE `+soldCond+`), COALESCE(sum(s.net) FILTER (WHERE `+soldCond+`),0)::text, count(*) FILTER (WHERE s.status='cancelled')
		FROM sales s LEFT JOIN users u ON u.id=s.cashier_id
		WHERE s.store_id=$1 AND s.sold_at>=$2 AND s.sold_at<$3
		GROUP BY 1,2 ORDER BY COALESCE(sum(s.net) FILTER (WHERE `+soldCond+`),0) DESC, 2`, storeID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CashierSalesRow{}
	for rows.Next() {
		var r CashierSalesRow
		var net string
		if err := rows.Scan(&r.CashierID, &r.Cashier, &r.Bills, &net, &r.Cancelled); err != nil {
			return nil, err
		}
		r.Net = dec(net)
		out = append(out, r)
	}
	return out, rows.Err()
}

type HourSalesRow struct {
	Hour  int             `json:"hour"`
	Bills int64           `json:"bills"`
	Net   decimal.Decimal `json:"net"`
}

// SalesByHour returns only the hours that had sales; callers fill the 0..23 buckets.
func (ReportRepo) SalesByHour(ctx context.Context, storeID uuid.UUID, from, to time.Time) ([]HourSalesRow, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT extract(hour FROM s.sold_at AT TIME ZONE '`+reportTZ+`')::int, count(*), COALESCE(sum(s.net),0)::text
		FROM sales s WHERE s.store_id=$1 AND s.sold_at>=$2 AND s.sold_at<$3 AND `+soldCond+` GROUP BY 1 ORDER BY 1`, storeID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HourSalesRow{}
	for rows.Next() {
		var r HourSalesRow
		var net string
		if err := rows.Scan(&r.Hour, &r.Bills, &net); err != nil {
			return nil, err
		}
		r.Net = dec(net)
		out = append(out, r)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Product movement
// ---------------------------------------------------------------------------

type ProductBrief struct {
	ID       uuid.UUID       `json:"id"`
	SKU      string          `json:"sku"`
	Name     string          `json:"name"`
	Category string          `json:"category"`
	Unit     string          `json:"unit"`
	Stock    decimal.Decimal `json:"stock"`
	CostAvg  decimal.Decimal `json:"cost_avg"`
}

func (ReportRepo) ProductBrief(ctx context.Context, storeID, productID uuid.UUID) (*ProductBrief, error) {
	var p ProductBrief
	var stock, cost string
	err := Q(ctx).QueryRow(ctx, `SELECT p.id, p.sku, p.name, COALESCE(c.name,''), COALESCE(u.name,''), p.stock_on_hand::text, p.cost_avg::text
		FROM products p LEFT JOIN product_categories c ON c.id=p.category_id LEFT JOIN units u ON u.id=p.unit_id
		WHERE p.store_id=$1 AND p.id=$2`, storeID, productID).Scan(&p.ID, &p.SKU, &p.Name, &p.Category, &p.Unit, &stock, &cost)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrProductNotFound
	}
	if err != nil {
		return nil, err
	}
	p.Stock, p.CostAvg = dec(stock), dec(cost)
	return &p, nil
}

// MovementOpening returns the stock balance just before `before` (balance_after of the latest earlier movement, else 0).
func (ReportRepo) MovementOpening(ctx context.Context, storeID, productID uuid.UUID, before time.Time) (decimal.Decimal, error) {
	var bal string
	err := Q(ctx).QueryRow(ctx, `SELECT balance_after::text FROM stock_movements WHERE store_id=$1 AND product_id=$2 AND occurred_at<$3
		ORDER BY occurred_at DESC, id DESC LIMIT 1`, storeID, productID, before).Scan(&bal)
	if errors.Is(err, pgx.ErrNoRows) {
		return decimal.Zero, nil
	}
	if err != nil {
		return decimal.Zero, err
	}
	return dec(bal), nil
}

type MovementRow struct {
	ID           int64            `json:"id"`
	At           time.Time        `json:"at"`
	Type         string           `json:"type"`
	QtyDelta     decimal.Decimal  `json:"qty_delta"`
	UnitCost     *decimal.Decimal `json:"unit_cost,omitempty"`
	BalanceAfter decimal.Decimal  `json:"balance_after"`
	Balance      decimal.Decimal  `json:"balance"` // running balance computed from the opening balance
	RefType      string           `json:"ref_type,omitempty"`
	RefID        *uuid.UUID       `json:"ref_id,omitempty"`
	DocNo        string           `json:"doc_no,omitempty"`
	Note         string           `json:"note,omitempty"`
	By           string           `json:"by,omitempty"`
}

// Movements lists a product's stock movements in a range (oldest first) with the referenced document number resolved.
func (ReportRepo) Movements(ctx context.Context, storeID, productID uuid.UUID, from, to time.Time) ([]MovementRow, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT m.id, m.occurred_at, m.move_type::text, m.qty_delta::text, m.unit_cost::text, m.balance_after::text,
		COALESCE(m.ref_type,''), m.ref_id,
		COALESCE(CASE m.ref_type
			WHEN 'sale' THEN (SELECT x.doc_no FROM sales x WHERE x.id=m.ref_id)
			WHEN 'sale_return' THEN (SELECT x.doc_no FROM sale_returns x WHERE x.id=m.ref_id)
			WHEN 'purchase_receipt' THEN (SELECT x.doc_no FROM purchase_receipts x WHERE x.id=m.ref_id)
			WHEN 'stock_adjustment' THEN (SELECT x.doc_no FROM stock_adjustments x WHERE x.id=m.ref_id)
			WHEN 'stock_take' THEN (SELECT x.doc_no FROM stock_takes x WHERE x.id=m.ref_id)
		END, ''),
		COALESCE(m.note,''), COALESCE(u.display_name,'')
		FROM stock_movements m LEFT JOIN users u ON u.id=m.created_by
		WHERE m.store_id=$1 AND m.product_id=$2 AND m.occurred_at>=$3 AND m.occurred_at<$4
		ORDER BY m.occurred_at, m.id`, storeID, productID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MovementRow{}
	for rows.Next() {
		var r MovementRow
		var qty, bal string
		var cost *string
		if err := rows.Scan(&r.ID, &r.At, &r.Type, &qty, &cost, &bal, &r.RefType, &r.RefID, &r.DocNo, &r.Note, &r.By); err != nil {
			return nil, err
		}
		r.QtyDelta, r.BalanceAfter, r.UnitCost = dec(qty), dec(bal), decPtr(cost)
		out = append(out, r)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Inventory status / dead stock
// ---------------------------------------------------------------------------

type InventoryFilter struct {
	CategoryID *uuid.UUID
	Q          string
	BelowMin   bool // stock <= min_level1 (min_level1 > 0)
	Zero       bool // stock = 0
	Negative   bool // stock < 0
}

type InventoryRow struct {
	ProductID      uuid.UUID       `json:"product_id"`
	SKU            string          `json:"sku"`
	Name           string          `json:"name"`
	Category       string          `json:"category"`
	Unit           string          `json:"unit"`
	Stock          decimal.Decimal `json:"stock"`
	MinLevel1      decimal.Decimal `json:"min_level1"`
	MinLevel2      decimal.Decimal `json:"min_level2"`
	CostAvg        decimal.Decimal `json:"cost_avg"`
	SellPrice      decimal.Decimal `json:"sell_price"`
	StockValue     decimal.Decimal `json:"stock_value"`
	LastSoldAt     *time.Time      `json:"last_sold_at,omitempty"`
	LastReceivedAt *time.Time      `json:"last_received_at,omitempty"`
}

// InventoryStatus lists active products. When any of BelowMin/Zero/Negative is set, rows must match at least one of the set flags.
func (ReportRepo) InventoryStatus(ctx context.Context, storeID uuid.UUID, f InventoryFilter) ([]InventoryRow, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT p.id, p.sku, p.name, COALESCE(c.name,''), COALESCE(u.name,''), p.stock_on_hand::text, p.min_level1::text, p.min_level2::text,
		p.cost_avg::text, p.sell_price::text, (p.stock_on_hand*p.cost_avg)::text,
		(SELECT max(s.sold_at) FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE l.store_id=$1 AND l.product_id=p.id AND s.status <> 'cancelled'),
		(SELECT max(r.received_at) FROM purchase_receipt_lines l JOIN purchase_receipts r ON r.id=l.receipt_id WHERE l.store_id=$1 AND l.product_id=p.id AND r.status='posted')
		FROM products p LEFT JOIN product_categories c ON c.id=p.category_id LEFT JOIN units u ON u.id=p.unit_id
		WHERE p.store_id=$1 AND p.is_active AND NOT p.is_archived
		AND ($2::uuid IS NULL OR p.category_id=$2::uuid)
		AND ($3='' OR p.sku ILIKE '%'||$3||'%' OR p.name ILIKE '%'||$3||'%')
		AND (NOT ($4::boolean OR $5::boolean OR $6::boolean)
			OR ($4::boolean AND p.min_level1 > 0 AND p.stock_on_hand <= p.min_level1)
			OR ($5::boolean AND p.stock_on_hand = 0)
			OR ($6::boolean AND p.stock_on_hand < 0))
		ORDER BY c.name NULLS LAST, p.name, p.sku`, storeID, f.CategoryID, f.Q, f.BelowMin, f.Zero, f.Negative)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InventoryRow{}
	for rows.Next() {
		var r InventoryRow
		var stock, m1, m2, cost, price, val string
		if err := rows.Scan(&r.ProductID, &r.SKU, &r.Name, &r.Category, &r.Unit, &stock, &m1, &m2, &cost, &price, &val, &r.LastSoldAt, &r.LastReceivedAt); err != nil {
			return nil, err
		}
		r.Stock, r.MinLevel1, r.MinLevel2, r.CostAvg, r.SellPrice = dec(stock), dec(m1), dec(m2), dec(cost), dec(price)
		r.StockValue = dec(val).Round(2)
		out = append(out, r)
	}
	return out, rows.Err()
}

type DeadStockRow struct {
	ProductID  uuid.UUID       `json:"product_id"`
	SKU        string          `json:"sku"`
	Name       string          `json:"name"`
	Category   string          `json:"category"`
	Unit       string          `json:"unit"`
	Stock      decimal.Decimal `json:"stock"`
	CostAvg    decimal.Decimal `json:"cost_avg"`
	StockValue decimal.Decimal `json:"stock_value"`
	LastSoldAt *time.Time      `json:"last_sold_at,omitempty"`
}

// DeadStock lists active products with stock > 0 and no sold line since `since`.
func (ReportRepo) DeadStock(ctx context.Context, storeID uuid.UUID, since time.Time, categoryID *uuid.UUID) ([]DeadStockRow, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT p.id, p.sku, p.name, COALESCE(c.name,''), COALESCE(u.name,''), p.stock_on_hand::text, p.cost_avg::text, (p.stock_on_hand*p.cost_avg)::text,
		(SELECT max(s.sold_at) FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE l.store_id=$1 AND l.product_id=p.id AND s.status <> 'cancelled')
		FROM products p LEFT JOIN product_categories c ON c.id=p.category_id LEFT JOIN units u ON u.id=p.unit_id
		WHERE p.store_id=$1 AND p.is_active AND NOT p.is_archived AND p.stock_on_hand > 0
		AND ($3::uuid IS NULL OR p.category_id=$3::uuid)
		AND NOT EXISTS (SELECT 1 FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE l.store_id=$1 AND l.product_id=p.id AND s.status <> 'cancelled' AND s.sold_at>=$2)
		ORDER BY p.stock_on_hand*p.cost_avg DESC, p.name`, storeID, since, categoryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DeadStockRow{}
	for rows.Next() {
		var r DeadStockRow
		var stock, cost, val string
		if err := rows.Scan(&r.ProductID, &r.SKU, &r.Name, &r.Category, &r.Unit, &stock, &cost, &val, &r.LastSoldAt); err != nil {
			return nil, err
		}
		r.Stock, r.CostAvg, r.StockValue = dec(stock), dec(cost), dec(val).Round(2)
		out = append(out, r)
	}
	return out, rows.Err()
}

// LowStockCount counts active products at or below their reorder level.
func (ReportRepo) LowStockCount(ctx context.Context, storeID uuid.UUID) (int64, error) {
	var n int64
	err := Q(ctx).QueryRow(ctx, `SELECT count(*) FROM products WHERE store_id=$1 AND is_active AND NOT is_archived AND min_level1 > 0 AND stock_on_hand <= min_level1`, storeID).Scan(&n)
	return n, err
}

// ---------------------------------------------------------------------------
// Accounts receivable
// ---------------------------------------------------------------------------

type ARAgingRow struct {
	MemberID   uuid.UUID       `json:"member_id"`
	MemberCode string          `json:"member_code"`
	Name       string          `json:"name"`
	Phone      string          `json:"phone"`
	Bills      int64           `json:"bills"`
	Balance    decimal.Decimal `json:"balance"`
	B0_30      decimal.Decimal `json:"b0_30"`
	B31_60     decimal.Decimal `json:"b31_60"`
	B61_90     decimal.Decimal `json:"b61_90"`
	B90Plus    decimal.Decimal `json:"b90_plus"`
	OldestDue  *time.Time      `json:"oldest_due,omitempty"`
}

// ARAgingByMember buckets each member's open credit bills by age in days relative to asOfDate (YYYY-MM-DD).
// Bills sold after asOfEnd are ignored.
func (ReportRepo) ARAgingByMember(ctx context.Context, storeID uuid.UUID, asOfDate string, asOfEnd time.Time) ([]ARAgingRow, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT m.id, m.member_code, m.name, COALESCE(m.phone,''), count(*), sum(x.bal)::text,
		COALESCE(sum(x.bal) FILTER (WHERE x.age <= 30),0)::text, COALESCE(sum(x.bal) FILTER (WHERE x.age > 30 AND x.age <= 60),0)::text,
		COALESCE(sum(x.bal) FILTER (WHERE x.age > 60 AND x.age <= 90),0)::text, COALESCE(sum(x.bal) FILTER (WHERE x.age > 90),0)::text, min(x.sold_at)
		FROM (SELECT s.member_id, s.ar_balance AS bal, s.sold_at, ($2::date - (s.sold_at AT TIME ZONE '`+reportTZ+`')::date) AS age
			FROM sales s WHERE s.store_id=$1 AND s.status <> 'cancelled' AND s.ar_status IN ('unpaid','partial') AND s.ar_balance > 0 AND s.sold_at < $3) x
		JOIN members m ON m.id=x.member_id
		GROUP BY m.id ORDER BY sum(x.bal) DESC, m.member_code`, storeID, asOfDate, asOfEnd)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ARAgingRow{}
	for rows.Next() {
		var r ARAgingRow
		var bal, b0, b1, b2, b3 string
		if err := rows.Scan(&r.MemberID, &r.MemberCode, &r.Name, &r.Phone, &r.Bills, &bal, &b0, &b1, &b2, &b3, &r.OldestDue); err != nil {
			return nil, err
		}
		r.Balance, r.B0_30, r.B31_60, r.B61_90, r.B90Plus = dec(bal), dec(b0), dec(b1), dec(b2), dec(b3)
		out = append(out, r)
	}
	return out, rows.Err()
}

// AROutstanding is the store-wide open receivable balance.
func (ReportRepo) AROutstanding(ctx context.Context, storeID uuid.UUID) (decimal.Decimal, error) {
	var s string
	err := Q(ctx).QueryRow(ctx, `SELECT COALESCE(sum(ar_balance),0)::text FROM sales WHERE store_id=$1 AND status <> 'cancelled' AND ar_status IN ('unpaid','partial')`, storeID).Scan(&s)
	return dec(s), err
}

type MemberBrief struct {
	ID         uuid.UUID `json:"id"`
	MemberCode string    `json:"member_code"`
	Name       string    `json:"name"`
	Phone      string    `json:"phone"`
}

func (ReportRepo) MemberBrief(ctx context.Context, storeID, memberID uuid.UUID) (*MemberBrief, error) {
	var m MemberBrief
	err := Q(ctx).QueryRow(ctx, `SELECT id, member_code, name, COALESCE(phone,'') FROM members WHERE store_id=$1 AND id=$2`, storeID, memberID).Scan(&m.ID, &m.MemberCode, &m.Name, &m.Phone)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrMemberNotFound
	}
	return &m, err
}

// ARBalanceBefore returns a member's receivable balance before `at`: Σ credit granted − Σ payments received.
func (ReportRepo) ARBalanceBefore(ctx context.Context, storeID, memberID uuid.UUID, at time.Time) (decimal.Decimal, error) {
	var credit, paid string
	err := Q(ctx).QueryRow(ctx, `SELECT
		COALESCE((SELECT sum(s.ar_total) FROM sales s WHERE s.store_id=$1 AND s.member_id=$2 AND s.status <> 'cancelled' AND s.ar_status <> 'none' AND s.sold_at < $3),0)::text,
		COALESCE((SELECT sum(p.amount) FROM ar_payments p WHERE p.store_id=$1 AND p.member_id=$2 AND p.paid_at < $3),0)::text`, storeID, memberID, at).Scan(&credit, &paid)
	if err != nil {
		return decimal.Zero, err
	}
	return dec(credit).Sub(dec(paid)), nil
}

type ARStatementRow struct {
	Kind      string          `json:"kind"` // sale | payment
	ID        uuid.UUID       `json:"id"`
	DocNo     string          `json:"doc_no"`
	At        time.Time       `json:"at"`
	SaleDocNo string          `json:"sale_doc_no,omitempty"` // payment: the bill it was applied to
	Net       decimal.Decimal `json:"net"`                   // sale: bill net
	Debit     decimal.Decimal `json:"debit"`                 // sale: ar_total
	Credit    decimal.Decimal `json:"credit"`                // payment: amount
	Method    string          `json:"method,omitempty"`
	Note      string          `json:"note,omitempty"`
	Balance   decimal.Decimal `json:"balance"` // running balance (filled by the use case)
}

// ARStatementRows lists a member's credit sales and payments in a range, oldest first.
func (ReportRepo) ARStatementRows(ctx context.Context, storeID, memberID uuid.UUID, from, to time.Time) ([]ARStatementRow, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT * FROM (
		SELECT 'sale' AS kind, s.id, s.doc_no, s.sold_at AS at, ''::text AS sale_doc_no, s.net::text AS net, s.ar_total::text AS debit, '0'::text AS credit, ''::text AS method, COALESCE(s.note,'') AS note
			FROM sales s WHERE s.store_id=$1 AND s.member_id=$2 AND s.status <> 'cancelled' AND s.ar_status <> 'none' AND s.sold_at>=$3 AND s.sold_at<$4
		UNION ALL
		SELECT 'payment', p.id, COALESCE(p.doc_no,''), p.paid_at, COALESCE(x.doc_no, p.legacy_bill_no, ''), '0', '0', p.amount::text, p.method::text, COALESCE(p.note,'')
			FROM ar_payments p LEFT JOIN sales x ON x.id=p.sale_id WHERE p.store_id=$1 AND p.member_id=$2 AND p.paid_at>=$3 AND p.paid_at<$4
		) e ORDER BY e.at, e.kind DESC, e.doc_no`, storeID, memberID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ARStatementRow{}
	for rows.Next() {
		var r ARStatementRow
		var net, debit, credit string
		if err := rows.Scan(&r.Kind, &r.ID, &r.DocNo, &r.At, &r.SaleDocNo, &net, &debit, &credit, &r.Method, &r.Note); err != nil {
			return nil, err
		}
		r.Net, r.Debit, r.Credit = dec(net), dec(debit), dec(credit)
		out = append(out, r)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

type SupplierPurchaseRow struct {
	SupplierID *uuid.UUID      `json:"supplier_id"`
	Supplier   string          `json:"supplier"`
	Receipts   int64           `json:"receipts"`
	Total      decimal.Decimal `json:"total"`
}

func (ReportRepo) SupplierPurchases(ctx context.Context, storeID uuid.UUID, from, to time.Time) ([]SupplierPurchaseRow, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT r.supplier_id, COALESCE(sp.name,''), count(*), COALESCE(sum(r.total),0)::text
		FROM purchase_receipts r LEFT JOIN suppliers sp ON sp.id=r.supplier_id
		WHERE r.store_id=$1 AND r.received_at>=$2 AND r.received_at<$3 AND r.status='posted'
		GROUP BY 1,2 ORDER BY sum(r.total) DESC, 2`, storeID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SupplierPurchaseRow{}
	for rows.Next() {
		var r SupplierPurchaseRow
		var total string
		if err := rows.Scan(&r.SupplierID, &r.Supplier, &r.Receipts, &total); err != nil {
			return nil, err
		}
		r.Total = dec(total)
		out = append(out, r)
	}
	return out, rows.Err()
}

type PurchaseRow struct {
	ID          uuid.UUID       `json:"id"`
	DocNo       string          `json:"doc_no"`
	SupplierID  *uuid.UUID      `json:"supplier_id,omitempty"`
	Supplier    string          `json:"supplier"`
	SupplierRef string          `json:"supplier_ref,omitempty"`
	ReceivedAt  time.Time       `json:"received_at"`
	ReceivedBy  string          `json:"received_by,omitempty"`
	Status      string          `json:"status"`
	Lines       int64           `json:"lines"`
	Qty         decimal.Decimal `json:"qty"`
	Subtotal    decimal.Decimal `json:"subtotal"`
	VAT         decimal.Decimal `json:"vat"`
	Total       decimal.Decimal `json:"total"`
}

// Purchases lists receipts in a range (drafts excluded), newest first.
func (ReportRepo) Purchases(ctx context.Context, storeID uuid.UUID, from, to time.Time, supplierID *uuid.UUID) ([]PurchaseRow, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT r.id, r.doc_no, r.supplier_id, COALESCE(sp.name,''), COALESCE(r.supplier_ref,''), r.received_at, COALESCE(r.received_by_name, u.display_name, ''),
		r.status::text, (SELECT count(*) FROM purchase_receipt_lines l WHERE l.receipt_id=r.id), COALESCE((SELECT sum(l.qty) FROM purchase_receipt_lines l WHERE l.receipt_id=r.id),0)::text,
		r.subtotal::text, r.vat::text, r.total::text
		FROM purchase_receipts r LEFT JOIN suppliers sp ON sp.id=r.supplier_id LEFT JOIN users u ON u.id=r.received_by
		WHERE r.store_id=$1 AND r.received_at>=$2 AND r.received_at<$3 AND r.status <> 'draft' AND ($4::uuid IS NULL OR r.supplier_id=$4::uuid)
		ORDER BY r.received_at DESC, r.doc_no DESC`, storeID, from, to, supplierID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PurchaseRow{}
	for rows.Next() {
		var r PurchaseRow
		var qty, sub, vat, total string
		if err := rows.Scan(&r.ID, &r.DocNo, &r.SupplierID, &r.Supplier, &r.SupplierRef, &r.ReceivedAt, &r.ReceivedBy, &r.Status, &r.Lines, &qty, &sub, &vat, &total); err != nil {
			return nil, err
		}
		r.Qty, r.Subtotal, r.VAT, r.Total = dec(qty), dec(sub), dec(vat), dec(total)
		out = append(out, r)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

type ExpensePeriodRow struct {
	Period string          `json:"period,omitempty"`
	TypeID *uuid.UUID      `json:"type_id"`
	Type   string          `json:"type"`
	Count  int64           `json:"count"`
	Amount decimal.Decimal `json:"amount"`
}

// ExpensesByType sums expenses per type per period. group ∈ day|month|"" ("" = one bucket per type for the whole range).
// fromDate/toDate are inclusive YYYY-MM-DD strings (expenses.expensed_at is a date).
func (ReportRepo) ExpensesByType(ctx context.Context, storeID uuid.UUID, fromDate, toDate, group string) ([]ExpensePeriodRow, error) {
	period := `''::text`
	switch group {
	case "day":
		period = `to_char(e.expensed_at, 'YYYY-MM-DD')`
	case "month":
		period = `to_char(e.expensed_at, 'YYYY-MM')`
	}
	rows, err := Q(ctx).Query(ctx, `SELECT `+period+`, e.type_id, COALESCE(t.name,''), count(*), COALESCE(sum(e.amount),0)::text
		FROM expenses e LEFT JOIN expense_types t ON t.id=e.type_id
		WHERE e.store_id=$1 AND e.expensed_at>=$2::date AND e.expensed_at<=$3::date
		GROUP BY 1,2,3 ORDER BY 1, 3`, storeID, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ExpensePeriodRow{}
	for rows.Next() {
		var r ExpensePeriodRow
		var amt string
		if err := rows.Scan(&r.Period, &r.TypeID, &r.Type, &r.Count, &amt); err != nil {
			return nil, err
		}
		r.Amount = dec(amt)
		out = append(out, r)
	}
	return out, rows.Err()
}

type ShiftExpenseRow struct {
	ID         uuid.UUID       `json:"id"`
	Type       string          `json:"type"`
	ExpensedAt string          `json:"expensed_at"`
	Amount     decimal.Decimal `json:"amount"`
	PaidFrom   string          `json:"paid_from"`
	Note       string          `json:"note,omitempty"`
	By         string          `json:"by,omitempty"`
}

func (ReportRepo) ExpensesByShift(ctx context.Context, storeID, shiftID uuid.UUID) ([]ShiftExpenseRow, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT e.id, COALESCE(t.name,''), to_char(e.expensed_at,'YYYY-MM-DD'), e.amount::text, e.paid_from::text, COALESCE(e.note,''), COALESCE(e.created_by_name,'')
		FROM expenses e LEFT JOIN expense_types t ON t.id=e.type_id WHERE e.store_id=$1 AND e.shift_id=$2 ORDER BY e.created_at`, storeID, shiftID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ShiftExpenseRow{}
	for rows.Next() {
		var r ShiftExpenseRow
		var amt string
		if err := rows.Scan(&r.ID, &r.Type, &r.ExpensedAt, &amt, &r.PaidFrom, &r.Note, &r.By); err != nil {
			return nil, err
		}
		r.Amount = dec(amt)
		out = append(out, r)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Monthly chart (materialized view)
// ---------------------------------------------------------------------------

type MonthRow struct {
	Month int             `json:"month_index"`
	Bills int64           `json:"bills"`
	Net   decimal.Decimal `json:"net"`
}

// MonthlyMVPopulated reports whether monthly_sales_mv has been refreshed at least once.
func (ReportRepo) MonthlyMVPopulated(ctx context.Context) (bool, error) {
	var ok bool
	err := Q(ctx).QueryRow(ctx, `SELECT COALESCE((SELECT relispopulated FROM pg_class WHERE relname='monthly_sales_mv' AND relkind='m' LIMIT 1), false)`).Scan(&ok)
	return ok, err
}

// MonthlyFromMV reads one calendar year (Bangkok months) from monthly_sales_mv.
func (ReportRepo) MonthlyFromMV(ctx context.Context, storeID uuid.UUID, year int) ([]MonthRow, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT extract(month FROM month)::int, bills, net::text FROM monthly_sales_mv
		WHERE store_id=$1 AND month >= make_date($2,1,1) AND month < make_date($2+1,1,1) ORDER BY 1`, storeID, year)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMonths(rows)
}

// MonthlyLive computes the same aggregate as monthly_sales_mv directly from sales (used when the MV is not populated).
func (ReportRepo) MonthlyLive(ctx context.Context, storeID uuid.UUID, from, to time.Time) ([]MonthRow, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT extract(month FROM sold_at AT TIME ZONE '`+reportTZ+`')::int, count(*), COALESCE(sum(net),0)::text
		FROM sales WHERE store_id=$1 AND status='completed' AND sold_at>=$2 AND sold_at<$3 GROUP BY 1 ORDER BY 1`, storeID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMonths(rows)
}

func scanMonths(rows pgx.Rows) ([]MonthRow, error) {
	out := []MonthRow{}
	for rows.Next() {
		var r MonthRow
		var net string
		if err := rows.Scan(&r.Month, &r.Bills, &net); err != nil {
			return nil, err
		}
		r.Net = dec(net)
		out = append(out, r)
	}
	return out, rows.Err()
}

// RefreshMonthlyMV rebuilds monthly_sales_mv. CONCURRENTLY requires a populated view, so the first
// refresh is a plain (locking) one. The view spans all tenants: callers must run it with Scope{Bypass: true}
// so that RLS does not silently drop other stores' rows from the rebuilt view.
func (ReportRepo) RefreshMonthlyMV(ctx context.Context) error {
	populated, err := ReportRepo{}.MonthlyMVPopulated(ctx)
	if err != nil {
		return err
	}
	stmt := `REFRESH MATERIALIZED VIEW monthly_sales_mv`
	if populated {
		stmt = `REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_sales_mv`
	}
	_, err = Q(ctx).Exec(ctx, stmt)
	return err
}
