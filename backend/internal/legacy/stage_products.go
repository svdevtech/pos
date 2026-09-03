package legacy

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/repository/postgres"
)

// stageProducts imports product (active) and delproducts (archived), primary barcodes, price tiers,
// and opening stock movements.
func (im *Importer) stageProducts(ctx context.Context, sr *StageReport) error {
	if err := im.loadCaches(ctx); err != nil {
		return err
	}
	q := postgres.Q(ctx)
	// names of deleted products for placeholders later
	_ = EachRow(im.m.Path("delproducts"), func(_ int, r Row) error {
		im.delNames[r.Str("pro_id")] = r.Str("pro_name")
		return nil
	})

	upsert := func(r Row, archived bool) error {
		sr.RowsIn++
		legacyID := r.Str("pro_id")
		if legacyID == "" {
			sr.Skipped++
			im.warn("products", "row without pro_id skipped")
			return nil
		}
		catID, ok := im.categories[r.Str("brand_id")]
		if !ok {
			catID = im.categories[""]
			im.warn("products", "product "+legacyID+": unknown category "+r.Str("brand_id"))
		}
		var unitID *uuid.UUID
		if u, ok := im.units[r.Str("pro_model")]; ok {
			unitID = &u
		}
		name := r.Str("pro_name")
		if name == "" {
			name = "[NO NAME] " + legacyID
		}
		var reason any
		if archived {
			reason = "deleted"
		}
		var id uuid.UUID
		var isNew bool
		err := q.QueryRow(ctx, `INSERT INTO products (store_id, sku, name, category_id, unit_id, cost_last, cost_avg, sell_price, stock_on_hand, min_level1, min_level2, is_serial, is_active, is_archived, archived_reason, archived_at, legacy_id)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,$12,$13,$14,CASE WHEN $13 THEN now() END,$2)
			ON CONFLICT (store_id, legacy_id) WHERE legacy_id IS NOT NULL DO UPDATE SET
				name=EXCLUDED.name, category_id=EXCLUDED.category_id, unit_id=EXCLUDED.unit_id, cost_last=EXCLUDED.cost_last, cost_avg=EXCLUDED.cost_avg,
				sell_price=EXCLUDED.sell_price, min_level1=EXCLUDED.min_level1, min_level2=EXCLUDED.min_level2, is_serial=EXCLUDED.is_serial
			RETURNING id, (xmax = 0)`,
			im.storeID, legacyID, name, catID, unitID, r.Dec("pro_costprice"), r.Dec("pro_costpriceavg"), r.Dec("pro_buyprice"),
			r.Dec("pro_minlevel1"), r.Dec("pro_minlevel2"), strings.EqualFold(r.Str("pro_serialstatus"), "YES"), !archived, archived, reason).Scan(&id, &isNew)
		if err != nil {
			// sku collision between an active and a deleted product with the same id → keep the active one
			if !archived {
				return fmt.Errorf("product %s: %w", legacyID, err)
			}
			sr.Skipped++
			im.warn("products", "deleted product "+legacyID+" collides with active product; skipped")
			return nil
		}
		im.products[legacyID] = id
		im.prodInfo[legacyID] = prodMeta{Name: name, CostAvg: r.Dec("pro_costpriceavg").String()}
		// barcode = legacy id without the Code39 '*' wrapper
		bc := strings.Trim(r.Str("pro_barcode"), "*")
		if bc == "" {
			bc = legacyID
		}
		if _, err := q.Exec(ctx, `INSERT INTO product_barcodes (store_id, product_id, barcode, is_primary) VALUES ($1,$2,$3,true) ON CONFLICT (store_id, barcode) DO NOTHING`, im.storeID, id, bc); err != nil {
			return fmt.Errorf("barcode %s: %w", bc, err)
		}
		for tier := 1; tier <= 4; tier++ {
			p := r.Dec(fmt.Sprintf("pro_buypricelevel%d", tier))
			if p.IsPositive() {
				if _, err := q.Exec(ctx, `INSERT INTO price_tiers (product_id, tier, price) VALUES ($1,$2,$3) ON CONFLICT (product_id, tier) DO UPDATE SET price=EXCLUDED.price`, id, tier, p); err != nil {
					return err
				}
			}
		}
		// opening stock: only once (no movements yet for this product)
		if isNew {
			stock := r.Dec("pro_stock")
			if !stock.IsZero() {
				cost := r.Dec("pro_costpriceavg")
				if _, err := (postgres.StockRepo{}).Apply(ctx, im.storeID, id, "opening", stock, &cost, "legacy", nil, "legacy opening stock", nil); err != nil {
					return fmt.Errorf("opening stock %s: %w", legacyID, err)
				}
				if stock.IsNegative() {
					sr.Extra["negative_stock"] = asInt(sr.Extra["negative_stock"]) + 1
				}
			}
		} else {
			sr.Skipped++
		}
		sr.RowsOut++
		return nil
	}
	if err := EachRow(im.m.Path("product"), func(_ int, r Row) error { return upsert(r, false) }); err != nil {
		return err
	}
	if err := EachRow(im.m.Path("delproducts"), func(_ int, r Row) error { return upsert(r, true) }); err != nil {
		return err
	}
	return nil
}

// placeholderProduct creates (once) an archived product for a legacy id referenced by sales/receipts but
// missing from product/delproducts.
func (im *Importer) placeholderProduct(ctx context.Context, legacyID string) (uuid.UUID, error) {
	if id, ok := im.products[legacyID]; ok {
		return id, nil
	}
	name := im.delNames[legacyID]
	if name == "" {
		name = "[ARCHIVED] " + legacyID
	} else {
		name = "[ARCHIVED] " + name
	}
	var id uuid.UUID
	err := postgres.Q(ctx).QueryRow(ctx, `INSERT INTO products (store_id, sku, name, category_id, is_active, is_archived, archived_reason, archived_at, legacy_id)
		VALUES ($1,$2,$3,$4,false,true,'placeholder_orphan',now(),$2)
		ON CONFLICT (store_id, legacy_id) WHERE legacy_id IS NOT NULL DO UPDATE SET name=products.name RETURNING id`, im.storeID, legacyID, name, im.categories[""]).Scan(&id)
	if err != nil {
		return uuid.Nil, fmt.Errorf("placeholder product %s: %w", legacyID, err)
	}
	im.products[legacyID] = id
	im.prodInfo[legacyID] = prodMeta{Name: name, CostAvg: "0"}
	return id, nil
}

func asInt(v any) int {
	if i, ok := v.(int); ok {
		return i
	}
	return 0
}

var _ = decimal.Zero
