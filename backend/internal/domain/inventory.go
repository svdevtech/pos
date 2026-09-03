package domain

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// Stock movement types (enum stock_move_type).
const (
	MoveOpening       = "opening"
	MoveSale          = "sale"
	MoveSaleCancel    = "sale_cancel"
	MoveReturn        = "return"
	MoveReceipt       = "receipt"
	MoveReceiptCancel = "receipt_cancel"
	MoveAdjustment    = "adjustment"
	MoveStockTake     = "stocktake"
	MoveTransferIn    = "transfer_in"
	MoveTransferOut   = "transfer_out"
)

// Reference types stored in stock_movements.ref_type.
const (
	RefReceipt    = "purchase_receipt"
	RefAdjustment = "stock_adjustment"
	RefStockTake  = "stock_take"
	RefProduct    = "product"
)

// Receipt statuses (enum receipt_status).
const (
	ReceiptDraft     = "draft"
	ReceiptPosted    = "posted"
	ReceiptCancelled = "cancelled"
)

// Stock take statuses (enum stocktake_status).
const (
	StockTakeOpen      = "open"
	StockTakeFinalized = "finalized"
	StockTakeCancelled = "cancelled"
)

type PurchaseReceipt struct {
	ID             uuid.UUID       `json:"id"`
	StoreID        uuid.UUID       `json:"-"`
	DocNo          string          `json:"doc_no"`
	SupplierID     *uuid.UUID      `json:"supplier_id,omitempty"`
	SupplierName   string          `json:"supplier_name,omitempty"`
	SupplierRef    string          `json:"supplier_ref,omitempty"`
	ReceivedAt     time.Time       `json:"received_at"`
	ReceivedBy     *uuid.UUID      `json:"received_by,omitempty"`
	ReceivedByName string          `json:"received_by_name,omitempty"`
	Subtotal       decimal.Decimal `json:"subtotal"`
	VAT            decimal.Decimal `json:"vat"`
	Total          decimal.Decimal `json:"total"`
	Status         string          `json:"status"`
	Note           string          `json:"note,omitempty"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
	Lines          []ReceiptLine   `json:"lines,omitempty"`
}

type ReceiptLine struct {
	ID          uuid.UUID       `json:"id"`
	ReceiptID   uuid.UUID       `json:"receipt_id"`
	LineNo      int             `json:"line_no"`
	ProductID   *uuid.UUID      `json:"product_id,omitempty"`
	SKU         string          `json:"sku,omitempty"`
	Description string          `json:"description,omitempty"`
	Qty         decimal.Decimal `json:"qty"`
	UnitCost    decimal.Decimal `json:"unit_cost"`
	Total       decimal.Decimal `json:"total"`
}

type StockAdjustment struct {
	ID         uuid.UUID        `json:"id"`
	StoreID    uuid.UUID        `json:"-"`
	DocNo      string           `json:"doc_no"`
	Reason     string           `json:"reason"`
	Note       string           `json:"note,omitempty"`
	AdjustedAt time.Time        `json:"adjusted_at"`
	CreatedBy  *uuid.UUID       `json:"created_by,omitempty"`
	Lines      []AdjustmentLine `json:"lines,omitempty"`
}

type AdjustmentLine struct {
	ID          uuid.UUID        `json:"id"`
	ProductID   uuid.UUID        `json:"product_id"`
	SKU         string           `json:"sku,omitempty"`
	ProductName string           `json:"product_name,omitempty"`
	QtyDelta    decimal.Decimal  `json:"qty_delta"`
	UnitCost    *decimal.Decimal `json:"unit_cost,omitempty"`
	Note        string           `json:"note,omitempty"`
}

type StockTake struct {
	ID          uuid.UUID       `json:"id"`
	StoreID     uuid.UUID       `json:"-"`
	DocNo       string          `json:"doc_no"`
	Status      string          `json:"status"`
	Note        string          `json:"note,omitempty"`
	StartedAt   time.Time       `json:"started_at"`
	FinalizedAt *time.Time      `json:"finalized_at,omitempty"`
	CreatedBy   *uuid.UUID      `json:"created_by,omitempty"`
	LineCount   int             `json:"line_count"`
	Lines       []StockTakeLine `json:"lines,omitempty"`
}

type StockTakeLine struct {
	ID          uuid.UUID        `json:"id"`
	ProductID   uuid.UUID        `json:"product_id"`
	SKU         string           `json:"sku,omitempty"`
	ProductName string           `json:"product_name,omitempty"`
	CostAvg     decimal.Decimal  `json:"cost_avg"`
	SystemQty   decimal.Decimal  `json:"system_qty"`
	CountedQty  *decimal.Decimal `json:"counted_qty"`
	Variance    decimal.Decimal  `json:"variance"`
	Note        string           `json:"note,omitempty"`
}

type Valuation struct {
	Units       decimal.Decimal `json:"units"`
	CostValue   decimal.Decimal `json:"cost_value"`
	RetailValue decimal.Decimal `json:"retail_value"`
}
