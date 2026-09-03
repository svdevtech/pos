package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
)

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const categoryCols = `id, store_id, name, COALESCE(name_en,''), sort_order, is_active, created_at, updated_at`

func scanCategory(row pgx.Row) (*domain.Category, error) {
	var c domain.Category
	if err := row.Scan(&c.ID, &c.StoreID, &c.Name, &c.NameEN, &c.SortOrder, &c.IsActive, &c.CreatedAt, &c.UpdatedAt); err != nil {
		return nil, err
	}
	return &c, nil
}

type CategoryRepo struct{}

func (CategoryRepo) List(ctx context.Context, storeID uuid.UUID) ([]domain.Category, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT `+categoryCols+` FROM product_categories WHERE store_id=$1 ORDER BY sort_order, name`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Category{}
	for rows.Next() {
		c, err := scanCategory(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

func (CategoryRepo) Get(ctx context.Context, storeID, id uuid.UUID) (*domain.Category, error) {
	c, err := scanCategory(Q(ctx).QueryRow(ctx, `SELECT `+categoryCols+` FROM product_categories WHERE store_id=$1 AND id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return c, err
}

func (CategoryRepo) Create(ctx context.Context, c *domain.Category) error {
	err := Q(ctx).QueryRow(ctx, `INSERT INTO product_categories (store_id, name, name_en, sort_order, is_active)
		VALUES ($1,$2,NULLIF($3,''),$4,$5) RETURNING id, created_at, updated_at`,
		c.StoreID, c.Name, c.NameEN, c.SortOrder, c.IsActive).Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt)
	if isUniqueViolation(err) {
		return domain.ErrConflict.With("field", "name")
	}
	return err
}

func (CategoryRepo) Update(ctx context.Context, c *domain.Category) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE product_categories SET name=$3, name_en=NULLIF($4,''), sort_order=$5, is_active=$6 WHERE store_id=$1 AND id=$2`,
		c.StoreID, c.ID, c.Name, c.NameEN, c.SortOrder, c.IsActive)
	if isUniqueViolation(err) {
		return domain.ErrConflict.With("field", "name")
	}
	return err
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

type UnitRepo struct{}

// List returns every unit with how many products use it (inactive ones included: they are still
// shown on the settings screen so they can be switched back on).
func (UnitRepo) List(ctx context.Context, storeID uuid.UUID) ([]domain.Unit, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT u.id, u.store_id, u.name, COALESCE(u.name_en,''), u.is_active, u.created_at,
			(SELECT count(*) FROM products p WHERE p.unit_id = u.id AND NOT p.is_archived)
		FROM units u WHERE u.store_id=$1 ORDER BY u.is_active DESC, u.name`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Unit{}
	for rows.Next() {
		var u domain.Unit
		if err := rows.Scan(&u.ID, &u.StoreID, &u.Name, &u.NameEN, &u.IsActive, &u.CreatedAt, &u.ProductCount); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (UnitRepo) Get(ctx context.Context, storeID, id uuid.UUID) (*domain.Unit, error) {
	var u domain.Unit
	err := Q(ctx).QueryRow(ctx, `SELECT u.id, u.store_id, u.name, COALESCE(u.name_en,''), u.is_active, u.created_at,
			(SELECT count(*) FROM products p WHERE p.unit_id = u.id AND NOT p.is_archived)
		FROM units u WHERE u.store_id=$1 AND u.id=$2`, storeID, id).
		Scan(&u.ID, &u.StoreID, &u.Name, &u.NameEN, &u.IsActive, &u.CreatedAt, &u.ProductCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (UnitRepo) Create(ctx context.Context, u *domain.Unit) error {
	err := Q(ctx).QueryRow(ctx, `INSERT INTO units (store_id, name, name_en) VALUES ($1,$2,NULLIF($3,'')) RETURNING id, is_active, created_at`,
		u.StoreID, u.Name, u.NameEN).Scan(&u.ID, &u.IsActive, &u.CreatedAt)
	if isUniqueViolation(err) {
		return domain.ErrConflict.With("field", "name")
	}
	return err
}

func (UnitRepo) Update(ctx context.Context, u *domain.Unit) error {
	tag, err := Q(ctx).Exec(ctx, `UPDATE units SET name=$3, name_en=NULLIF($4,''), is_active=$5 WHERE store_id=$1 AND id=$2`,
		u.StoreID, u.ID, u.Name, u.NameEN, u.IsActive)
	if isUniqueViolation(err) {
		return domain.ErrConflict.With("field", "name")
	}
	if err == nil && tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return err
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

const supplierCols = `id, store_id, COALESCE(code,''), name, COALESCE(address,''), COALESCE(phone,''), COALESCE(fax,''), COALESCE(email,''),
	COALESCE(tax_id,''), COALESCE(note,''), is_active, created_at, updated_at`

func scanSupplier(row pgx.Row) (*domain.Supplier, error) {
	var s domain.Supplier
	if err := row.Scan(&s.ID, &s.StoreID, &s.Code, &s.Name, &s.Address, &s.Phone, &s.Fax, &s.Email, &s.TaxID, &s.Note, &s.IsActive, &s.CreatedAt, &s.UpdatedAt); err != nil {
		return nil, err
	}
	return &s, nil
}

type SupplierRepo struct{}

func (SupplierRepo) List(ctx context.Context, storeID uuid.UUID, q string) ([]domain.Supplier, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT `+supplierCols+` FROM suppliers WHERE store_id=$1
		AND ($2='' OR name ILIKE '%'||$2||'%' OR COALESCE(code,'') ILIKE '%'||$2||'%' OR COALESCE(phone,'') ILIKE '%'||$2||'%')
		ORDER BY name LIMIT 500`, storeID, strings.TrimSpace(q))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Supplier{}
	for rows.Next() {
		s, err := scanSupplier(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

func (SupplierRepo) Get(ctx context.Context, storeID, id uuid.UUID) (*domain.Supplier, error) {
	s, err := scanSupplier(Q(ctx).QueryRow(ctx, `SELECT `+supplierCols+` FROM suppliers WHERE store_id=$1 AND id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return s, err
}

func (SupplierRepo) Create(ctx context.Context, s *domain.Supplier) error {
	return Q(ctx).QueryRow(ctx, `INSERT INTO suppliers (store_id, code, name, address, phone, fax, email, tax_id, note, is_active)
		VALUES ($1,NULLIF($2,''),$3,NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),NULLIF($9,''),$10)
		RETURNING id, created_at, updated_at`,
		s.StoreID, s.Code, s.Name, s.Address, s.Phone, s.Fax, s.Email, s.TaxID, s.Note, s.IsActive).Scan(&s.ID, &s.CreatedAt, &s.UpdatedAt)
}

func (SupplierRepo) Update(ctx context.Context, s *domain.Supplier) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE suppliers SET code=NULLIF($3,''), name=$4, address=NULLIF($5,''), phone=NULLIF($6,''), fax=NULLIF($7,''),
		email=NULLIF($8,''), tax_id=NULLIF($9,''), note=NULLIF($10,''), is_active=$11 WHERE store_id=$1 AND id=$2`,
		s.StoreID, s.ID, s.Code, s.Name, s.Address, s.Phone, s.Fax, s.Email, s.TaxID, s.Note, s.IsActive)
	return err
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const productCols = `p.id, p.store_id, p.sku, p.name, COALESCE(p.name_en,''), p.category_id, p.unit_id,
	p.cost_last::text, p.cost_avg::text, p.sell_price::text, p.stock_on_hand::text, p.min_level1::text, p.min_level2::text,
	p.is_serial, p.is_active, p.is_archived, COALESCE(p.archived_reason,''), p.archived_at, COALESCE(p.image_url,''), COALESCE(p.note,''),
	COALESCE(p.legacy_id,''), p.created_at, p.updated_at, COALESCE(c.name,''), COALESCE(u.name,'')`

const productFrom = ` FROM products p LEFT JOIN product_categories c ON c.id=p.category_id LEFT JOIN units u ON u.id=p.unit_id `

func scanProductView(row pgx.Row) (*domain.ProductView, error) {
	var v domain.ProductView
	var costLast, costAvg, sell, stock, min1, min2 string
	if err := row.Scan(&v.ID, &v.StoreID, &v.SKU, &v.Name, &v.NameEN, &v.CategoryID, &v.UnitID,
		&costLast, &costAvg, &sell, &stock, &min1, &min2,
		&v.IsSerial, &v.IsActive, &v.IsArchived, &v.ArchivedReason, &v.ArchivedAt, &v.ImageURL, &v.Note,
		&v.LegacyID, &v.CreatedAt, &v.UpdatedAt, &v.CategoryName, &v.UnitName); err != nil {
		return nil, err
	}
	v.CostLast, v.CostAvg, v.SellPrice, v.StockOnHand, v.MinLevel1, v.MinLevel2 = dec(costLast), dec(costAvg), dec(sell), dec(stock), dec(min1), dec(min2)
	v.Barcodes = []domain.ProductBarcode{}
	v.PriceTiers = domain.PriceTiers{}
	return &v, nil
}

// ProductFilter drives ProductRepo.List.
type ProductFilter struct {
	Q          string
	CategoryID *uuid.UUID
	Barcode    string
	Active     *bool
	Archived   *bool // nil = both
	LowStock   bool
	Limit      int
	Offset     int
}

type ProductRepo struct{}

// List returns a page of products (without barcodes/tiers; call Decorate) and the total count.
func (r ProductRepo) List(ctx context.Context, storeID uuid.UUID, f ProductFilter) ([]domain.ProductView, int64, error) {
	where := ` WHERE p.store_id=$1
		AND ($2='' OR p.name ILIKE '%'||$2||'%' OR COALESCE(p.name_en,'') ILIKE '%'||$2||'%' OR p.sku ILIKE '%'||$2||'%'
			OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id=p.id AND b.barcode ILIKE '%'||$2||'%'))
		AND ($3::uuid IS NULL OR p.category_id=$3::uuid)
		AND ($4='' OR p.sku=$4 OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id=p.id AND b.barcode=$4))
		AND ($5::boolean IS NULL OR p.is_active=$5::boolean)
		AND ($6::boolean IS NULL OR p.is_archived=$6::boolean)
		AND (NOT $7::boolean OR p.stock_on_hand <= p.min_level1)`
	args := []any{storeID, strings.TrimSpace(f.Q), f.CategoryID, strings.TrimSpace(f.Barcode), f.Active, f.Archived, f.LowStock}
	var total int64
	if err := Q(ctx).QueryRow(ctx, `SELECT count(*)`+productFrom+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := Q(ctx).Query(ctx, `SELECT `+productCols+productFrom+where+` ORDER BY p.name, p.sku LIMIT $8 OFFSET $9`, append(args, f.Limit, f.Offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []domain.ProductView{}
	for rows.Next() {
		v, err := scanProductView(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *v)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	if err := r.Decorate(ctx, out); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

// Get returns a fully decorated product view.
func (r ProductRepo) Get(ctx context.Context, storeID, id uuid.UUID) (*domain.ProductView, error) {
	v, err := scanProductView(Q(ctx).QueryRow(ctx, `SELECT `+productCols+productFrom+` WHERE p.store_id=$1 AND p.id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrProductNotFound
	}
	if err != nil {
		return nil, err
	}
	views := []domain.ProductView{*v}
	if err := r.Decorate(ctx, views); err != nil {
		return nil, err
	}
	return &views[0], nil
}

// GetMany returns decorated views for the given ids (missing ids are skipped).
func (r ProductRepo) GetMany(ctx context.Context, storeID uuid.UUID, ids []uuid.UUID) ([]domain.ProductView, error) {
	if len(ids) == 0 {
		return []domain.ProductView{}, nil
	}
	rows, err := Q(ctx).Query(ctx, `SELECT `+productCols+productFrom+` WHERE p.store_id=$1 AND p.id = ANY($2) ORDER BY p.name`, storeID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.ProductView{}
	for rows.Next() {
		v, err := scanProductView(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, r.Decorate(ctx, out)
}

// Decorate loads barcodes and price tiers for the given views (in place).
func (ProductRepo) Decorate(ctx context.Context, views []domain.ProductView) error {
	if len(views) == 0 {
		return nil
	}
	idx := make(map[uuid.UUID]int, len(views))
	ids := make([]uuid.UUID, len(views))
	for i := range views {
		idx[views[i].ID] = i
		ids[i] = views[i].ID
		views[i].Barcodes = []domain.ProductBarcode{}
		views[i].PriceTiers = domain.PriceTiers{}
		views[i].PrimaryBarcode = ""
	}
	rows, err := Q(ctx).Query(ctx, `SELECT id, product_id, barcode, is_primary, pack_qty::text, created_at FROM product_barcodes
		WHERE product_id = ANY($1) ORDER BY is_primary DESC, created_at`, ids)
	if err != nil {
		return err
	}
	for rows.Next() {
		var b domain.ProductBarcode
		var pack string
		if err := rows.Scan(&b.ID, &b.ProductID, &b.Barcode, &b.IsPrimary, &pack, &b.CreatedAt); err != nil {
			rows.Close()
			return err
		}
		b.PackQty = dec(pack)
		if i, ok := idx[b.ProductID]; ok {
			views[i].Barcodes = append(views[i].Barcodes, b)
			if b.IsPrimary || views[i].PrimaryBarcode == "" {
				views[i].PrimaryBarcode = b.Barcode
			}
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	trows, err := Q(ctx).Query(ctx, `SELECT product_id, tier, price::text FROM price_tiers WHERE product_id = ANY($1) ORDER BY tier`, ids)
	if err != nil {
		return err
	}
	defer trows.Close()
	for trows.Next() {
		var pid uuid.UUID
		var tier int
		var price string
		if err := trows.Scan(&pid, &tier, &price); err != nil {
			return err
		}
		if i, ok := idx[pid]; ok {
			views[i].PriceTiers[tier] = dec(price)
		}
	}
	return trows.Err()
}

// Create inserts the product row (sku must be unique per store).
func (ProductRepo) Create(ctx context.Context, p *domain.Product) error {
	var stock string
	err := Q(ctx).QueryRow(ctx, `INSERT INTO products (store_id, sku, name, name_en, category_id, unit_id, cost_last, cost_avg, sell_price,
		min_level1, min_level2, is_serial, is_active, image_url, note)
		VALUES ($1,$2,$3,NULLIF($4,''),$5,$6,$7,$8,$9,$10,$11,$12,$13,NULLIF($14,''),NULLIF($15,''))
		RETURNING id, stock_on_hand::text, created_at, updated_at`,
		p.StoreID, p.SKU, p.Name, p.NameEN, p.CategoryID, p.UnitID, p.CostLast.String(), p.CostAvg.String(), p.SellPrice.String(),
		p.MinLevel1.String(), p.MinLevel2.String(), p.IsSerial, p.IsActive, p.ImageURL, p.Note).
		Scan(&p.ID, &stock, &p.CreatedAt, &p.UpdatedAt)
	if isUniqueViolation(err) {
		return domain.ErrSKUExists.With("sku", p.SKU)
	}
	if isFKViolation(err) {
		return domain.ErrValidation.With("field", "category_id/unit_id")
	}
	p.StockOnHand = dec(stock)
	return err
}

// Update writes the mutable master-data columns (stock and costs are owned by the stock ledger).
func (ProductRepo) Update(ctx context.Context, p *domain.Product) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE products SET sku=$3, name=$4, name_en=NULLIF($5,''), category_id=$6, unit_id=$7, cost_last=$8, cost_avg=$9, sell_price=$10,
		min_level1=$11, min_level2=$12, is_serial=$13, is_active=$14, image_url=NULLIF($15,''), note=NULLIF($16,'')
		WHERE store_id=$1 AND id=$2`,
		p.StoreID, p.ID, p.SKU, p.Name, p.NameEN, p.CategoryID, p.UnitID, p.CostLast.String(), p.CostAvg.String(), p.SellPrice.String(),
		p.MinLevel1.String(), p.MinLevel2.String(), p.IsSerial, p.IsActive, p.ImageURL, p.Note)
	if isUniqueViolation(err) {
		return domain.ErrSKUExists.With("sku", p.SKU)
	}
	if isFKViolation(err) {
		return domain.ErrValidation.With("field", "category_id/unit_id")
	}
	return err
}

// Archive soft-deletes a product.
func (ProductRepo) Archive(ctx context.Context, storeID, id uuid.UUID, reason string) error {
	tag, err := Q(ctx).Exec(ctx, `UPDATE products SET is_archived=true, archived_reason=$3, archived_at=now(), is_active=false WHERE store_id=$1 AND id=$2`, storeID, id, reason)
	if err == nil && tag.RowsAffected() == 0 {
		return domain.ErrProductNotFound
	}
	return err
}

func (ProductRepo) Restore(ctx context.Context, storeID, id uuid.UUID) error {
	tag, err := Q(ctx).Exec(ctx, `UPDATE products SET is_archived=false, archived_reason=NULL, archived_at=NULL, is_active=true WHERE store_id=$1 AND id=$2`, storeID, id)
	if err == nil && tag.RowsAffected() == 0 {
		return domain.ErrProductNotFound
	}
	return err
}

func (ProductRepo) SetSellPrice(ctx context.Context, storeID, id uuid.UUID, price decimal.Decimal) error {
	tag, err := Q(ctx).Exec(ctx, `UPDATE products SET sell_price=$3 WHERE store_id=$1 AND id=$2`, storeID, id, price.String())
	if err == nil && tag.RowsAffected() == 0 {
		return domain.ErrProductNotFound
	}
	return err
}

// ReplaceTiers overwrites all price tiers of a product with the given map (tiers absent from the map are removed).
func (ProductRepo) ReplaceTiers(ctx context.Context, productID uuid.UUID, tiers domain.PriceTiers) error {
	if _, err := Q(ctx).Exec(ctx, `DELETE FROM price_tiers WHERE product_id=$1`, productID); err != nil {
		return err
	}
	for tier, price := range tiers {
		if tier < 1 || tier > 4 {
			return domain.ErrValidation.With("field", fmt.Sprintf("price_tiers.%d", tier))
		}
		if _, err := Q(ctx).Exec(ctx, `INSERT INTO price_tiers (product_id, tier, price) VALUES ($1,$2,$3)`, productID, tier, price.String()); err != nil {
			return err
		}
	}
	return nil
}

// --- barcodes ---------------------------------------------------------------

func (ProductRepo) AddBarcode(ctx context.Context, storeID uuid.UUID, b *domain.ProductBarcode) error {
	if b.IsPrimary {
		if _, err := Q(ctx).Exec(ctx, `UPDATE product_barcodes SET is_primary=false WHERE product_id=$1 AND is_primary`, b.ProductID); err != nil {
			return err
		}
	}
	err := Q(ctx).QueryRow(ctx, `INSERT INTO product_barcodes (store_id, product_id, barcode, is_primary, pack_qty) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
		storeID, b.ProductID, b.Barcode, b.IsPrimary, b.PackQty.String()).Scan(&b.ID, &b.CreatedAt)
	if isUniqueViolation(err) {
		return domain.ErrBarcodeExists.With("barcode", b.Barcode)
	}
	return err
}

func (ProductRepo) DeleteBarcode(ctx context.Context, storeID, productID, barcodeID uuid.UUID) error {
	tag, err := Q(ctx).Exec(ctx, `DELETE FROM product_barcodes WHERE store_id=$1 AND product_id=$2 AND id=$3`, storeID, productID, barcodeID)
	if err == nil && tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return err
}

// FindByBarcode resolves a scanned code to (product id, pack qty): product_barcodes first, then sku.
func (ProductRepo) FindByBarcode(ctx context.Context, storeID uuid.UUID, code string) (uuid.UUID, decimal.Decimal, error) {
	var id uuid.UUID
	var pack string
	err := Q(ctx).QueryRow(ctx, `SELECT product_id, pack_qty::text FROM product_barcodes WHERE store_id=$1 AND barcode=$2`, storeID, code).Scan(&id, &pack)
	if err == nil {
		return id, dec(pack), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, decimal.Zero, err
	}
	err = Q(ctx).QueryRow(ctx, `SELECT id FROM products WHERE store_id=$1 AND sku=$2`, storeID, code).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, decimal.Zero, domain.ErrBarcodeNotFound.With("barcode", code)
	}
	if err != nil {
		return uuid.Nil, decimal.Zero, err
	}
	return id, decimal.NewFromInt(1), nil
}

// ---------------------------------------------------------------------------
// Barcode label templates
// ---------------------------------------------------------------------------

const labelCols = `id, store_id, code, name, paper, columns_n, rows_n, dims, fonts, visible, created_at`

func scanLabelTemplate(row pgx.Row) (*domain.LabelTemplate, error) {
	var t domain.LabelTemplate
	var dims, fonts, visible []byte
	if err := row.Scan(&t.ID, &t.StoreID, &t.Code, &t.Name, &t.Paper, &t.Columns, &t.Rows, &dims, &fonts, &visible, &t.CreatedAt); err != nil {
		return nil, err
	}
	t.Dims, t.Fonts, t.Visible = jsonMap(dims), jsonMap(fonts), jsonMap(visible)
	return &t, nil
}

func jsonMap(b []byte) map[string]any {
	out := map[string]any{}
	if len(b) > 0 {
		_ = json.Unmarshal(b, &out)
	}
	return out
}

func jsonBytes(m map[string]any) []byte {
	if m == nil {
		return []byte("{}")
	}
	b, err := json.Marshal(m)
	if err != nil {
		return []byte("{}")
	}
	return b
}

type LabelTemplateRepo struct{}

func (LabelTemplateRepo) List(ctx context.Context, storeID uuid.UUID) ([]domain.LabelTemplate, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT `+labelCols+` FROM barcode_label_templates WHERE store_id=$1 ORDER BY code`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.LabelTemplate{}
	for rows.Next() {
		t, err := scanLabelTemplate(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

func (LabelTemplateRepo) Get(ctx context.Context, storeID, id uuid.UUID) (*domain.LabelTemplate, error) {
	t, err := scanLabelTemplate(Q(ctx).QueryRow(ctx, `SELECT `+labelCols+` FROM barcode_label_templates WHERE store_id=$1 AND id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return t, err
}

func (LabelTemplateRepo) GetByCode(ctx context.Context, storeID uuid.UUID, code string) (*domain.LabelTemplate, error) {
	t, err := scanLabelTemplate(Q(ctx).QueryRow(ctx, `SELECT `+labelCols+` FROM barcode_label_templates WHERE store_id=$1 AND lower(code)=lower($2)`, storeID, code))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return t, err
}

func (LabelTemplateRepo) Create(ctx context.Context, t *domain.LabelTemplate) error {
	err := Q(ctx).QueryRow(ctx, `INSERT INTO barcode_label_templates (store_id, code, name, paper, columns_n, rows_n, dims, fonts, visible)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, created_at`,
		t.StoreID, t.Code, t.Name, t.Paper, t.Columns, t.Rows, jsonBytes(t.Dims), jsonBytes(t.Fonts), jsonBytes(t.Visible)).Scan(&t.ID, &t.CreatedAt)
	if isUniqueViolation(err) {
		return domain.ErrConflict.With("field", "code")
	}
	return err
}

func (LabelTemplateRepo) Update(ctx context.Context, t *domain.LabelTemplate) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE barcode_label_templates SET code=$3, name=$4, paper=$5, columns_n=$6, rows_n=$7, dims=$8, fonts=$9, visible=$10
		WHERE store_id=$1 AND id=$2`,
		t.StoreID, t.ID, t.Code, t.Name, t.Paper, t.Columns, t.Rows, jsonBytes(t.Dims), jsonBytes(t.Fonts), jsonBytes(t.Visible))
	if isUniqueViolation(err) {
		return domain.ErrConflict.With("field", "code")
	}
	return err
}
