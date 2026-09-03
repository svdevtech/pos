package productuc

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

// Actor identifies who performs an action (for audit).
type Actor struct {
	UserID uuid.UUID
	Name   string
	IP     string
}

func (a Actor) userPtr() *uuid.UUID {
	if a.UserID == uuid.Nil {
		return nil
	}
	id := a.UserID
	return &id
}

type Service struct {
	db         *postgres.DB
	categories postgres.CategoryRepo
	units      postgres.UnitRepo
	suppliers  postgres.SupplierRepo
	products   postgres.ProductRepo
	labels     postgres.LabelTemplateRepo
	stock      postgres.StockRepo
	audit      postgres.AuditRepo
}

func New(db *postgres.DB) *Service { return &Service{db: db} }

func (s *Service) tx(ctx context.Context, storeID uuid.UUID, fn func(ctx context.Context) error) error {
	return s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error { return fn(ctx) })
}

func (s *Service) auditWrite(ctx context.Context, actor Actor, storeID uuid.UUID, action, entity string, entityID uuid.UUID, before, after any) error {
	return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: actor.userPtr(), ActorName: actor.Name, Action: action, Entity: entity,
		EntityID: entityID.String(), Before: before, After: after, IP: actor.IP})
}

// ---- categories --------------------------------------------------------------

type CategoryInput struct {
	Name      *string `json:"name"`
	NameEN    *string `json:"name_en"`
	SortOrder *int    `json:"sort_order"`
	IsActive  *bool   `json:"is_active"`
}

func (s *Service) ListCategories(ctx context.Context, storeID uuid.UUID) ([]domain.Category, error) {
	var out []domain.Category
	err := s.tx(ctx, storeID, func(ctx context.Context) (err error) {
		out, err = s.categories.List(ctx, storeID)
		return
	})
	return out, err
}

func (s *Service) CreateCategory(ctx context.Context, actor Actor, storeID uuid.UUID, in CategoryInput) (*domain.Category, error) {
	c := domain.Category{StoreID: storeID, IsActive: true}
	if in.Name == nil || strings.TrimSpace(*in.Name) == "" {
		return nil, domain.ErrValidation.With("field", "name")
	}
	c.Name = strings.TrimSpace(*in.Name)
	if in.NameEN != nil {
		c.NameEN = strings.TrimSpace(*in.NameEN)
	}
	if in.SortOrder != nil {
		c.SortOrder = *in.SortOrder
	}
	if in.IsActive != nil {
		c.IsActive = *in.IsActive
	}
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		if err := s.categories.Create(ctx, &c); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "category.create", "product_category", c.ID, nil, c)
	})
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *Service) UpdateCategory(ctx context.Context, actor Actor, storeID, id uuid.UUID, in CategoryInput) (*domain.Category, error) {
	var out *domain.Category
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		cur, err := s.categories.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		c := *cur
		if in.Name != nil {
			if strings.TrimSpace(*in.Name) == "" {
				return domain.ErrValidation.With("field", "name")
			}
			c.Name = strings.TrimSpace(*in.Name)
		}
		if in.NameEN != nil {
			c.NameEN = strings.TrimSpace(*in.NameEN)
		}
		if in.SortOrder != nil {
			c.SortOrder = *in.SortOrder
		}
		if in.IsActive != nil {
			c.IsActive = *in.IsActive
		}
		if err := s.categories.Update(ctx, &c); err != nil {
			return err
		}
		if out, err = s.categories.Get(ctx, storeID, id); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "category.update", "product_category", id, cur, out)
	})
	return out, err
}

// ---- units ------------------------------------------------------------------

type UnitInput struct {
	Name   string `json:"name"`
	NameEN string `json:"name_en"`
}

// UnitPatch updates a unit; deleting one means clearing IsActive (products keep their history).
type UnitPatch struct {
	Name     *string `json:"name"`
	NameEN   *string `json:"name_en"`
	IsActive *bool   `json:"is_active"`
}

func (s *Service) ListUnits(ctx context.Context, storeID uuid.UUID) ([]domain.Unit, error) {
	var out []domain.Unit
	err := s.tx(ctx, storeID, func(ctx context.Context) (err error) {
		out, err = s.units.List(ctx, storeID)
		return
	})
	return out, err
}

func (s *Service) CreateUnit(ctx context.Context, actor Actor, storeID uuid.UUID, in UnitInput) (*domain.Unit, error) {
	if strings.TrimSpace(in.Name) == "" {
		return nil, domain.ErrValidation.With("field", "name")
	}
	u := domain.Unit{StoreID: storeID, Name: strings.TrimSpace(in.Name), NameEN: strings.TrimSpace(in.NameEN)}
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		if err := s.units.Create(ctx, &u); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "unit.create", "unit", u.ID, nil, u)
	})
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// UpdateUnit renames a unit or switches it off. A unit still used by products can be switched off:
// those products keep showing it, but it disappears from the pickers.
func (s *Service) UpdateUnit(ctx context.Context, actor Actor, storeID, id uuid.UUID, in UnitPatch) (*domain.Unit, error) {
	var out *domain.Unit
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		cur, err := s.units.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		u := *cur
		if in.Name != nil {
			if strings.TrimSpace(*in.Name) == "" {
				return domain.ErrValidation.With("field", "name")
			}
			u.Name = strings.TrimSpace(*in.Name)
		}
		if in.NameEN != nil {
			u.NameEN = strings.TrimSpace(*in.NameEN)
		}
		if in.IsActive != nil {
			u.IsActive = *in.IsActive
		}
		if err := s.units.Update(ctx, &u); err != nil {
			return err
		}
		if out, err = s.units.Get(ctx, storeID, id); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "unit.update", "unit", id, cur, out)
	})
	return out, err
}

// ---- suppliers ----------------------------------------------------------------

type SupplierInput struct {
	Code     *string `json:"code"`
	Name     *string `json:"name"`
	Address  *string `json:"address"`
	Phone    *string `json:"phone"`
	Fax      *string `json:"fax"`
	Email    *string `json:"email"`
	TaxID    *string `json:"tax_id"`
	Note     *string `json:"note"`
	IsActive *bool   `json:"is_active"`
}

func (in SupplierInput) applyTo(sp *domain.Supplier) error {
	set := func(dst *string, src *string) {
		if src != nil {
			*dst = strings.TrimSpace(*src)
		}
	}
	set(&sp.Code, in.Code)
	set(&sp.Name, in.Name)
	set(&sp.Address, in.Address)
	set(&sp.Phone, in.Phone)
	set(&sp.Fax, in.Fax)
	set(&sp.Email, in.Email)
	set(&sp.TaxID, in.TaxID)
	set(&sp.Note, in.Note)
	if in.IsActive != nil {
		sp.IsActive = *in.IsActive
	}
	if sp.Name == "" {
		return domain.ErrValidation.With("field", "name")
	}
	return nil
}

func (s *Service) ListSuppliers(ctx context.Context, storeID uuid.UUID, q string) ([]domain.Supplier, error) {
	var out []domain.Supplier
	err := s.tx(ctx, storeID, func(ctx context.Context) (err error) {
		out, err = s.suppliers.List(ctx, storeID, q)
		return
	})
	return out, err
}

func (s *Service) GetSupplier(ctx context.Context, storeID, id uuid.UUID) (*domain.Supplier, error) {
	var out *domain.Supplier
	err := s.tx(ctx, storeID, func(ctx context.Context) (err error) {
		out, err = s.suppliers.Get(ctx, storeID, id)
		return
	})
	return out, err
}

func (s *Service) CreateSupplier(ctx context.Context, actor Actor, storeID uuid.UUID, in SupplierInput) (*domain.Supplier, error) {
	sp := domain.Supplier{StoreID: storeID, IsActive: true}
	if err := in.applyTo(&sp); err != nil {
		return nil, err
	}
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		if err := s.suppliers.Create(ctx, &sp); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "supplier.create", "supplier", sp.ID, nil, sp)
	})
	if err != nil {
		return nil, err
	}
	return &sp, nil
}

func (s *Service) UpdateSupplier(ctx context.Context, actor Actor, storeID, id uuid.UUID, in SupplierInput) (*domain.Supplier, error) {
	var out *domain.Supplier
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		cur, err := s.suppliers.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		sp := *cur
		if err := in.applyTo(&sp); err != nil {
			return err
		}
		if err := s.suppliers.Update(ctx, &sp); err != nil {
			return err
		}
		if out, err = s.suppliers.Get(ctx, storeID, id); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "supplier.update", "supplier", id, cur, out)
	})
	return out, err
}

// ---- products -----------------------------------------------------------------

// ProductInput is the create body (all fields) and the PATCH body (only non-nil fields are applied).
type ProductInput struct {
	SKU          *string           `json:"sku"`
	Name         *string           `json:"name"`
	NameEN       *string           `json:"name_en"`
	CategoryID   *uuid.UUID        `json:"category_id"`
	UnitID       *uuid.UUID        `json:"unit_id"`
	CostLast     *decimal.Decimal  `json:"cost_last"`
	CostAvg      *decimal.Decimal  `json:"cost_avg"`
	SellPrice    *decimal.Decimal  `json:"sell_price"`
	MinLevel1    *decimal.Decimal  `json:"min_level1"`
	MinLevel2    *decimal.Decimal  `json:"min_level2"`
	IsSerial     *bool             `json:"is_serial"`
	IsActive     *bool             `json:"is_active"`
	ImageURL     *string           `json:"image_url"`
	Note         *string           `json:"note"`
	Barcodes     []string          `json:"barcodes"`      // create only; first entry becomes the primary barcode
	PriceTiers   domain.PriceTiers `json:"price_tiers"`   // create: set; patch: replace when present
	OpeningStock *decimal.Decimal  `json:"opening_stock"` // create only
}

func (in ProductInput) applyTo(p *domain.Product) error {
	setStr := func(dst *string, src *string) {
		if src != nil {
			*dst = strings.TrimSpace(*src)
		}
	}
	setDec := func(dst *decimal.Decimal, src *decimal.Decimal) {
		if src != nil {
			*dst = *src
		}
	}
	setStr(&p.SKU, in.SKU)
	setStr(&p.Name, in.Name)
	setStr(&p.NameEN, in.NameEN)
	setStr(&p.ImageURL, in.ImageURL)
	setStr(&p.Note, in.Note)
	if in.CategoryID != nil {
		p.CategoryID = nilIfZero(in.CategoryID)
	}
	if in.UnitID != nil {
		p.UnitID = nilIfZero(in.UnitID)
	}
	setDec(&p.CostLast, in.CostLast)
	setDec(&p.CostAvg, in.CostAvg)
	setDec(&p.SellPrice, in.SellPrice)
	setDec(&p.MinLevel1, in.MinLevel1)
	setDec(&p.MinLevel2, in.MinLevel2)
	if in.IsSerial != nil {
		p.IsSerial = *in.IsSerial
	}
	if in.IsActive != nil {
		p.IsActive = *in.IsActive
	}
	switch {
	case p.Name == "":
		return domain.ErrValidation.With("field", "name")
	case p.SellPrice.IsNegative():
		return domain.ErrValidation.With("field", "sell_price")
	case p.CostLast.IsNegative() || p.CostAvg.IsNegative():
		return domain.ErrValidation.With("field", "cost")
	case p.MinLevel1.IsNegative() || p.MinLevel2.IsNegative():
		return domain.ErrValidation.With("field", "min_level")
	}
	p.SellPrice = p.SellPrice.Round(2)
	p.CostLast = p.CostLast.Round(4)
	p.CostAvg = p.CostAvg.Round(4)
	p.MinLevel1 = p.MinLevel1.Round(3)
	p.MinLevel2 = p.MinLevel2.Round(3)
	return nil
}

func nilIfZero(id *uuid.UUID) *uuid.UUID {
	if id == nil || *id == uuid.Nil {
		return nil
	}
	return id
}

func decorateLevels(views []domain.ProductView) {
	for i := range views {
		views[i].StockLevel = StockLevel(views[i].StockOnHand, views[i].MinLevel1, views[i].MinLevel2)
	}
}

func (s *Service) ListProducts(ctx context.Context, storeID uuid.UUID, f postgres.ProductFilter) ([]domain.ProductView, int64, error) {
	var out []domain.ProductView
	var total int64
	err := s.tx(ctx, storeID, func(ctx context.Context) (err error) {
		out, total, err = s.products.List(ctx, storeID, f)
		return
	})
	decorateLevels(out)
	return out, total, err
}

func (s *Service) GetProduct(ctx context.Context, storeID, id uuid.UUID) (*domain.ProductView, error) {
	var out *domain.ProductView
	err := s.tx(ctx, storeID, func(ctx context.Context) (err error) {
		out, err = s.products.Get(ctx, storeID, id)
		return
	})
	if out != nil {
		out.StockLevel = StockLevel(out.StockOnHand, out.MinLevel1, out.MinLevel2)
	}
	return out, err
}

func (s *Service) CreateProduct(ctx context.Context, actor Actor, storeID uuid.UUID, in ProductInput) (*domain.ProductView, error) {
	p := domain.Product{StoreID: storeID, IsActive: true}
	if err := in.applyTo(&p); err != nil {
		return nil, err
	}
	barcodes := normalizeBarcodes(in.Barcodes)
	p.SKU = ResolveSKU(p.SKU, barcodes)
	if in.CostAvg == nil {
		p.CostAvg = p.CostLast
	}
	if !validTiers(in.PriceTiers) {
		return nil, domain.ErrValidation.With("field", "price_tiers")
	}
	if in.OpeningStock != nil && in.OpeningStock.IsNegative() {
		return nil, domain.ErrValidation.With("field", "opening_stock")
	}
	var out *domain.ProductView
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		if err := s.products.Create(ctx, &p); err != nil {
			return err
		}
		for i, code := range barcodes {
			b := domain.ProductBarcode{ProductID: p.ID, Barcode: code, IsPrimary: i == 0, PackQty: decimal.NewFromInt(1)}
			if err := s.products.AddBarcode(ctx, storeID, &b); err != nil {
				return err
			}
		}
		if len(in.PriceTiers) > 0 {
			if err := s.products.ReplaceTiers(ctx, p.ID, in.PriceTiers); err != nil {
				return err
			}
		}
		if in.OpeningStock != nil && in.OpeningStock.Sign() > 0 {
			qty := in.OpeningStock.Round(3)
			cost := p.CostLast
			if _, err := s.stock.Apply(ctx, storeID, p.ID, domain.MoveOpening, qty, &cost, domain.RefProduct, &p.ID, "opening stock", actor.userPtr()); err != nil {
				return err
			}
		}
		var err error
		if out, err = s.products.Get(ctx, storeID, p.ID); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "product.create", "product", p.ID, nil, out)
	})
	if err != nil {
		return nil, err
	}
	out.StockLevel = StockLevel(out.StockOnHand, out.MinLevel1, out.MinLevel2)
	return out, nil
}

func (s *Service) UpdateProduct(ctx context.Context, actor Actor, storeID, id uuid.UUID, in ProductInput) (*domain.ProductView, error) {
	if in.PriceTiers != nil && !validTiers(in.PriceTiers) {
		return nil, domain.ErrValidation.With("field", "price_tiers")
	}
	var out *domain.ProductView
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		cur, err := s.products.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		if cur.IsArchived {
			return domain.ErrProductArchived
		}
		p := cur.Product
		if err := in.applyTo(&p); err != nil {
			return err
		}
		if err := s.products.Update(ctx, &p); err != nil {
			return err
		}
		if in.PriceTiers != nil {
			if err := s.products.ReplaceTiers(ctx, id, in.PriceTiers); err != nil {
				return err
			}
		}
		if out, err = s.products.Get(ctx, storeID, id); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "product.update", "product", id, cur, out)
	})
	if err != nil {
		return nil, err
	}
	out.StockLevel = StockLevel(out.StockOnHand, out.MinLevel1, out.MinLevel2)
	return out, nil
}

// ArchiveProduct soft-deletes: is_archived=true, archived_reason='deleted', is_active=false. Never hard-deletes.
func (s *Service) ArchiveProduct(ctx context.Context, actor Actor, storeID, id uuid.UUID) error {
	return s.tx(ctx, storeID, func(ctx context.Context) error {
		cur, err := s.products.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		if cur.IsArchived {
			return nil
		}
		if err := s.products.Archive(ctx, storeID, id, domain.ArchivedDeleted); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "product.archive", "product", id, cur, map[string]any{"is_archived": true, "archived_reason": domain.ArchivedDeleted})
	})
}

func (s *Service) RestoreProduct(ctx context.Context, actor Actor, storeID, id uuid.UUID) (*domain.ProductView, error) {
	var out *domain.ProductView
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		cur, err := s.products.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		if err := s.products.Restore(ctx, storeID, id); err != nil {
			return err
		}
		if out, err = s.products.Get(ctx, storeID, id); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "product.restore", "product", id, cur, out)
	})
	if err != nil {
		return nil, err
	}
	out.StockLevel = StockLevel(out.StockOnHand, out.MinLevel1, out.MinLevel2)
	return out, nil
}

// LookupBarcode resolves a scanned code (barcode table first, then sku). Archived products are rejected.
func (s *Service) LookupBarcode(ctx context.Context, storeID uuid.UUID, code string) (*domain.BarcodeLookup, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil, domain.ErrBarcodeNotFound.With("barcode", code)
	}
	var out *domain.BarcodeLookup
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		id, pack, err := s.products.FindByBarcode(ctx, storeID, code)
		if err != nil {
			return err
		}
		v, err := s.products.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		if v.IsArchived {
			return domain.ErrProductArchived
		}
		v.StockLevel = StockLevel(v.StockOnHand, v.MinLevel1, v.MinLevel2)
		if pack.Sign() <= 0 {
			pack = decimal.NewFromInt(1)
		}
		out = &domain.BarcodeLookup{ProductView: *v, ScannedBarcode: code, PackQty: pack}
		return nil
	})
	return out, err
}

type BarcodeInput struct {
	Barcode   string           `json:"barcode"`
	IsPrimary bool             `json:"is_primary"`
	PackQty   *decimal.Decimal `json:"pack_qty"`
}

func (s *Service) AddBarcode(ctx context.Context, actor Actor, storeID, productID uuid.UUID, in BarcodeInput) (*domain.ProductView, error) {
	code := strings.TrimSpace(in.Barcode)
	if code == "" {
		return nil, domain.ErrValidation.With("field", "barcode")
	}
	pack := decimal.NewFromInt(1)
	if in.PackQty != nil {
		if in.PackQty.Sign() <= 0 {
			return nil, domain.ErrValidation.With("field", "pack_qty")
		}
		pack = in.PackQty.Round(3)
	}
	var out *domain.ProductView
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		cur, err := s.products.Get(ctx, storeID, productID)
		if err != nil {
			return err
		}
		b := domain.ProductBarcode{ProductID: productID, Barcode: code, IsPrimary: in.IsPrimary || len(cur.Barcodes) == 0, PackQty: pack}
		if err := s.products.AddBarcode(ctx, storeID, &b); err != nil {
			return err
		}
		if out, err = s.products.Get(ctx, storeID, productID); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "product.barcode_add", "product", productID, nil, b)
	})
	if err != nil {
		return nil, err
	}
	out.StockLevel = StockLevel(out.StockOnHand, out.MinLevel1, out.MinLevel2)
	return out, nil
}

func (s *Service) DeleteBarcode(ctx context.Context, actor Actor, storeID, productID, barcodeID uuid.UUID) error {
	return s.tx(ctx, storeID, func(ctx context.Context) error {
		if err := s.products.DeleteBarcode(ctx, storeID, productID, barcodeID); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "product.barcode_delete", "product", productID, map[string]any{"barcode_id": barcodeID}, nil)
	})
}

type PricesInput struct {
	SellPrice  *decimal.Decimal  `json:"sell_price"`
	PriceTiers domain.PriceTiers `json:"price_tiers"`
}

// SetPrices replaces the sell price (when given) and the whole tier table.
func (s *Service) SetPrices(ctx context.Context, actor Actor, storeID, productID uuid.UUID, in PricesInput) (*domain.ProductView, error) {
	if in.SellPrice != nil && in.SellPrice.IsNegative() {
		return nil, domain.ErrValidation.With("field", "sell_price")
	}
	if !validTiers(in.PriceTiers) {
		return nil, domain.ErrValidation.With("field", "price_tiers")
	}
	var out *domain.ProductView
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		cur, err := s.products.Get(ctx, storeID, productID)
		if err != nil {
			return err
		}
		if in.SellPrice != nil {
			if err := s.products.SetSellPrice(ctx, storeID, productID, in.SellPrice.Round(2)); err != nil {
				return err
			}
		}
		if err := s.products.ReplaceTiers(ctx, productID, in.PriceTiers); err != nil {
			return err
		}
		if out, err = s.products.Get(ctx, storeID, productID); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "product.prices", "product", productID,
			map[string]any{"sell_price": cur.SellPrice, "price_tiers": cur.PriceTiers},
			map[string]any{"sell_price": out.SellPrice, "price_tiers": out.PriceTiers})
	})
	if err != nil {
		return nil, err
	}
	out.StockLevel = StockLevel(out.StockOnHand, out.MinLevel1, out.MinLevel2)
	return out, nil
}

// LowStock lists active, non-archived products at or below min_level1, flagged warning/critical.
func (s *Service) LowStock(ctx context.Context, storeID uuid.UUID) ([]domain.ProductView, error) {
	active, archived := true, false
	var out []domain.ProductView
	err := s.tx(ctx, storeID, func(ctx context.Context) (err error) {
		out, _, err = s.products.List(ctx, storeID, postgres.ProductFilter{Active: &active, Archived: &archived, LowStock: true, Limit: 1000, Offset: 0})
		return
	})
	decorateLevels(out)
	return out, err
}

// ---- labels ---------------------------------------------------------------------

func (s *Service) Labels(ctx context.Context, storeID uuid.UUID, ids []uuid.UUID, templateCode string, copies int) (*domain.LabelSheet, error) {
	if copies < 1 {
		copies = 1
	}
	if copies > 100 {
		copies = 100
	}
	sheet := &domain.LabelSheet{TemplateCode: templateCode, Labels: []domain.Label{}}
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		if templateCode != "" {
			t, err := s.labels.GetByCode(ctx, storeID, templateCode)
			if err != nil && err != domain.ErrNotFound {
				return err
			}
			sheet.Template = t
		}
		views, err := s.products.GetMany(ctx, storeID, ids)
		if err != nil {
			return err
		}
		byID := make(map[uuid.UUID]domain.ProductView, len(views))
		for _, v := range views {
			byID[v.ID] = v
		}
		for _, id := range ids { // keep the requested order
			v, ok := byID[id]
			if !ok {
				continue
			}
			code := v.PrimaryBarcode
			if code == "" {
				code = v.SKU
			}
			for i := 0; i < copies; i++ {
				sheet.Labels = append(sheet.Labels, domain.Label{SKU: v.SKU, Barcode: code, Name: v.Name, Price: v.SellPrice})
			}
		}
		return nil
	})
	return sheet, err
}

type LabelTemplateInput struct {
	Code    *string        `json:"code"`
	Name    *string        `json:"name"`
	Paper   *string        `json:"paper"`
	Columns *int           `json:"columns"`
	Rows    *int           `json:"rows"`
	Dims    map[string]any `json:"dims"`
	Fonts   map[string]any `json:"fonts"`
	Visible map[string]any `json:"visible"`
}

func (in LabelTemplateInput) applyTo(t *domain.LabelTemplate) error {
	if in.Code != nil {
		t.Code = strings.TrimSpace(*in.Code)
	}
	if in.Name != nil {
		t.Name = strings.TrimSpace(*in.Name)
	}
	if in.Paper != nil {
		t.Paper = strings.TrimSpace(*in.Paper)
	}
	if in.Columns != nil {
		t.Columns = *in.Columns
	}
	if in.Rows != nil {
		t.Rows = *in.Rows
	}
	if in.Dims != nil {
		t.Dims = in.Dims
	}
	if in.Fonts != nil {
		t.Fonts = in.Fonts
	}
	if in.Visible != nil {
		t.Visible = in.Visible
	}
	switch {
	case t.Code == "":
		return domain.ErrValidation.With("field", "code")
	case t.Name == "":
		return domain.ErrValidation.With("field", "name")
	case t.Columns < 1 || t.Rows < 1:
		return domain.ErrValidation.With("field", "columns/rows")
	}
	return nil
}

func (s *Service) ListLabelTemplates(ctx context.Context, storeID uuid.UUID) ([]domain.LabelTemplate, error) {
	var out []domain.LabelTemplate
	err := s.tx(ctx, storeID, func(ctx context.Context) (err error) {
		out, err = s.labels.List(ctx, storeID)
		return
	})
	return out, err
}

func (s *Service) CreateLabelTemplate(ctx context.Context, actor Actor, storeID uuid.UUID, in LabelTemplateInput) (*domain.LabelTemplate, error) {
	t := domain.LabelTemplate{StoreID: storeID, Paper: "A4", Columns: 4, Rows: 11, Dims: map[string]any{}, Fonts: map[string]any{}, Visible: map[string]any{}}
	if err := in.applyTo(&t); err != nil {
		return nil, err
	}
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		if err := s.labels.Create(ctx, &t); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "label_template.create", "barcode_label_template", t.ID, nil, t)
	})
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Service) UpdateLabelTemplate(ctx context.Context, actor Actor, storeID, id uuid.UUID, in LabelTemplateInput) (*domain.LabelTemplate, error) {
	var out *domain.LabelTemplate
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		cur, err := s.labels.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		t := *cur
		if err := in.applyTo(&t); err != nil {
			return err
		}
		if err := s.labels.Update(ctx, &t); err != nil {
			return err
		}
		if out, err = s.labels.Get(ctx, storeID, id); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "label_template.update", "barcode_label_template", id, cur, out)
	})
	return out, err
}
