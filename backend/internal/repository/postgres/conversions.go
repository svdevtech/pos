package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/svdev/pos/internal/domain"
)

// ConversionRepo stores the unit-conversion rules (1 ลัง = 12 ขวด) and the posted CV documents.
type ConversionRepo struct{}

const conversionRuleCols = `c.id, c.store_id, c.from_product_id, fp.sku, fp.name, COALESCE(fu.name,''), fp.stock_on_hand::text,
	c.to_product_id, tp.sku, tp.name, COALESCE(tu.name,''), tp.stock_on_hand::text,
	c.factor::text, c.is_active, COALESCE(c.note,''), c.created_at, c.updated_at`

const conversionRuleFrom = `FROM product_conversions c
	JOIN products fp ON fp.id = c.from_product_id
	LEFT JOIN units fu ON fu.id = fp.unit_id
	JOIN products tp ON tp.id = c.to_product_id
	LEFT JOIN units tu ON tu.id = tp.unit_id`

func scanRule(row pgx.Row) (*domain.ProductConversion, error) {
	var c domain.ProductConversion
	var factor, fromStock, toStock string
	if err := row.Scan(&c.ID, &c.StoreID, &c.FromProductID, &c.FromSKU, &c.FromName, &c.FromUnit, &fromStock,
		&c.ToProductID, &c.ToSKU, &c.ToName, &c.ToUnit, &toStock,
		&factor, &c.IsActive, &c.Note, &c.CreatedAt, &c.UpdatedAt); err != nil {
		return nil, err
	}
	c.Factor, c.FromStock, c.ToStock = dec(factor), dec(fromStock), dec(toStock)
	return &c, nil
}

// ListRules returns the store's rules, active ones first.
func (ConversionRepo) ListRules(ctx context.Context, storeID uuid.UUID, activeOnly bool) ([]domain.ProductConversion, error) {
	sql := `SELECT ` + conversionRuleCols + ` ` + conversionRuleFrom + ` WHERE c.store_id=$1`
	if activeOnly {
		sql += ` AND c.is_active`
	}
	sql += ` ORDER BY c.is_active DESC, fp.name, tp.name`
	rows, err := Q(ctx).Query(ctx, sql, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.ProductConversion{}
	for rows.Next() {
		c, err := scanRule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// RulesFrom returns the active rules that start at one product (what a scanned pack can become).
func (r ConversionRepo) RulesFrom(ctx context.Context, storeID, productID uuid.UUID) ([]domain.ProductConversion, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT `+conversionRuleCols+` `+conversionRuleFrom+
		` WHERE c.store_id=$1 AND c.from_product_id=$2 AND c.is_active ORDER BY tp.name`, storeID, productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.ProductConversion{}
	for rows.Next() {
		c, err := scanRule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

func (ConversionRepo) GetRule(ctx context.Context, storeID, id uuid.UUID) (*domain.ProductConversion, error) {
	c, err := scanRule(Q(ctx).QueryRow(ctx, `SELECT `+conversionRuleCols+` `+conversionRuleFrom+` WHERE c.store_id=$1 AND c.id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return c, err
}

// FindRule looks a pair up; missing pairs are not an error for the caller to distinguish.
func (ConversionRepo) FindRule(ctx context.Context, storeID, fromID, toID uuid.UUID) (*domain.ProductConversion, error) {
	c, err := scanRule(Q(ctx).QueryRow(ctx, `SELECT `+conversionRuleCols+` `+conversionRuleFrom+
		` WHERE c.store_id=$1 AND c.from_product_id=$2 AND c.to_product_id=$3`, storeID, fromID, toID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return c, err
}

// UpsertRule creates the pair or updates its factor/note/status.
func (ConversionRepo) UpsertRule(ctx context.Context, c *domain.ProductConversion) error {
	err := Q(ctx).QueryRow(ctx, `INSERT INTO product_conversions (store_id, from_product_id, to_product_id, factor, is_active, note)
		VALUES ($1,$2,$3,$4::numeric,$5,NULLIF($6,''))
		ON CONFLICT (store_id, from_product_id, to_product_id)
		DO UPDATE SET factor=EXCLUDED.factor, is_active=EXCLUDED.is_active, note=EXCLUDED.note, updated_at=now()
		RETURNING id`, c.StoreID, c.FromProductID, c.ToProductID, c.Factor.String(), c.IsActive, c.Note).Scan(&c.ID)
	return err
}

func (ConversionRepo) SetRuleActive(ctx context.Context, storeID, id uuid.UUID, active bool) error {
	tag, err := Q(ctx).Exec(ctx, `UPDATE product_conversions SET is_active=$3, updated_at=now() WHERE store_id=$1 AND id=$2`, storeID, id, active)
	if err == nil && tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return err
}

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------

const conversionDocCols = `v.id, v.store_id, v.doc_no, v.from_product_id, fp.sku, fp.name, COALESCE(fu.name,''),
	v.to_product_id, tp.sku, tp.name, COALESCE(tu.name,''),
	v.from_qty::text, v.to_qty::text, v.factor::text, v.unit_cost::text, v.total_cost::text,
	COALESCE(v.note,''), v.converted_at, v.created_by, COALESCE(u.display_name,'')`

const conversionDocFrom = `FROM stock_conversions v
	JOIN products fp ON fp.id = v.from_product_id
	LEFT JOIN units fu ON fu.id = fp.unit_id
	JOIN products tp ON tp.id = v.to_product_id
	LEFT JOIN units tu ON tu.id = tp.unit_id
	LEFT JOIN users u ON u.id = v.created_by`

func scanConversion(row pgx.Row) (*domain.StockConversion, error) {
	var c domain.StockConversion
	var fromQty, toQty, factor, unitCost, totalCost string
	if err := row.Scan(&c.ID, &c.StoreID, &c.DocNo, &c.FromProductID, &c.FromSKU, &c.FromName, &c.FromUnit,
		&c.ToProductID, &c.ToSKU, &c.ToName, &c.ToUnit,
		&fromQty, &toQty, &factor, &unitCost, &totalCost,
		&c.Note, &c.ConvertedAt, &c.CreatedBy, &c.CreatedByName); err != nil {
		return nil, err
	}
	c.FromQty, c.ToQty, c.Factor = dec(fromQty), dec(toQty), dec(factor)
	c.UnitCost, c.TotalCost = dec(unitCost), dec(totalCost)
	return &c, nil
}

func (ConversionRepo) Create(ctx context.Context, c *domain.StockConversion) error {
	return Q(ctx).QueryRow(ctx, `INSERT INTO stock_conversions
		(store_id, doc_no, from_product_id, to_product_id, from_qty, to_qty, factor, unit_cost, total_cost, note, converted_at, created_by)
		VALUES ($1,$2,$3,$4,$5::numeric,$6::numeric,$7::numeric,$8::numeric,$9::numeric,NULLIF($10,''),$11,$12) RETURNING id`,
		c.StoreID, c.DocNo, c.FromProductID, c.ToProductID, c.FromQty.String(), c.ToQty.String(), c.Factor.String(),
		c.UnitCost.String(), c.TotalCost.String(), c.Note, c.ConvertedAt, c.CreatedBy).Scan(&c.ID)
}

func (ConversionRepo) Get(ctx context.Context, storeID, id uuid.UUID) (*domain.StockConversion, error) {
	c, err := scanConversion(Q(ctx).QueryRow(ctx, `SELECT `+conversionDocCols+` `+conversionDocFrom+` WHERE v.store_id=$1 AND v.id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return c, err
}

func (ConversionRepo) List(ctx context.Context, storeID uuid.UUID, limit, offset int) ([]domain.StockConversion, int64, error) {
	var total int64
	if err := Q(ctx).QueryRow(ctx, `SELECT count(*) FROM stock_conversions WHERE store_id=$1`, storeID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := Q(ctx).Query(ctx, `SELECT `+conversionDocCols+` `+conversionDocFrom+
		` WHERE v.store_id=$1 ORDER BY v.converted_at DESC LIMIT $2 OFFSET $3`, storeID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []domain.StockConversion{}
	for rows.Next() {
		c, err := scanConversion(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *c)
	}
	return out, total, rows.Err()
}
