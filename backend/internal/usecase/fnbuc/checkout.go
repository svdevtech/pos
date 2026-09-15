package fnbuc

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
	"github.com/svdev/pos/internal/usecase/salesuc"
)

// ---------------------------------------------------------------------------
// Checkout: one or more orders become a bill in the sales module
// ---------------------------------------------------------------------------

// Sales is the piece of the sales module checkout needs: posting a bill whose lines were priced
// here. The order's recipes already took the ingredients off stock, so the bill moves none.
type Sales interface {
	CreatePrepared(ctx context.Context, storeID uuid.UUID, actor salesuc.Actor, in salesuc.CreateSaleInput, p salesuc.Prepared) (*domain.Sale, error)
}

// CheckoutInput settles the given orders (normally every open order on a table) on one bill.
type CheckoutInput struct {
	OrderIDs []uuid.UUID      `json:"order_ids"`
	Payments []salesuc.Tender `json:"payments"`
	MemberID *uuid.UUID       `json:"member_id,omitempty"`
	Note     string           `json:"note,omitempty"`
	Terminal string           `json:"terminal,omitempty"`
}

// CheckoutQuote is what the tender screen shows before any money changes hands.
type CheckoutQuote struct {
	Subtotal      decimal.Decimal `json:"subtotal"`
	ServicePct    decimal.Decimal `json:"service_pct"`
	ServiceCharge decimal.Decimal `json:"service_charge"`
	VATMode       string          `json:"vat_mode"` // none | included | excluded
	VATPct        decimal.Decimal `json:"vat_pct"`
	VAT           decimal.Decimal `json:"vat"`
	// Net is before cash rounding, which the sales module applies at posting.
	Net decimal.Decimal `json:"net"`
}

// fnbMoney reads the money settings under settings["fnb"]: service charge and VAT.
type fnbMoney struct {
	servicePct decimal.Decimal
	vatMode    string
	vatPct     decimal.Decimal
}

func moneySettings(settings domain.StoreSettings) fnbMoney {
	m := fnbMoney{vatMode: "none", vatPct: decimal.NewFromInt(7)}
	v, ok := settings["fnb"].(map[string]any)
	if !ok {
		return m
	}
	if p := numberSetting(v["service_charge_pct"]); p.IsPositive() {
		m.servicePct = p
	}
	if mode, ok := v["vat_mode"].(string); ok && (mode == "included" || mode == "excluded") {
		m.vatMode = mode
	}
	if p := numberSetting(v["vat_pct"]); p.IsPositive() {
		m.vatPct = p
	}
	return m
}

func numberSetting(v any) decimal.Decimal {
	switch x := v.(type) {
	case float64:
		return decimal.NewFromFloat(x)
	case string:
		d, err := decimal.NewFromString(strings.TrimSpace(x))
		if err == nil {
			return d
		}
	}
	return decimal.Zero
}

func pct(amount, p decimal.Decimal) decimal.Decimal {
	return domain.Money(amount.Mul(p).Div(decimal.NewFromInt(100)))
}

// priceOrders turns the orders' live lines into a priced cart plus the service charge and VAT
// lines the shop's settings call for, and the quote that goes with it.
func priceOrders(orders []*domain.Order, m fnbMoney, items map[uuid.UUID]domain.MenuItem) ([]salesuc.CartLine, CheckoutQuote) {
	var lines []salesuc.CartLine
	sub := decimal.Zero
	for _, o := range orders {
		for _, it := range o.Items {
			if it.Status == domain.ItemVoid {
				continue
			}
			unit := it.UnitPrice
			desc := it.Name
			if len(it.Modifiers) > 0 {
				names := make([]string, 0, len(it.Modifiers))
				for _, md := range it.Modifiers {
					unit = unit.Add(md.PriceDelta)
					names = append(names, md.Name)
				}
				desc += " (" + strings.Join(names, ", ") + ")"
			}
			cl := salesuc.CartLine{Description: desc, Qty: it.Qty, UnitPrice: domain.Money(unit)}
			if it.Qty.IsPositive() {
				cl.CostAvg = domain.Money(it.Cost.Div(it.Qty))
				cl.CostLast = cl.CostAvg
			}
			if it.MenuItemID != nil {
				if mi, ok := items[*it.MenuItemID]; ok && mi.ProductID != nil {
					cl.ProductID = *mi.ProductID
				}
			}
			lines = append(lines, cl)
			sub = sub.Add(cl.LineTotal())
		}
	}
	q := CheckoutQuote{Subtotal: domain.Money(sub), ServicePct: m.servicePct, VATMode: m.vatMode, VATPct: m.vatPct}
	if m.servicePct.IsPositive() {
		q.ServiceCharge = pct(sub, m.servicePct)
		lines = append(lines, salesuc.CartLine{Description: fmt.Sprintf("ค่าบริการ / Service charge %s%%", m.servicePct.String()), Qty: decimal.NewFromInt(1), UnitPrice: q.ServiceCharge})
	}
	base := q.Subtotal.Add(q.ServiceCharge)
	switch m.vatMode {
	case "excluded":
		q.VAT = pct(base, m.vatPct)
		lines = append(lines, salesuc.CartLine{Description: fmt.Sprintf("ภาษีมูลค่าเพิ่ม / VAT %s%%", m.vatPct.String()), Qty: decimal.NewFromInt(1), UnitPrice: q.VAT})
		q.Net = base.Add(q.VAT)
	case "included":
		// the price already carries the tax; this is the part of it that is tax
		q.VAT = domain.Money(base.Mul(m.vatPct).Div(decimal.NewFromInt(100).Add(m.vatPct)))
		q.Net = base
	default:
		q.Net = base
	}
	return lines, q
}

func (s *Service) loadOrders(ctx context.Context, storeID uuid.UUID, ids []uuid.UUID) ([]*domain.Order, error) {
	if len(ids) == 0 {
		return nil, domain.ErrValidation.With("field", "order_ids")
	}
	out := make([]*domain.Order, 0, len(ids))
	seen := map[uuid.UUID]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		o, err := s.repo.GetOrder(ctx, storeID, id)
		if err != nil {
			return nil, err
		}
		if o.Status != domain.OrderOpen {
			return nil, domain.ErrOrderClosed
		}
		out = append(out, o)
	}
	return out, nil
}

// Quote prices the orders the way Checkout will, for the tender screen.
func (s *Service) Quote(ctx context.Context, storeID uuid.UUID, orderIDs []uuid.UUID) (*CheckoutQuote, error) {
	var q CheckoutQuote
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		orders, err := s.loadOrders(ctx, storeID, orderIDs)
		if err != nil {
			return err
		}
		settings, _ := s.stores.GetSettings(ctx, storeID)
		ix, err := s.index(ctx, storeID)
		if err != nil {
			return err
		}
		_, q = priceOrders(orders, moneySettings(settings), ix.items)
		return nil
	})
	return &q, err
}

// Checkout posts one bill for the orders through the sales module — every payment method, the
// shift, the drawer and the reports all see it like any other sale — then marks the orders paid.
// Under deduct_on = on_pay this is also the moment the recipes take their ingredients.
func (s *Service) Checkout(ctx context.Context, storeID uuid.UUID, actor Actor, in CheckoutInput) (*domain.Sale, error) {
	if s.sales == nil {
		return nil, domain.ErrValidation.With("reason", "sales module not wired")
	}
	var sale *domain.Sale
	var orders []*domain.Order
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		orders, err = s.loadOrders(ctx, storeID, in.OrderIDs)
		if err != nil {
			return err
		}
		settings, _ := s.stores.GetSettings(ctx, storeID)
		ix, err := s.index(ctx, storeID)
		if err != nil {
			return err
		}
		if deductOn(settings) == domain.DeductOnPay {
			for _, o := range orders {
				for i := range o.Items {
					it := &o.Items[i]
					if it.Status == domain.ItemVoid || it.Deducted || it.MenuItemID == nil {
						continue
					}
					item, ok := ix.items[*it.MenuItemID]
					if !ok {
						continue
					}
					if err := s.deduct(ctx, storeID, actor, it, item, ix.modifiersOf(it)); err != nil {
						return err
					}
				}
			}
		}
		lines, q := priceOrders(orders, moneySettings(settings), ix.items)
		if len(lines) == 0 {
			return domain.ErrOrderEmpty
		}
		note := strings.TrimSpace(in.Note)
		nos := make([]string, 0, len(orders))
		for _, o := range orders {
			nos = append(nos, fmt.Sprintf("#%d", o.OrderNo))
		}
		tag := "order " + strings.Join(nos, ",")
		if orders[0].TableCode != "" {
			tag += " table " + orders[0].TableCode
		}
		if note == "" {
			note = tag
		} else {
			note = tag + " · " + note
		}
		sale, err = s.sales.CreatePrepared(ctx, storeID, salesuc.Actor{UserID: actor.UserID, Name: actor.Name},
			salesuc.CreateSaleInput{MemberID: in.MemberID, Payments: in.Payments, Note: note, Terminal: in.Terminal},
			salesuc.Prepared{Lines: lines, OrderID: &orders[0].ID, VAT: q.VAT})
		if err != nil {
			return err
		}
		for _, o := range orders {
			if err := s.repo.SetOrderPaid(ctx, storeID, o.ID, sale.ID); err != nil {
				return err
			}
			if err := s.repo.InsertEvent(ctx, storeID, o.ID, nil, "order:paid", map[string]any{"sale_id": sale.ID, "doc_no": sale.DocNo}, actor.idPtr()); err != nil {
				return err
			}
			// a counter or takeaway order with nothing left to make is finished the moment it is paid
			if o.TableCode == "" && allDone(o.Items) {
				if err := s.repo.SetOrderStatus(ctx, storeID, o.ID, domain.OrderClosed); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	for _, o := range orders {
		if cur, err := s.Get(ctx, storeID, o.ID); err == nil {
			s.hub.Publish(storeID, Event{Kind: "updated", Order: cur})
		}
	}
	return sale, nil
}

// allDone is true when every live line has been served (or there are none).
func allDone(items []domain.OrderItem) bool {
	for _, it := range items {
		if it.Status != domain.ItemVoid && it.Status != domain.ItemServed {
			return false
		}
	}
	return true
}

// modifiersOf resolves a line's chosen modifiers against the menu, for recipe explosion.
func (ix *menuIndex) modifiersOf(it *domain.OrderItem) []domain.Modifier {
	mods := make([]domain.Modifier, 0, len(it.Modifiers))
	for _, m := range it.Modifiers {
		if m.ModifierID != nil {
			if md, ok := ix.modifiers[*m.ModifierID]; ok {
				mods = append(mods, md)
			}
		}
	}
	return mods
}
