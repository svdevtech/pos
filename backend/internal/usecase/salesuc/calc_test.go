package salesuc

import (
	"testing"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"

	"github.com/svdev/pos/internal/domain"
)

func d(s string) decimal.Decimal { return decimal.RequireFromString(s) }

func TestComputeLegacyStyleBill(t *testing.T) {
	// legacy bill N6301-00008: gross 726, line discount 6, net 720
	pid := uuid.New()
	lines := []CartLine{
		{ProductID: pid, Qty: d("9"), UnitPrice: d("4"), Discount: d("6")},
		{ProductID: uuid.New(), Qty: d("1"), UnitPrice: d("690")},
	}
	tot, out := Compute(lines, nil, decimal.Zero, decimal.Zero)
	require.Equal(t, "726.00", tot.Gross.StringFixed(2))
	require.Equal(t, "6.00", tot.LineDiscount.StringFixed(2))
	require.Equal(t, "720.00", tot.Net.StringFixed(2))
	require.Equal(t, "30.00", out[0].LineTotal().StringFixed(2))
}

func TestComputeFreeLineAndNegativeGuard(t *testing.T) {
	lines := []CartLine{
		{ProductID: uuid.New(), Qty: d("1"), UnitPrice: d("25.875"), IsFree: true},
		{ProductID: uuid.New(), Qty: d("1"), UnitPrice: d("10"), Discount: d("50")},
	}
	tot, out := Compute(lines, nil, decimal.Zero, decimal.Zero)
	require.True(t, out[0].LineTotal().IsZero())
	require.True(t, out[1].LineTotal().IsZero())
	require.Equal(t, "10.00", tot.Gross.StringFixed(2))
	require.Equal(t, "0.00", tot.Net.StringFixed(2))
}

func TestComputePromotions(t *testing.T) {
	pid := uuid.New()
	promoID := uuid.New()
	promos := []domain.Promotion{
		{ID: promoID, Scope: "product", ProductID: &pid, MinQty: d("3"), DiscountType: "amount", DiscountValue: d("5")}, // buy 3 save 5
		{ID: uuid.New(), Scope: "bill", MinAmount: d("100"), DiscountType: "percent", DiscountValue: d("10")},
	}
	lines := []CartLine{{ProductID: pid, Qty: d("7"), UnitPrice: d("20")}} // 140 gross, 2 groups → -10
	tot, out := Compute(lines, promos, decimal.Zero, decimal.Zero)
	require.Equal(t, "10.00", out[0].PromoDisc.StringFixed(2))
	require.Equal(t, promoID, *out[0].PromotionID)
	require.Equal(t, "140.00", tot.Gross.StringFixed(2))
	require.Equal(t, "13.00", tot.BillDiscount.StringFixed(2)) // 10% of 130
	require.Equal(t, "117.00", tot.Net.StringFixed(2))
}

func TestComputeManualBillDiscountCapped(t *testing.T) {
	lines := []CartLine{{ProductID: uuid.New(), Qty: d("1"), UnitPrice: d("50")}}
	tot, _ := Compute(lines, nil, d("80"), decimal.Zero)
	require.Equal(t, "50.00", tot.BillDiscount.StringFixed(2))
	require.Equal(t, "0.00", tot.Net.StringFixed(2))
	tot, _ = Compute(lines, nil, decimal.Zero, d("10"))
	require.Equal(t, "45.00", tot.Net.StringFixed(2))
}

func TestTierPrice(t *testing.T) {
	tiers := map[int]decimal.Decimal{1: d("9"), 2: d("0")}
	require.Equal(t, "9", TierPrice(d("10"), tiers, 1).String())
	require.Equal(t, "10", TierPrice(d("10"), tiers, 2).String())
	require.Equal(t, "10", TierPrice(d("10"), tiers, 0).String())
}

func TestSettle(t *testing.T) {
	// cash with change (legacy: net 55, tendered 70, change 15)
	r, err := Settle(d("55"), []Tender{{Method: domain.PayCash, Amount: d("70")}})
	require.NoError(t, err)
	require.Equal(t, "15.00", r.Change.StringFixed(2))
	require.Equal(t, "55.00", r.CashIn.StringFixed(2))

	// short
	_, err = Settle(d("55"), []Tender{{Method: domain.PayCash, Amount: d("50")}})
	require.ErrorIs(t, err, domain.ErrSalePaymentShort)

	// full credit (legacy buy_type 2)
	r, err = Settle(d("140"), []Tender{{Method: domain.PayCredit}})
	require.NoError(t, err)
	require.Equal(t, "140.00", r.Credit.StringFixed(2))
	require.True(t, r.Change.IsZero())

	// split: transfer 100 + cash 60 on 150 → change 10
	r, err = Settle(d("150"), []Tender{{Method: domain.PayTransfer, Amount: d("100")}, {Method: domain.PayCash, Amount: d("60")}})
	require.NoError(t, err)
	require.Equal(t, "10.00", r.Change.StringFixed(2))

	// partial credit: cash 40, credit remainder on 100
	r, err = Settle(d("100"), []Tender{{Method: domain.PayCash, Amount: d("40")}, {Method: domain.PayCredit}})
	require.NoError(t, err)
	require.Equal(t, "60.00", r.Credit.StringFixed(2))
	require.True(t, r.Change.IsZero())

	// non-cash over net rejected
	_, err = Settle(d("50"), []Tender{{Method: domain.PayCard, Amount: d("60")}})
	require.Error(t, err)
}
