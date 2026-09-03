package domain

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// Category groups products (legacy "type").
type Category struct {
	ID        uuid.UUID `json:"id"`
	StoreID   uuid.UUID `json:"-"`
	Name      string    `json:"name"`
	NameEN    string    `json:"name_en,omitempty"`
	SortOrder int       `json:"sort_order"`
	IsActive  bool      `json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Unit is a unit of measure (piece, box, kg, ...).
type Unit struct {
	ID        uuid.UUID `json:"id"`
	StoreID   uuid.UUID `json:"-"`
	Name      string    `json:"name"`
	NameEN    string    `json:"name_en,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type Supplier struct {
	ID        uuid.UUID `json:"id"`
	StoreID   uuid.UUID `json:"-"`
	Code      string    `json:"code,omitempty"`
	Name      string    `json:"name"`
	Address   string    `json:"address,omitempty"`
	Phone     string    `json:"phone,omitempty"`
	Fax       string    `json:"fax,omitempty"`
	Email     string    `json:"email,omitempty"`
	TaxID     string    `json:"tax_id,omitempty"`
	Note      string    `json:"note,omitempty"`
	IsActive  bool      `json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Archive reasons stored in products.archived_reason.
const (
	ArchivedDeleted           = "deleted"
	ArchivedPlaceholderOrphan = "placeholder_orphan"
)

type Product struct {
	ID             uuid.UUID       `json:"id"`
	StoreID        uuid.UUID       `json:"-"`
	SKU            string          `json:"sku"`
	Name           string          `json:"name"`
	NameEN         string          `json:"name_en,omitempty"`
	CategoryID     *uuid.UUID      `json:"category_id,omitempty"`
	UnitID         *uuid.UUID      `json:"unit_id,omitempty"`
	CostLast       decimal.Decimal `json:"cost_last"`
	CostAvg        decimal.Decimal `json:"cost_avg"`
	SellPrice      decimal.Decimal `json:"sell_price"`
	StockOnHand    decimal.Decimal `json:"stock_on_hand"`
	MinLevel1      decimal.Decimal `json:"min_level1"`
	MinLevel2      decimal.Decimal `json:"min_level2"`
	IsSerial       bool            `json:"is_serial"`
	IsActive       bool            `json:"is_active"`
	IsArchived     bool            `json:"is_archived"`
	ArchivedReason string          `json:"archived_reason,omitempty"`
	ArchivedAt     *time.Time      `json:"archived_at,omitempty"`
	ImageURL       string          `json:"image_url,omitempty"`
	Note           string          `json:"note,omitempty"`
	LegacyID       string          `json:"legacy_id,omitempty"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

type ProductBarcode struct {
	ID        uuid.UUID       `json:"id"`
	ProductID uuid.UUID       `json:"product_id"`
	Barcode   string          `json:"barcode"`
	IsPrimary bool            `json:"is_primary"`
	PackQty   decimal.Decimal `json:"pack_qty"`
	CreatedAt time.Time       `json:"created_at"`
}

// PriceTiers maps tier (1..4) → price. JSON: {"1":"10.00","2":"9.50"}.
type PriceTiers map[int]decimal.Decimal

// Stock level flags returned by low-stock listings.
const (
	StockLevelOK       = "ok"
	StockLevelWarning  = "warning"  // stock <= min_level1
	StockLevelCritical = "critical" // stock <= min_level2
)

// ProductView is a product decorated with lookup names, barcodes and price tiers.
type ProductView struct {
	Product
	CategoryName   string           `json:"category_name,omitempty"`
	UnitName       string           `json:"unit_name,omitempty"`
	PrimaryBarcode string           `json:"primary_barcode,omitempty"`
	Barcodes       []ProductBarcode `json:"barcodes"`
	PriceTiers     PriceTiers       `json:"price_tiers"`
	StockLevel     string           `json:"stock_level"`
}

// BarcodeLookup is the result of scanning a barcode at the POS.
type BarcodeLookup struct {
	ProductView
	ScannedBarcode string          `json:"scanned_barcode"`
	PackQty        decimal.Decimal `json:"pack_qty"`
}

type LabelTemplate struct {
	ID        uuid.UUID      `json:"id"`
	StoreID   uuid.UUID      `json:"-"`
	Code      string         `json:"code"`
	Name      string         `json:"name"`
	Paper     string         `json:"paper"`
	Columns   int            `json:"columns"`
	Rows      int            `json:"rows"`
	Dims      map[string]any `json:"dims"`
	Fonts     map[string]any `json:"fonts"`
	Visible   map[string]any `json:"visible"`
	CreatedAt time.Time      `json:"created_at"`
}

// Label is one printable barcode label (rendering happens on the frontend).
type Label struct {
	SKU     string          `json:"sku"`
	Barcode string          `json:"barcode"`
	Name    string          `json:"name"`
	Price   decimal.Decimal `json:"price"`
}

type LabelSheet struct {
	TemplateCode string         `json:"template_code"`
	Template     *LabelTemplate `json:"template"` // nil when the store has no template with that code
	Labels       []Label        `json:"labels"`
}
