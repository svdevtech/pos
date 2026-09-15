package postgres

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// ---------------------------------------------------------------------------
// F&B reports: what sold, what it cost, what the kitchen used and threw away
// ---------------------------------------------------------------------------

// MenuSalesRow is one dish over a period: paid orders only, voided lines left out.
type MenuSalesRow struct {
	MenuItemID *uuid.UUID
	Name       string
	Category   string
	Qty        decimal.Decimal
	Revenue    decimal.Decimal // Σ (unit price + options) × qty
	Cost       decimal.Decimal // Σ recipe cost
	Orders     int
}

func (FnbRepo) MenuSales(ctx context.Context, storeID uuid.UUID, from, to time.Time) ([]MenuSalesRow, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT i.menu_item_id, i.name, COALESCE(c.name,''),
			sum(i.qty)::text,
			sum((i.unit_price + COALESCE((SELECT sum(m.price_delta) FROM order_item_modifiers m WHERE m.order_item_id = i.id),0)) * i.qty)::text,
			sum(i.cost)::text, count(DISTINCT i.order_id)
		FROM order_items i
		JOIN orders o ON o.id = i.order_id
		LEFT JOIN menu_items mi ON mi.id = i.menu_item_id
		LEFT JOIN menu_categories c ON c.id = mi.category_id
		WHERE i.store_id=$1 AND o.status IN ('paid','closed') AND i.status <> 'void' AND o.created_at >= $2 AND o.created_at < $3
		GROUP BY i.menu_item_id, i.name, c.name
		ORDER BY 4 DESC`, storeID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MenuSalesRow{}
	for rows.Next() {
		var r MenuSalesRow
		var qty, rev, cost string
		if err := rows.Scan(&r.MenuItemID, &r.Name, &r.Category, &qty, &rev, &cost, &r.Orders); err != nil {
			return nil, err
		}
		r.Qty, r.Revenue, r.Cost = dec(qty), dec(rev), dec(cost)
		out = append(out, r)
	}
	return out, rows.Err()
}

// IngredientUsageRow is one ingredient over a period: what recipes took, what was written off
// as waste (a void after the dish was made), and what both cost at average cost.
type IngredientUsageRow struct {
	ProductID uuid.UUID
	Name      string
	Unit      string
	Used      decimal.Decimal
	UsedCost  decimal.Decimal
	Waste     decimal.Decimal
	WasteCost decimal.Decimal
	OnHand    decimal.Decimal
}

func (FnbRepo) IngredientUsage(ctx context.Context, storeID uuid.UUID, from, to time.Time) ([]IngredientUsageRow, error) {
	// a waste marker is a zero-quantity movement whose note carries the quantity ("void after made: 18.9")
	rows, err := Q(ctx).Query(ctx, `SELECT p.id, p.name, COALESCE(u.name,''), p.stock_on_hand::text,
			COALESCE(sum(CASE WHEN m.move_type='recipe' AND m.qty_delta < 0 THEN -m.qty_delta ELSE 0 END),0)::text,
			COALESCE(sum(CASE WHEN m.move_type='recipe' AND m.qty_delta < 0 THEN -m.qty_delta * COALESCE(m.unit_cost,0) ELSE 0 END),0)::text,
			COALESCE(sum(CASE WHEN m.move_type='waste' THEN NULLIF(regexp_replace(COALESCE(m.note,''), '^void after made: ', ''), '')::numeric ELSE 0 END),0)::text,
			COALESCE(sum(CASE WHEN m.move_type='waste' THEN NULLIF(regexp_replace(COALESCE(m.note,''), '^void after made: ', ''), '')::numeric * COALESCE(m.unit_cost,0) ELSE 0 END),0)::text
		FROM stock_movements m
		JOIN products p ON p.id = m.product_id
		LEFT JOIN units u ON u.id = p.unit_id
		WHERE m.store_id=$1 AND m.move_type IN ('recipe','waste') AND m.occurred_at >= $2 AND m.occurred_at < $3
		GROUP BY p.id, p.name, u.name, p.stock_on_hand
		ORDER BY 6 DESC`, storeID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []IngredientUsageRow{}
	for rows.Next() {
		var r IngredientUsageRow
		var onHand, used, usedCost, waste, wasteCost string
		if err := rows.Scan(&r.ProductID, &r.Name, &r.Unit, &onHand, &used, &usedCost, &waste, &wasteCost); err != nil {
			return nil, err
		}
		r.OnHand, r.Used, r.UsedCost, r.Waste, r.WasteCost = dec(onHand), dec(used), dec(usedCost), dec(waste), dec(wasteCost)
		out = append(out, r)
	}
	return out, rows.Err()
}

// HourRow is one hour of the day across the period: orders and what they came to.
type HourRow struct {
	Hour    int
	Orders  int
	Items   decimal.Decimal
	Revenue decimal.Decimal
}

func (FnbRepo) HourlySales(ctx context.Context, storeID uuid.UUID, from, to time.Time) ([]HourRow, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT extract(hour FROM o.created_at AT TIME ZONE 'Asia/Bangkok')::int AS h, count(DISTINCT o.id),
			COALESCE(sum(i.qty),0)::text,
			COALESCE(sum((i.unit_price + COALESCE((SELECT sum(m.price_delta) FROM order_item_modifiers m WHERE m.order_item_id = i.id),0)) * i.qty),0)::text
		FROM orders o
		LEFT JOIN order_items i ON i.order_id = o.id AND i.status <> 'void'
		WHERE o.store_id=$1 AND o.status IN ('paid','closed') AND o.created_at >= $2 AND o.created_at < $3
		GROUP BY h ORDER BY h`, storeID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HourRow{}
	for rows.Next() {
		var r HourRow
		var items, rev string
		if err := rows.Scan(&r.Hour, &r.Orders, &items, &rev); err != nil {
			return nil, err
		}
		r.Items, r.Revenue = dec(items), dec(rev)
		out = append(out, r)
	}
	return out, rows.Err()
}

// StoreSummaryRow is one store on the head-office screen. Runs with RLS bypassed.
type StoreSummaryRow struct {
	StoreID    uuid.UUID
	Code       string
	Name       string
	Kind       string
	Bills      int
	Net        decimal.Decimal
	OpenOrders int
}

func (FnbRepo) StoreSummaries(ctx context.Context, from, to time.Time) ([]StoreSummaryRow, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT s.id, s.code, s.name, s.kind::text,
			(SELECT count(*) FROM sales x WHERE x.store_id = s.id AND x.status='completed' AND x.sold_at >= $1 AND x.sold_at < $2),
			COALESCE((SELECT sum(x.net) FROM sales x WHERE x.store_id = s.id AND x.status='completed' AND x.sold_at >= $1 AND x.sold_at < $2),0)::text,
			(SELECT count(*) FROM orders o WHERE o.store_id = s.id AND o.status IN ('open','paid'))
		FROM stores s WHERE s.is_active ORDER BY s.code`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []StoreSummaryRow{}
	for rows.Next() {
		var r StoreSummaryRow
		var net string
		if err := rows.Scan(&r.StoreID, &r.Code, &r.Name, &r.Kind, &r.Bills, &net, &r.OpenOrders); err != nil {
			return nil, err
		}
		r.Net = dec(net)
		out = append(out, r)
	}
	return out, rows.Err()
}
