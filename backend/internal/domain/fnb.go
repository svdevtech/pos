package domain

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// Restaurant / café entities (docs/FNB_POS_PLAN.md §4 and §9). A store with Kind == StoreKindFnb
// sells from a menu of items made to recipes; a retail store never touches any of this.

// Store kinds.
const (
	StoreKindRetail = "retail"
	StoreKindFnb    = "fnb"
)

// Stock movement types added for F&B (0013). The values already in inventory.go stay as they are.
const (
	MoveRecipe     = "recipe"     // ingredients taken when a dish is made
	MoveProduction = "production" // a batch (stock, syrup) made from ingredients
	MoveWaste      = "waste"      // made and thrown away
)

// RefOrderItem is the ref_type of a stock movement caused by an order line.
const RefOrderItem = "order_item"

// Order channels: where the order came from.
type OrderChannel string

const (
	ChannelCounter   OrderChannel = "counter"
	ChannelDineIn    OrderChannel = "dine_in"
	ChannelTakeaway  OrderChannel = "takeaway"
	ChannelDelivery  OrderChannel = "delivery"
	ChannelSelfOrder OrderChannel = "self_order"
)

func (c OrderChannel) Valid() bool {
	switch c {
	case ChannelCounter, ChannelDineIn, ChannelTakeaway, ChannelDelivery, ChannelSelfOrder:
		return true
	}
	return false
}

// Order statuses.
type OrderStatus string

const (
	OrderOpen   OrderStatus = "open"
	OrderPaid   OrderStatus = "paid"
	OrderClosed OrderStatus = "closed"
	OrderVoid   OrderStatus = "void"
)

// Order item statuses, in the order a dish moves through them.
type ItemStatus string

const (
	ItemSent      ItemStatus = "sent"
	ItemPreparing ItemStatus = "preparing"
	ItemReady     ItemStatus = "ready"
	ItemServed    ItemStatus = "served"
	ItemVoid      ItemStatus = "void"
)

func (s ItemStatus) Valid() bool {
	switch s {
	case ItemSent, ItemPreparing, ItemReady, ItemServed, ItemVoid:
		return true
	}
	return false
}

// When a recipe is taken off stock (ตั้งค่า fnb.deduct_on). OnSend is what the shop asked for:
// "when the dish is made".
const (
	DeductOnSend  = "on_send"
	DeductOnReady = "on_ready"
	DeductOnPay   = "on_pay"
)

// Station output: how the kitchen is told about a dish.
const (
	StationKDS     = "kds"
	StationPrinter = "printer"
	StationBoth    = "both"
)

// FloorZone is a part of the room (indoor, terrace, bar); FloorTable a table in it, placed in
// metres so the floor plans draw the room to scale. Orders and QR tokens know a table by Code.
type FloorZone struct {
	ID       uuid.UUID `json:"id"`
	StoreID  uuid.UUID `json:"store_id"`
	Name     string    `json:"name"`
	NameEn   string    `json:"name_en,omitempty"`
	Color    string    `json:"color"`
	Sort     int       `json:"sort"`
	IsActive bool      `json:"is_active"`
}

type FloorTable struct {
	ID       uuid.UUID       `json:"id"`
	StoreID  uuid.UUID       `json:"store_id"`
	ZoneID   *uuid.UUID      `json:"zone_id,omitempty"`
	Code     string          `json:"code"`
	Seats    int             `json:"seats"`
	X        decimal.Decimal `json:"x"`
	Y        decimal.Decimal `json:"y"`
	Shape    string          `json:"shape"` // round | square | long
	Rotation int             `json:"rotation"`
	Sort     int             `json:"sort"`
	IsActive bool            `json:"is_active"`
}

type KitchenStation struct {
	ID          uuid.UUID `json:"id"`
	StoreID     uuid.UUID `json:"store_id"`
	Name        string    `json:"name"`
	NameEn      string    `json:"name_en,omitempty"`
	Output      string    `json:"output"`
	PrinterName string    `json:"printer_name,omitempty"`
	Sort        int       `json:"sort"`
	IsActive    bool      `json:"is_active"`
}

type MenuCategory struct {
	ID       uuid.UUID `json:"id"`
	StoreID  uuid.UUID `json:"store_id"`
	Name     string    `json:"name"`
	NameEn   string    `json:"name_en,omitempty"`
	Sort     int       `json:"sort"`
	IsActive bool      `json:"is_active"`
}

type MenuItem struct {
	ID               uuid.UUID       `json:"id"`
	StoreID          uuid.UUID       `json:"store_id"`
	CategoryID       *uuid.UUID      `json:"category_id,omitempty"`
	ProductID        *uuid.UUID      `json:"product_id,omitempty"`
	StationID        *uuid.UUID      `json:"station_id,omitempty"`
	Name             string          `json:"name"`
	NameEn           string          `json:"name_en,omitempty"`
	Price            decimal.Decimal `json:"price"`
	ImageURL         string          `json:"image_url,omitempty"`
	Channels         []string        `json:"channels"`
	Sort             int             `json:"sort"`
	IsActive         bool            `json:"is_active"`
	ModifierGroupIDs []uuid.UUID     `json:"modifier_group_ids"`
	Recipe           *Recipe         `json:"recipe,omitempty"`
}

type ModifierGroup struct {
	ID        uuid.UUID  `json:"id"`
	StoreID   uuid.UUID  `json:"store_id"`
	Name      string     `json:"name"`
	NameEn    string     `json:"name_en,omitempty"`
	MinSelect int        `json:"min_select"`
	MaxSelect int        `json:"max_select"`
	Sort      int        `json:"sort"`
	IsActive  bool       `json:"is_active"`
	Modifiers []Modifier `json:"modifiers"`
}

type Modifier struct {
	ID         uuid.UUID       `json:"id"`
	StoreID    uuid.UUID       `json:"store_id"`
	GroupID    uuid.UUID       `json:"group_id"`
	Name       string          `json:"name"`
	NameEn     string          `json:"name_en,omitempty"`
	PriceDelta decimal.Decimal `json:"price_delta"`
	IsDefault  bool            `json:"is_default"`
	Sort       int             `json:"sort"`
	IsActive   bool            `json:"is_active"`
	// An option's own ingredient lines (an extra shot adds beans; oat milk replaces milk).
	Lines []RecipeLine `json:"lines,omitempty"`
}

type Recipe struct {
	ID         uuid.UUID       `json:"id"`
	StoreID    uuid.UUID       `json:"store_id"`
	MenuItemID uuid.UUID       `json:"menu_item_id"`
	YieldQty   decimal.Decimal `json:"yield_qty"`
	Note       string          `json:"note,omitempty"`
	Lines      []RecipeLine    `json:"lines"`
}

// RecipeLine is one ingredient of a recipe or of a modifier (see 0013 for the field meanings).
type RecipeLine struct {
	ID                  uuid.UUID       `json:"id"`
	RecipeID            *uuid.UUID      `json:"recipe_id,omitempty"`
	ModifierID          *uuid.UUID      `json:"modifier_id,omitempty"`
	IngredientProductID uuid.UUID       `json:"ingredient_product_id"`
	IngredientName      string          `json:"ingredient_name,omitempty"`
	Qty                 decimal.Decimal `json:"qty"`
	UnitID              *uuid.UUID      `json:"unit_id,omitempty"`
	UnitName            string          `json:"unit_name,omitempty"`
	FactorToStock       decimal.Decimal `json:"factor_to_stock"`
	WastePct            decimal.Decimal `json:"waste_pct"`
	Mode                string          `json:"mode"` // add | replace
	ReplacesProductID   *uuid.UUID      `json:"replaces_product_id,omitempty"`
	Sort                int             `json:"sort"`
}

type Order struct {
	ID        uuid.UUID    `json:"id"`
	StoreID   uuid.UUID    `json:"store_id"`
	OrderNo   int          `json:"order_no"`
	Channel   OrderChannel `json:"channel"`
	TableCode string       `json:"table_code,omitempty"`
	Guests    int          `json:"guests,omitempty"`
	Status    OrderStatus  `json:"status"`
	// SaleID is the bill that settled the order, once it was paid.
	SaleID        *uuid.UUID      `json:"sale_id,omitempty"`
	ServiceCharge decimal.Decimal `json:"service_charge"`
	Note          string          `json:"note,omitempty"`
	CreatedBy     *uuid.UUID      `json:"created_by,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
	ClosedAt      *time.Time      `json:"closed_at,omitempty"`
	Items         []OrderItem     `json:"items"`
}

// Total of the lines that were not voided, before service charge.
func (o Order) Subtotal() decimal.Decimal {
	t := decimal.Zero
	for _, it := range o.Items {
		if it.Status != ItemVoid {
			t = t.Add(it.LineTotal())
		}
	}
	return Money(t)
}

type OrderItem struct {
	ID         uuid.UUID           `json:"id"`
	StoreID    uuid.UUID           `json:"store_id"`
	OrderID    uuid.UUID           `json:"order_id"`
	MenuItemID *uuid.UUID          `json:"menu_item_id,omitempty"`
	StationID  *uuid.UUID          `json:"station_id,omitempty"`
	Name       string              `json:"name"`
	Qty        decimal.Decimal     `json:"qty"`
	UnitPrice  decimal.Decimal     `json:"unit_price"`
	Cost       decimal.Decimal     `json:"cost"`
	Seat       int                 `json:"seat,omitempty"`
	Course     int                 `json:"course"`
	Note       string              `json:"note,omitempty"`
	Status     ItemStatus          `json:"status"`
	Deducted   bool                `json:"deducted"`
	Sort       int                 `json:"sort"`
	SentAt     time.Time           `json:"sent_at"`
	ReadyAt    *time.Time          `json:"ready_at,omitempty"`
	ServedAt   *time.Time          `json:"served_at,omitempty"`
	Modifiers  []OrderItemModifier `json:"modifiers"`
}

// LineTotal is (unit price + the options' deltas) × qty.
func (it OrderItem) LineTotal() decimal.Decimal {
	unit := it.UnitPrice
	for _, m := range it.Modifiers {
		unit = unit.Add(m.PriceDelta)
	}
	return Money(unit.Mul(it.Qty))
}

type OrderItemModifier struct {
	ID          uuid.UUID       `json:"id"`
	OrderItemID uuid.UUID       `json:"order_item_id"`
	ModifierID  *uuid.UUID      `json:"modifier_id,omitempty"`
	Name        string          `json:"name"`
	PriceDelta  decimal.Decimal `json:"price_delta"`
}

type OrderEvent struct {
	ID      int64      `json:"id"`
	OrderID uuid.UUID  `json:"order_id"`
	ItemID  *uuid.UUID `json:"item_id,omitempty"`
	Kind    string     `json:"kind"`
	Detail  any        `json:"detail,omitempty"`
	ByUser  *uuid.UUID `json:"by_user,omitempty"`
	At      time.Time  `json:"at"`
}
