package dividenduc

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
)

func d(s string) decimal.Decimal { return decimal.RequireFromString(s) }
func dp(s string) *decimal.Decimal {
	v := d(s)
	return &v
}

// criteria2565 mirrors the legacy criteriondividend rows for BE 2565: 50 ฿/share, cap 40 (not applied),
// HUN 25 %, AVG 25 %, reserves 30 %, board 10 %, public benefit 10 %.
func criteria2565(applyCap bool) []domain.DividendCriterion {
	return []domain.DividendCriterion{
		{ID: uuid.New(), Kind: domain.CriterionShareRule, Name: "ราคาหุ้น", BahtPerShare: dp("50"), MaxShares: dp("40"), ApplyCap: applyCap, PoolCode: domain.PoolOther},
		{ID: uuid.New(), Kind: domain.CriterionAllocation, Name: "ปันผลตามหุ้น", Percent: d("25"), PoolCode: domain.PoolHUN},
		{ID: uuid.New(), Kind: domain.CriterionAllocation, Name: "เฉลี่ยคืน", Percent: d("25"), PoolCode: domain.PoolAVG},
		{ID: uuid.New(), Kind: domain.CriterionAllocation, Name: "ทุนสำรอง", Percent: d("30"), PoolCode: domain.PoolOther},
		{ID: uuid.New(), Kind: domain.CriterionAllocation, Name: "ตอบแทนกรรมการ", Percent: d("10"), PoolCode: domain.PoolOther},
		{ID: uuid.New(), Kind: domain.CriterionAllocation, Name: "สาธารณะประโยชน์", Percent: d("10"), PoolCode: domain.PoolOther},
	}
}

// members2565 is a 4-row reduction of the 1,035-row legacy statement that keeps the two denominators exact:
// Σ shares = 10,244.4 and Σ purchases = 5,647,465 (including the walk-in row's 289,635).
func members2565() []domain.DividendMemberInput {
	return []domain.DividendMemberInput{
		{Code: "91014", Name: "นายอำนาจ ไชยราช", ShareCapital: d("10050"), Purchases: d("34429")},
		{Code: "20", Name: "fractional", ShareCapital: d("20"), Purchases: d("1000")},
		{Code: "0", Name: "ไม่ระบุ", ShareCapital: d("0"), Purchases: d("289635"), IsWalkin: true},
		{Code: "50001", Name: "rest of co-op", ShareCapital: d("502150"), Purchases: d("5322401")},
	}
}

func within(t *testing.T, name string, got, want decimal.Decimal, tol string) {
	t.Helper()
	if got.Sub(want).Abs().GreaterThan(d(tol)) {
		t.Fatalf("%s: got %s want %s (±%s)", name, got, want, tol)
	}
}

func find(t *testing.T, res *Result, code string) domain.DividendStatement {
	t.Helper()
	for _, s := range res.Statements {
		if s.MemberCode == code {
			return s
		}
	}
	t.Fatalf("statement %s missing", code)
	return domain.DividendStatement{}
}

func TestComputeLegacy2565(t *testing.T) {
	res, err := Compute(Inputs{NetProfit: d("409826.4"), Criteria: criteria2565(false), Members: members2565()})
	if err != nil {
		t.Fatal(err)
	}
	tt := res.Totals
	within(t, "pool_hun", tt.PoolHUN, d("102456.6"), "0.01")
	within(t, "pool_avg", tt.PoolAVG, d("102456.6"), "0.01")
	within(t, "total_shares", tt.TotalShares, d("10244.4"), "0.0001")
	within(t, "total_purchases", tt.TotalPurchases, d("5647465"), "0.001")
	// The legacy reference quotes rate_per_share ≈ 10.00125 (back-derived as 2,010.25 / 201, i.e. rounded);
	// the exact value from net_profit 409,826.4 is 102,456.6 / 10,244.4 = 10.00123. Member amounts (below, ±0.01) are binding.
	within(t, "rate_per_share", tt.RatePerShare, d("10.00125"), "0.00005")
	within(t, "rebate_rate", tt.RebateRate, d("0.018142"), "0.0000005")
	if tt.MemberCount != 4 {
		t.Fatalf("member_count %d", tt.MemberCount)
	}

	m := find(t, res, "91014")
	within(t, "shares", m.Shares, d("201"), "0.0001")
	within(t, "share_dividend", m.ShareDividend, d("2010.25"), "0.01")
	within(t, "rebate", m.Rebate, d("624.61"), "0.01")
	within(t, "total", m.Total, d("2634.86"), "0.01")
	if m.IsWalkin {
		t.Fatal("91014 flagged walk-in")
	}

	// fractional shares: ฿20 → 0.4 shares
	f := find(t, res, "20")
	within(t, "fractional shares", f.Shares, d("0.4"), "0.0001")
	within(t, "fractional dividend", f.ShareDividend, d("4.00"), "0.01")

	// walk-in: zero shares, rebate only, flagged, included in the denominator
	w := find(t, res, "0")
	if !w.IsWalkin || !w.Shares.IsZero() || !w.ShareDividend.IsZero() {
		t.Fatalf("walk-in row wrong: %+v", w)
	}
	within(t, "walk-in rebate", w.Rebate, d("5254.57"), "0.01")
	within(t, "walkin_purchases", tt.WalkinPurchases, d("289635"), "0.001")
	within(t, "walkin_rebate", tt.WalkinRebate, w.Rebate, "0.001")

	// allocations: 5 rows, other pools are plain % of net profit
	if len(tt.Allocations) != 5 {
		t.Fatalf("allocations %d", len(tt.Allocations))
	}
	within(t, "reserve 30%", tt.Allocations[2].Amount, d("122947.92"), "0.01")

	// Σ over members ≈ pools (legacy accepted the cent drift from per-member rounding)
	within(t, "sum share dividend", tt.SumShareDividend, tt.PoolHUN, "0.05")
	within(t, "sum rebate", tt.SumRebate, tt.PoolAVG, "0.05")
	within(t, "sum total", tt.SumTotal, tt.SumShareDividend.Add(tt.SumRebate), "0")

	// sorted by numeric code, seq_no 1..N
	wantOrder := []string{"0", "20", "50001", "91014"}
	for i, s := range res.Statements {
		if s.MemberCode != wantOrder[i] || s.SeqNo != i+1 {
			t.Fatalf("order/seq wrong at %d: %s seq %d", i, s.MemberCode, s.SeqNo)
		}
	}
}

func TestComputeCap(t *testing.T) {
	members := []domain.DividendMemberInput{
		{Code: "1", ShareCapital: d("10050"), Purchases: d("0")}, // 201 shares → capped 40
		{Code: "2", ShareCapital: d("500"), Purchases: d("0")},   // 10 shares
	}
	res, err := Compute(Inputs{NetProfit: d("1000"), Criteria: criteria2565(true), Members: members})
	if err != nil {
		t.Fatal(err)
	}
	a, b := find(t, res, "1"), find(t, res, "2")
	within(t, "shares kept", a.Shares, d("201"), "0")
	within(t, "shares_effective capped", a.SharesEffective, d("40"), "0")
	within(t, "total_shares_effective", res.Totals.TotalSharesEffective, d("50"), "0")
	// pool_HUN 250 / 50 eff shares = 5 per share
	within(t, "rate", res.Totals.RatePerShare, d("5"), "0")
	within(t, "capped dividend", a.ShareDividend, d("200"), "0")
	within(t, "uncapped dividend", b.ShareDividend, d("50"), "0")

	// same input without the cap: 211 shares
	res2, _ := Compute(Inputs{NetProfit: d("1000"), Criteria: criteria2565(false), Members: members})
	within(t, "no cap eff", find(t, res2, "1").SharesEffective, d("201"), "0")
}

func TestComputeZeroDenominators(t *testing.T) {
	res, err := Compute(Inputs{NetProfit: d("1000"), Criteria: criteria2565(false), Members: []domain.DividendMemberInput{{Code: "1"}}})
	if err != nil {
		t.Fatal(err)
	}
	if !res.Totals.RatePerShare.IsZero() || !res.Totals.RebateRate.IsZero() || !find(t, res, "1").Total.IsZero() {
		t.Fatalf("expected zero rates: %+v", res.Totals)
	}
	if res2, _ := Compute(Inputs{NetProfit: d("1000"), Criteria: criteria2565(false)}); res2.Totals.MemberCount != 0 || len(res2.Statements) != 0 {
		t.Fatal("empty members should yield no statements")
	}
}

func TestValidateCriteria(t *testing.T) {
	cases := []struct {
		name string
		mut  func(cs []domain.DividendCriterion) []domain.DividendCriterion
	}{
		{"no share rule", func(cs []domain.DividendCriterion) []domain.DividendCriterion { return cs[1:] }},
		{"two share rules", func(cs []domain.DividendCriterion) []domain.DividendCriterion { return append(cs, cs[0]) }},
		{"sum > 100", func(cs []domain.DividendCriterion) []domain.DividendCriterion {
			cs[5].Percent = d("10.5")
			return cs
		}},
		{"negative percent", func(cs []domain.DividendCriterion) []domain.DividendCriterion {
			cs[3].Percent = d("-1")
			return cs
		}},
		{"zero baht per share", func(cs []domain.DividendCriterion) []domain.DividendCriterion {
			cs[0].BahtPerShare = dp("0")
			return cs
		}},
		{"cap without max", func(cs []domain.DividendCriterion) []domain.DividendCriterion {
			cs[0].ApplyCap, cs[0].MaxShares = true, nil
			return cs
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := ValidateCriteria(c.mut(criteria2565(false)))
			if !errors.Is(err, domain.ErrDividendCriteria) {
				t.Fatalf("want DIVIDEND_CRITERIA_INVALID, got %v", err)
			}
			if domain.AsError(err).Params["reason"] == "" {
				t.Fatal("reason missing")
			}
		})
	}
	if r, err := ValidateCriteria(criteria2565(false)); err != nil || !r.PercentSum.Equal(d("100")) || !r.PercentHUN.Equal(d("25")) {
		t.Fatalf("valid criteria rejected: %v %+v", err, r)
	}
}

func TestVerifyRoundTrip(t *testing.T) {
	in := Inputs{NetProfit: d("409826.4"), Criteria: criteria2565(false), Members: members2565()}
	res, err := Compute(in)
	if err != nil {
		t.Fatal(err)
	}
	// Legacy-style: no member snapshot, members rebuilt from the stored statements.
	rep, err := Verify(Inputs{NetProfit: in.NetProfit, Criteria: in.Criteria}, res.Statements)
	if err != nil {
		t.Fatal(err)
	}
	if !rep.OK || rep.Mismatched != 0 || rep.Rows != 4 || !rep.MaxAbsDiff["total"].IsZero() {
		t.Fatalf("round trip should verify: %+v", rep)
	}

	// Tamper with one stored row → reported.
	bad := append([]domain.DividendStatement(nil), res.Statements...)
	bad[3].Total = bad[3].Total.Add(d("1"))
	rep, _ = Verify(in, bad)
	if rep.OK || rep.Mismatched != 1 || !rep.MaxAbsDiff["total"].Equal(d("1")) || len(rep.Worst) != 1 || rep.Worst[0].MemberCode != "91014" {
		t.Fatalf("tamper not detected: %+v", rep)
	}
	// Missing / extra rows.
	rep, _ = Verify(in, bad[:3])
	if rep.OK || len(rep.MissingCode) != 1 || rep.MissingCode[0] != "91014" {
		t.Fatalf("missing row not detected: %+v", rep)
	}
}

func TestLessCode(t *testing.T) {
	if !lessCode("0", "20") || !lessCode("20", "91014") || lessCode("91014", "20") || !lessCode("9", "A1") || !lessCode("A1", "B1") {
		t.Fatal("lessCode ordering wrong")
	}
}
