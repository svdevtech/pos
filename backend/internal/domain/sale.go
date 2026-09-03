package domain

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type PaymentMethod string

const (
	PayCash     PaymentMethod = "cash"
	PayCredit   PaymentMethod = "credit"
	PayTransfer PaymentMethod = "transfer"
	PayCard     PaymentMethod = "card"
	PayQR       PaymentMethod = "qr"
	PayOther    PaymentMethod = "other"
)

func (m PaymentMethod) Valid() bool {
	switch m {
	case PayCash, PayCredit, PayTransfer, PayCard, PayQR, PayOther:
		return true
	}
	return false
}

type SaleStatus string

const (
	SaleCompleted     SaleStatus = "completed"
	SaleCancelled     SaleStatus = "cancelled"
	SaleRefunded      SaleStatus = "refunded"
	SalePartialRefund SaleStatus = "partial_refund"
)

type ARStatus string

const (
	ARNone    ARStatus = "none"
	ARUnpaid  ARStatus = "unpaid"
	ARPartial ARStatus = "partial"
	ARPaid    ARStatus = "paid"
)

type Sale struct {
	ID              uuid.UUID       `json:"id"`
	StoreID         uuid.UUID       `json:"store_id"`
	DocNo           string          `json:"doc_no"`
	LegacyDupSeq    int16           `json:"legacy_dup_seq,omitempty"`
	SoldAt          time.Time       `json:"sold_at"`
	CashierID       *uuid.UUID      `json:"cashier_id,omitempty"`
	CashierName     string          `json:"cashier_name,omitempty"`
	MemberID        *uuid.UUID      `json:"member_id,omitempty"`
	MemberCode      string          `json:"member_code,omitempty"`
	MemberName      string          `json:"member_name,omitempty"`
	ShiftID         *uuid.UUID      `json:"shift_id,omitempty"`
	Gross           decimal.Decimal `json:"gross"`
	Discount        decimal.Decimal `json:"discount"`
	BillDiscount    decimal.Decimal `json:"bill_discount"`
	VAT             decimal.Decimal `json:"vat"`
	Net             decimal.Decimal `json:"net"`
	Tendered        decimal.Decimal `json:"tendered"`
	Change          decimal.Decimal `json:"change_amount"`
	Status          SaleStatus      `json:"status"`
	CancelledBy     *uuid.UUID      `json:"cancelled_by,omitempty"`
	CancelledByName string          `json:"cancelled_by_name,omitempty"`
	CancelledAt     *time.Time      `json:"cancelled_at,omitempty"`
	CancelReason    string          `json:"cancel_reason,omitempty"`
	ARStatus        ARStatus        `json:"ar_status"`
	ARTotal         decimal.Decimal `json:"ar_total"`
	ARPaid          decimal.Decimal `json:"ar_paid"`
	ARBalance       decimal.Decimal `json:"ar_balance"`
	Note            string          `json:"note,omitempty"`
	LegacyTender    *int16          `json:"legacy_tender,omitempty"`
	LegacyID        string          `json:"legacy_id,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
	Lines           []SaleLine      `json:"lines,omitempty"`
	Payments        []SalePayment   `json:"payments,omitempty"`
}

type SaleLine struct {
	ID          uuid.UUID       `json:"id"`
	SaleID      uuid.UUID       `json:"sale_id"`
	LineNo      int             `json:"line_no"`
	ProductID   *uuid.UUID      `json:"product_id,omitempty"`
	SKU         string          `json:"sku,omitempty"`
	Description string          `json:"description"`
	Qty         decimal.Decimal `json:"qty"`
	UnitPrice   decimal.Decimal `json:"unit_price"`
	Discount    decimal.Decimal `json:"discount"`
	LineTotal   decimal.Decimal `json:"line_total"`
	CostLast    decimal.Decimal `json:"cost_last"`
	CostAvg     decimal.Decimal `json:"cost_avg"`
	IsFree      bool            `json:"is_free"`
	SerialNo    string          `json:"serial_no,omitempty"`
	PromotionID *uuid.UUID      `json:"promotion_id,omitempty"`
	UnitName    string          `json:"unit_name,omitempty"`
	ReturnedQty decimal.Decimal `json:"returned_qty"`
}

type SalePayment struct {
	ID        uuid.UUID       `json:"id"`
	SaleID    uuid.UUID       `json:"sale_id"`
	Method    PaymentMethod   `json:"method"`
	Amount    decimal.Decimal `json:"amount"`
	Reference string          `json:"reference,omitempty"`
}

type Shift struct {
	ID           uuid.UUID        `json:"id"`
	StoreID      uuid.UUID        `json:"store_id"`
	CashierID    uuid.UUID        `json:"cashier_id"`
	CashierName  string           `json:"cashier_name,omitempty"`
	Terminal     string           `json:"terminal"`
	OpenedAt     time.Time        `json:"opened_at"`
	ClosedAt     *time.Time       `json:"closed_at,omitempty"`
	ClosedBy     *uuid.UUID       `json:"closed_by,omitempty"`
	OpeningFloat decimal.Decimal  `json:"opening_float"`
	CashSales    decimal.Decimal  `json:"cash_sales"`
	CashIn       decimal.Decimal  `json:"cash_in"`
	CashOut      decimal.Decimal  `json:"cash_out"`
	ExpectedCash *decimal.Decimal `json:"expected_cash,omitempty"`
	CountedCash  *decimal.Decimal `json:"counted_cash,omitempty"`
	Variance     *decimal.Decimal `json:"variance,omitempty"`
	Status       string           `json:"status"`
	Note         string           `json:"note,omitempty"`
}

type HeldBill struct {
	ID        uuid.UUID  `json:"id"`
	CashierID uuid.UUID  `json:"cashier_id"`
	Label     string     `json:"label,omitempty"`
	MemberID  *uuid.UUID `json:"member_id,omitempty"`
	Cart      []byte     `json:"-"`
	CartJSON  any        `json:"cart"`
	CreatedAt time.Time  `json:"created_at"`
	ExpiresAt time.Time  `json:"expires_at"`
}

type SaleReturn struct {
	ID           uuid.UUID        `json:"id"`
	DocNo        string           `json:"doc_no"`
	SaleID       uuid.UUID        `json:"sale_id"`
	SaleDocNo    string           `json:"sale_doc_no,omitempty"`
	ReturnedAt   time.Time        `json:"returned_at"`
	ProcessedBy  *uuid.UUID       `json:"processed_by,omitempty"`
	RefundMethod PaymentMethod    `json:"refund_method"`
	RefundAmount decimal.Decimal  `json:"refund_amount"`
	Restock      bool             `json:"restock"`
	Reason       string           `json:"reason,omitempty"`
	Lines        []SaleReturnLine `json:"lines,omitempty"`
}

type SaleReturnLine struct {
	ID         uuid.UUID       `json:"id"`
	SaleLineID uuid.UUID       `json:"sale_line_id"`
	ProductID  *uuid.UUID      `json:"product_id,omitempty"`
	Qty        decimal.Decimal `json:"qty"`
	UnitPrice  decimal.Decimal `json:"unit_price"`
	Amount     decimal.Decimal `json:"amount"`
}

type ARPayment struct {
	ID             uuid.UUID       `json:"id"`
	DocNo          string          `json:"doc_no,omitempty"`
	MemberID       *uuid.UUID      `json:"member_id,omitempty"`
	MemberCode     string          `json:"member_code,omitempty"`
	MemberName     string          `json:"member_name,omitempty"`
	SaleID         *uuid.UUID      `json:"sale_id,omitempty"`
	SaleDocNo      string          `json:"sale_doc_no,omitempty"`
	LegacyBillNo   string          `json:"legacy_bill_no,omitempty"`
	BillTotal      decimal.Decimal `json:"bill_total"`
	BalanceBefore  decimal.Decimal `json:"balance_before"`
	Amount         decimal.Decimal `json:"amount"`
	BalanceAfter   decimal.Decimal `json:"balance_after"`
	Method         PaymentMethod   `json:"method"`
	PaidAt         time.Time       `json:"paid_at"`
	ReceivedBy     *uuid.UUID      `json:"received_by,omitempty"`
	ReceivedByName string          `json:"received_by_name,omitempty"`
	Note           string          `json:"note,omitempty"`
}

type Promotion struct {
	ID            uuid.UUID       `json:"id"`
	Name          string          `json:"name"`
	Scope         string          `json:"scope"` // bill | product
	ProductID     *uuid.UUID      `json:"product_id,omitempty"`
	ProductName   string          `json:"product_name,omitempty"`
	MinQty        decimal.Decimal `json:"min_qty"`
	MinAmount     decimal.Decimal `json:"min_amount"`
	DiscountType  string          `json:"discount_type"` // amount | percent
	DiscountValue decimal.Decimal `json:"discount_value"`
	FreeQty       decimal.Decimal `json:"free_qty"`
	StartsAt      *time.Time      `json:"starts_at,omitempty"`
	EndsAt        *time.Time      `json:"ends_at,omitempty"`
	IsActive      bool            `json:"is_active"`
}

type Expense struct {
	ID            uuid.UUID       `json:"id"`
	TypeID        *uuid.UUID      `json:"type_id,omitempty"`
	TypeName      string          `json:"type_name,omitempty"`
	ExpensedAt    time.Time       `json:"expensed_at"`
	Amount        decimal.Decimal `json:"amount"`
	Note          string          `json:"note,omitempty"`
	PaidFrom      PaymentMethod   `json:"paid_from"`
	ShiftID       *uuid.UUID      `json:"shift_id,omitempty"`
	CreatedBy     *uuid.UUID      `json:"created_by,omitempty"`
	CreatedByName string          `json:"created_by_name,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
}

type ExpenseType struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	NameEN   string    `json:"name_en,omitempty"`
	IsActive bool      `json:"is_active"`
}

// Money rounds to 2 decimal places (half away from zero, as the legacy VB app did).
func Money(d decimal.Decimal) decimal.Decimal { return d.Round(2) }
