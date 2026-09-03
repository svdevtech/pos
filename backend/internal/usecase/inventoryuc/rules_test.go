package inventoryuc

import (
	"testing"

	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
)

func d(s string) decimal.Decimal { return decimal.RequireFromString(s) }

func TestMovingAverage(t *testing.T) {
	cases := []struct {
		name                        string
		oldStock, oldAvg, qty, cost string
		want                        string
	}{
		{"first receipt into empty stock", "0", "0", "10", "12.5", "12.5"},
		{"blend equal quantities", "10", "10", "10", "20", "15"},
		{"blend unequal quantities", "30", "10", "10", "20", "12.5"},
		{"rounds to 4 dp", "1", "1", "2", "2", "1.6667"},
		{"negative stock treated as zero", "-5", "10", "10", "20", "20"},
		{"negative stock partially offset still uses new cost only", "-5", "10", "3", "7", "7"},
		{"zero qty keeps old average", "10", "10", "0", "99", "10"},
		{"zero qty on empty stock returns unit cost", "0", "0", "0", "99", "99"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := MovingAverage(d(c.oldStock), d(c.oldAvg), d(c.qty), d(c.cost))
			if !got.Equal(d(c.want)) {
				t.Fatalf("got %s want %s", got, c.want)
			}
		})
	}
}

func TestReceiptTotals(t *testing.T) {
	lines := []domain.ReceiptLine{{Qty: d("3"), UnitCost: d("1.005")}, {Qty: d("2"), UnitCost: d("10")}}
	sub, total := ReceiptTotals(lines, d("1.5"))
	if !sub.Equal(d("23.02")) { // 3.015 → 3.02 (half-up) + 20
		t.Fatalf("subtotal %s", sub)
	}
	if !total.Equal(d("24.52")) {
		t.Fatalf("total %s", total)
	}
}

func ptr(s string) *decimal.Decimal { v := d(s); return &v }

func TestApplyVariances(t *testing.T) {
	lines := []domain.StockTakeLine{
		{SystemQty: d("10"), CountedQty: ptr("8"), CostAvg: d("2")},   // short 2
		{SystemQty: d("5"), CountedQty: ptr("5"), CostAvg: d("3")},    // exact
		{SystemQty: d("1"), CountedQty: nil, CostAvg: d("4")},         // uncounted
		{SystemQty: d("0"), CountedQty: ptr("2.5"), CostAvg: d("10")}, // over 2.5
		{SystemQty: d("-3"), CountedQty: ptr("0"), CostAvg: d("1")},   // negative system, counted 0 → +3
	}
	diff := ApplyVariances(lines)
	wantVar := []string{"-2", "0", "0", "2.5", "3"}
	for i, w := range wantVar {
		if !lines[i].Variance.Equal(d(w)) {
			t.Fatalf("line %d variance %s want %s", i, lines[i].Variance, w)
		}
	}
	if len(diff) != 3 {
		t.Fatalf("expected 3 differing lines, got %d", len(diff))
	}
	if !diff[0].Variance.Equal(d("-2")) || !diff[1].Variance.Equal(d("2.5")) || !diff[2].Variance.Equal(d("3")) {
		t.Fatalf("unexpected diff set: %+v", diff)
	}

	s := Summarize(lines)
	if s.Lines != 5 || s.Counted != 4 || s.Differing != 3 {
		t.Fatalf("summary counts %+v", s)
	}
	if !s.QtyOver.Equal(d("5.5")) || !s.QtyShort.Equal(d("2")) {
		t.Fatalf("summary qty %+v", s)
	}
	// value: -2*2 + 0 + 2.5*10 + 3*1 = 24
	if !s.ValueDiff.Equal(d("24")) {
		t.Fatalf("value diff %s", s.ValueDiff)
	}
}

func TestVarianceNil(t *testing.T) {
	if !Variance(d("7"), nil).IsZero() {
		t.Fatal("nil counted must be zero variance")
	}
}
