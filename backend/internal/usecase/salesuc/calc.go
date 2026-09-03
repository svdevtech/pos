// Package salesuc implements the cashier workflow: cart pricing, atomic sale posting, cancellation,
// returns, held bills, shifts and cash-drawer logging.
package salesuc

import (
	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
)

// CartLine is a priced line before posting.
type CartLine struct {
	ProductID   uuid.UUID
	SKU         string
	Description string
	Qty         decimal.Decimal
	UnitPrice   decimal.Decimal // price actually charged (after tier / manual override)
	Discount    decimal.Decimal // ฿ per line (manual)
	IsFree      bool
	SerialNo    string
	CostLast    decimal.Decimal
	CostAvg     decimal.Decimal
	PromotionID *uuid.UUID
	PromoDisc   decimal.Decimal // ฿ from promotions (added to Discount at posting)
}

// LineTotal = qty*price - discount - promo, never below zero. Free lines total 0.
func (l CartLine) LineTotal() decimal.Decimal {
	if l.IsFree {
		return decimal.Zero
	}
	t := domain.Money(l.Qty.Mul(l.UnitPrice)).Sub(l.Discount).Sub(l.PromoDisc)
	if t.IsNegative() {
		return decimal.Zero
	}
	return domain.Money(t)
}

// Totals of a cart.
type Totals struct {
	Gross        decimal.Decimal // Σ qty*price (before any discount)
	LineDiscount decimal.Decimal // Σ manual + promo line discounts
	BillDiscount decimal.Decimal
	Net          decimal.Decimal
}

// Compute prices the cart: applies product promotions per line and bill promotions on the subtotal,
// then a manual bill discount (amount or percent). Returns totals and the (mutated) lines.
func Compute(lines []CartLine, promos []domain.Promotion, billDiscount decimal.Decimal, billDiscountPct decimal.Decimal) (Totals, []CartLine) {
	out := make([]CartLine, len(lines))
	copy(out, lines)
	var t Totals
	// product-scope promotions
	for i := range out {
		l := &out[i]
		l.PromoDisc = decimal.Zero
		l.PromotionID = nil
		if l.IsFree {
			continue
		}
		for pi := range promos {
			p := &promos[pi]
			if p.Scope != "product" || p.ProductID == nil || *p.ProductID != l.ProductID {
				continue
			}
			if l.Qty.LessThan(p.MinQty) || p.MinQty.IsZero() && l.Qty.LessThanOrEqual(decimal.Zero) {
				continue
			}
			var d decimal.Decimal
			base := l.Qty.Mul(l.UnitPrice)
			switch p.DiscountType {
			case "percent":
				d = base.Mul(p.DiscountValue).Div(decimal.NewFromInt(100))
			default:
				// amount per qualifying group of MinQty (or per line when MinQty==0)
				if p.MinQty.IsPositive() {
					groups := l.Qty.Div(p.MinQty).Floor()
					d = p.DiscountValue.Mul(groups)
				} else {
					d = p.DiscountValue
				}
			}
			d = domain.Money(d)
			if d.GreaterThan(l.PromoDisc) { // best promotion wins
				l.PromoDisc = d
				id := p.ID
				l.PromotionID = &id
			}
		}
	}
	for _, l := range out {
		if l.IsFree {
			continue
		}
		t.Gross = t.Gross.Add(domain.Money(l.Qty.Mul(l.UnitPrice)))
		t.LineDiscount = t.LineDiscount.Add(l.Discount).Add(l.PromoDisc)
	}
	sub := t.Gross.Sub(t.LineDiscount)
	if sub.IsNegative() {
		sub = decimal.Zero
	}
	// bill-scope promotions (best one)
	best := decimal.Zero
	for _, p := range promos {
		if p.Scope != "bill" || sub.LessThan(p.MinAmount) || sub.IsZero() {
			continue
		}
		var d decimal.Decimal
		if p.DiscountType == "percent" {
			d = sub.Mul(p.DiscountValue).Div(decimal.NewFromInt(100))
		} else {
			d = p.DiscountValue
		}
		if d = domain.Money(d); d.GreaterThan(best) {
			best = d
		}
	}
	t.BillDiscount = best
	if billDiscountPct.IsPositive() {
		t.BillDiscount = t.BillDiscount.Add(domain.Money(sub.Mul(billDiscountPct).Div(decimal.NewFromInt(100))))
	}
	if billDiscount.IsPositive() {
		t.BillDiscount = t.BillDiscount.Add(domain.Money(billDiscount))
	}
	if t.BillDiscount.GreaterThan(sub) {
		t.BillDiscount = sub
	}
	t.Net = domain.Money(sub.Sub(t.BillDiscount))
	return t, out
}

// TierPrice picks the member's tier price when configured (> 0), else the base sell price.
func TierPrice(base decimal.Decimal, tiers map[int]decimal.Decimal, tier int) decimal.Decimal {
	if tier >= 1 && tier <= 4 {
		if p, ok := tiers[tier]; ok && p.IsPositive() {
			return p
		}
	}
	return base
}

// Tender describes one payment on a bill.
type Tender struct {
	Method    domain.PaymentMethod `json:"method"`
	Amount    decimal.Decimal      `json:"amount"`
	Reference string               `json:"reference,omitempty"`
}

// SettleResult is the outcome of matching tenders against the amount due.
type SettleResult struct {
	Tendered decimal.Decimal
	Change   decimal.Decimal
	Credit   decimal.Decimal // amount put on the member's account
	CashIn   decimal.Decimal // cash received (for drawer)
}

// Settle validates tenders against net. Cash may exceed net (change given); non-cash may not.
// Credit covers whatever is not paid by other tenders when a credit tender is present (its amount is
// taken as the requested credit; when zero it means "the remainder").
func Settle(net decimal.Decimal, tenders []Tender) (SettleResult, error) {
	var r SettleResult
	nonCash := decimal.Zero
	cash := decimal.Zero
	credit := decimal.Zero
	hasCredit := false
	for _, t := range tenders {
		if !t.Method.Valid() {
			return r, domain.ErrValidation.With("field", "payments.method")
		}
		if t.Amount.IsNegative() {
			return r, domain.ErrValidation.With("field", "payments.amount")
		}
		switch t.Method {
		case domain.PayCash:
			cash = cash.Add(t.Amount)
		case domain.PayCredit:
			hasCredit = true
			credit = credit.Add(t.Amount)
		default:
			nonCash = nonCash.Add(t.Amount)
		}
	}
	if nonCash.GreaterThan(net) {
		return r, domain.ErrValidation.With("field", "payments").With("reason", "non-cash tenders exceed amount due")
	}
	remaining := net.Sub(nonCash)
	if hasCredit {
		if credit.IsZero() {
			credit = remaining.Sub(cash)
			if credit.IsNegative() {
				credit = decimal.Zero
			}
		}
		if credit.GreaterThan(remaining) {
			credit = remaining
		}
		remaining = remaining.Sub(credit)
	}
	if cash.LessThan(remaining) {
		return r, domain.ErrSalePaymentShort.With("short", domain.Money(remaining.Sub(cash)).StringFixed(2))
	}
	r.Change = domain.Money(cash.Sub(remaining))
	r.Tendered = domain.Money(cash.Add(nonCash).Add(credit))
	r.Credit = domain.Money(credit)
	r.CashIn = domain.Money(remaining)
	return r, nil
}
