// Package inventoryuc owns the stock ledger: goods receipts, adjustments, stock takes and valuation.
package inventoryuc

import (
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
)

// MovingAverage returns the new average cost after receiving qty at unitCost.
// avg = (max(oldStock,0)*oldAvg + qty*unitCost) / (max(oldStock,0)+qty); when that denominator is <= 0 the result is unitCost.
// Negative on-hand stock is treated as zero so a backordered product does not distort the average. Result is 4 dp.
func MovingAverage(oldStock, oldAvg, qty, unitCost decimal.Decimal) decimal.Decimal {
	base := oldStock
	if base.Sign() < 0 {
		base = decimal.Zero
	}
	denom := base.Add(qty)
	if denom.Sign() <= 0 {
		return unitCost.Round(4)
	}
	return base.Mul(oldAvg).Add(qty.Mul(unitCost)).Div(denom).Round(4)
}

// ReceiptTotals sums qty*unit_cost per line (2 dp each) and returns subtotal and total (= subtotal + vat).
func ReceiptTotals(lines []domain.ReceiptLine, vat decimal.Decimal) (subtotal, total decimal.Decimal) {
	for _, l := range lines {
		subtotal = subtotal.Add(l.Qty.Mul(l.UnitCost).Round(2))
	}
	return subtotal, subtotal.Add(vat.Round(2))
}

// Variance is counted - system; nil (uncounted) lines have zero variance.
func Variance(system decimal.Decimal, counted *decimal.Decimal) decimal.Decimal {
	if counted == nil {
		return decimal.Zero
	}
	return counted.Sub(system)
}

// ApplyVariances fills Variance on every line (in place) and returns the lines that need a stock movement:
// counted, and different from the system quantity.
func ApplyVariances(lines []domain.StockTakeLine) []domain.StockTakeLine {
	diff := []domain.StockTakeLine{}
	for i := range lines {
		lines[i].Variance = Variance(lines[i].SystemQty, lines[i].CountedQty)
		if lines[i].CountedQty != nil && lines[i].Variance.Sign() != 0 {
			diff = append(diff, lines[i])
		}
	}
	return diff
}

// VarianceSummary aggregates a stock take for the audit trail / UI header.
type VarianceSummary struct {
	Lines     int             `json:"lines"`
	Counted   int             `json:"counted"`
	Differing int             `json:"differing"`
	QtyOver   decimal.Decimal `json:"qty_over"`
	QtyShort  decimal.Decimal `json:"qty_short"`
	ValueDiff decimal.Decimal `json:"value_diff"` // Σ variance × cost_avg (2 dp)
}

func Summarize(lines []domain.StockTakeLine) VarianceSummary {
	s := VarianceSummary{Lines: len(lines)}
	for _, l := range lines {
		if l.CountedQty == nil {
			continue
		}
		s.Counted++
		v := Variance(l.SystemQty, l.CountedQty)
		switch {
		case v.Sign() > 0:
			s.Differing++
			s.QtyOver = s.QtyOver.Add(v)
		case v.Sign() < 0:
			s.Differing++
			s.QtyShort = s.QtyShort.Add(v.Abs())
		}
		s.ValueDiff = s.ValueDiff.Add(v.Mul(l.CostAvg))
	}
	s.ValueDiff = s.ValueDiff.Round(2)
	return s
}
