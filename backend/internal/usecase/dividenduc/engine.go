// Package dividenduc implements the annual dividend (ปันผล) engine: a pure computation
// (Compute / Verify) plus the period lifecycle service around it.
package dividenduc

import (
	"sort"
	"strconv"
	"strings"

	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
)

// ratePrecision is the number of decimal places kept for the per-unit rates.
// Legacy printed 10.00125 / 0.018142 but member amounts only round at the very end.
const ratePrecision = 12

var hundred = decimal.NewFromInt(100)

// Inputs is everything Compute needs. It maps 1:1 onto domain.DividendRunInputs.
type Inputs struct {
	NetProfit decimal.Decimal
	Criteria  []domain.DividendCriterion
	Members   []domain.DividendMemberInput
}

// Result is the engine output: run totals and one statement per member, sorted by member code with seq_no 1..N.
type Result struct {
	Totals     domain.DividendTotals
	Statements []domain.DividendStatement
}

// Rules is the validated view of the criteria.
type Rules struct {
	ShareRule   domain.DividendCriterion
	Allocations []domain.DividendCriterion
	PercentHUN  decimal.Decimal
	PercentAVG  decimal.Decimal
	PercentSum  decimal.Decimal
}

// ValidateCriteria checks the period rules: exactly one share_rule with a positive baht_per_share,
// allocations with non-negative percents summing to at most 100. Failures are DIVIDEND_CRITERIA_INVALID.
func ValidateCriteria(cs []domain.DividendCriterion) (*Rules, error) {
	var r Rules
	shareRules := 0
	for _, c := range cs {
		switch c.Kind {
		case domain.CriterionShareRule:
			shareRules++
			r.ShareRule = c
			if c.BahtPerShare == nil || !c.BahtPerShare.IsPositive() {
				return nil, domain.ErrDividendCriteria.With("reason", "baht_per_share must be > 0")
			}
			if c.ApplyCap && (c.MaxShares == nil || !c.MaxShares.IsPositive()) {
				return nil, domain.ErrDividendCriteria.With("reason", "max_shares must be > 0 when apply_cap is set")
			}
		case domain.CriterionAllocation:
			if c.Percent.IsNegative() {
				return nil, domain.ErrDividendCriteria.With("reason", "allocation percent must be >= 0: "+c.Name)
			}
			if !c.PoolCode.Valid() {
				return nil, domain.ErrDividendCriteria.With("reason", "invalid pool_code: "+string(c.PoolCode))
			}
			r.Allocations = append(r.Allocations, c)
			r.PercentSum = r.PercentSum.Add(c.Percent)
			switch c.PoolCode {
			case domain.PoolHUN:
				r.PercentHUN = r.PercentHUN.Add(c.Percent)
			case domain.PoolAVG:
				r.PercentAVG = r.PercentAVG.Add(c.Percent)
			}
		default:
			return nil, domain.ErrDividendCriteria.With("reason", "unknown kind: "+string(c.Kind))
		}
	}
	if shareRules == 0 {
		return nil, domain.ErrDividendCriteria.With("reason", "share_rule missing")
	}
	if shareRules > 1 {
		return nil, domain.ErrDividendCriteria.With("reason", "more than one share_rule")
	}
	if r.PercentSum.GreaterThan(hundred) {
		return nil, domain.ErrDividendCriteria.With("reason", "allocation percent sum "+r.PercentSum.String()+" > 100")
	}
	return &r, nil
}

// Shares converts share capital to (fractional) shares: 10,050 / 50 = 201; 20 / 50 = 0.4.
func Shares(shareCapital, bahtPerShare decimal.Decimal) decimal.Decimal {
	if !bahtPerShare.IsPositive() {
		return decimal.Zero
	}
	return shareCapital.DivRound(bahtPerShare, 4)
}

// Compute is the pure dividend computation (decimal only, no I/O):
//
//	shares_m          = share_capital_m / baht_per_share            (fractional)
//	shares_eff_m      = min(shares_m, max_shares) when apply_cap else shares_m
//	pool_HUN          = net_profit × pct_HUN / 100
//	pool_AVG          = net_profit × pct_AVG / 100
//	rate_per_share    = pool_HUN / Σ shares_eff      (0 when Σ = 0)
//	rebate_rate       = pool_AVG / Σ purchases       (0 when Σ = 0)
//	share_dividend_m  = round2(shares_eff_m × rate_per_share)
//	rebate_m          = round2(purchases_m × rebate_rate)
//	total_m           = share_dividend_m + rebate_m
//
// Walk-in rows take part exactly like members (legacy parity) but are flagged is_walkin.
func Compute(in Inputs) (*Result, error) {
	rules, err := ValidateCriteria(in.Criteria)
	if err != nil {
		return nil, err
	}
	bps := *rules.ShareRule.BahtPerShare
	np := in.NetProfit

	t := domain.DividendTotals{NetProfit: np, BahtPerShare: bps, MaxShares: rules.ShareRule.MaxShares, ApplyCap: rules.ShareRule.ApplyCap, Allocations: []domain.DividendAllocation{}}

	// Pools / allocations.
	for _, a := range rules.Allocations {
		amt := np.Mul(a.Percent).DivRound(hundred, 2)
		t.Allocations = append(t.Allocations, domain.DividendAllocation{CriterionID: a.ID, Name: a.Name, NameEN: a.NameEN, PoolCode: a.PoolCode, Percent: a.Percent, Amount: amt})
	}
	t.PoolHUN = np.Mul(rules.PercentHUN).DivRound(hundred, 6)
	t.PoolAVG = np.Mul(rules.PercentAVG).DivRound(hundred, 6)

	// Per-member shares and the denominators.
	members := make([]domain.DividendMemberInput, len(in.Members))
	copy(members, in.Members)
	sort.SliceStable(members, func(i, j int) bool { return lessCode(members[i].Code, members[j].Code) })

	stmts := make([]domain.DividendStatement, 0, len(members))
	for _, m := range members {
		sh := Shares(m.ShareCapital, bps)
		eff := sh
		if rules.ShareRule.ApplyCap && rules.ShareRule.MaxShares != nil && eff.GreaterThan(*rules.ShareRule.MaxShares) {
			eff = *rules.ShareRule.MaxShares
		}
		walkin := m.IsWalkin || m.Code == domain.WalkinMemberCode
		stmts = append(stmts, domain.DividendStatement{
			MemberID: m.MemberID, MemberCode: m.Code, MemberName: m.Name, MemberAddress: m.Address,
			ShareCapital: m.ShareCapital, Shares: sh, SharesEffective: eff, Purchases: m.Purchases, IsWalkin: walkin,
		})
		t.TotalShares = t.TotalShares.Add(sh)
		t.TotalSharesEffective = t.TotalSharesEffective.Add(eff)
		t.TotalPurchases = t.TotalPurchases.Add(m.Purchases)
		if walkin {
			t.WalkinPurchases = t.WalkinPurchases.Add(m.Purchases)
		}
	}

	// Rates.
	if t.TotalSharesEffective.IsPositive() {
		t.RatePerShare = t.PoolHUN.DivRound(t.TotalSharesEffective, ratePrecision)
	}
	if t.TotalPurchases.IsPositive() {
		t.RebateRate = t.PoolAVG.DivRound(t.TotalPurchases, ratePrecision)
	}

	// Per-member amounts.
	for i := range stmts {
		s := &stmts[i]
		s.SeqNo = i + 1
		s.ShareDividend = s.SharesEffective.Mul(t.RatePerShare).Round(2)
		s.Rebate = s.Purchases.Mul(t.RebateRate).Round(2)
		s.Total = s.ShareDividend.Add(s.Rebate)
		t.SumShareDividend = t.SumShareDividend.Add(s.ShareDividend)
		t.SumRebate = t.SumRebate.Add(s.Rebate)
		if s.IsWalkin {
			t.WalkinRebate = t.WalkinRebate.Add(s.Rebate)
		}
	}
	t.SumTotal = t.SumShareDividend.Add(t.SumRebate)
	t.MemberCount = len(stmts)
	return &Result{Totals: t, Statements: stmts}, nil
}

// lessCode orders member codes numerically when both parse as integers (legacy cust_id), else lexically.
func lessCode(a, b string) bool {
	ai, aErr := strconv.ParseInt(strings.TrimSpace(a), 10, 64)
	bi, bErr := strconv.ParseInt(strings.TrimSpace(b), 10, 64)
	if aErr == nil && bErr == nil {
		if ai != bi {
			return ai < bi
		}
		return a < b
	}
	if aErr == nil {
		return true
	}
	if bErr == nil {
		return false
	}
	return a < b
}

// ---------------------------------------------------------------------------
// Verification (legacy parity)
// ---------------------------------------------------------------------------

// VerifyReport compares stored statements against a recomputation from the same inputs.
type VerifyReport struct {
	OK          bool                       `json:"ok"`
	Rows        int                        `json:"rows"`
	Mismatched  int                        `json:"mismatched"`
	MaxAbsDiff  map[string]decimal.Decimal `json:"max_abs_diff"` // per column
	SumDiff     map[string]decimal.Decimal `json:"sum_diff"`     // Σ(computed − stored) per column
	MissingCode []string                   `json:"missing_codes,omitempty"`
	ExtraCode   []string                   `json:"extra_codes,omitempty"`
	Totals      domain.DividendTotals      `json:"totals"`
	Worst       []VerifyRowDiff            `json:"worst,omitempty"` // up to 10 rows with the largest total diff
}

// VerifyRowDiff is one member whose recomputed numbers differ from the stored ones.
type VerifyRowDiff struct {
	MemberCode    string          `json:"member_code"`
	Column        string          `json:"column"`
	Stored        decimal.Decimal `json:"stored"`
	Computed      decimal.Decimal `json:"computed"`
	AbsDifference decimal.Decimal `json:"abs_diff"`
}

var verifyColumns = []string{"shares", "shares_effective", "purchases", "share_dividend", "rebate", "total"}

// Verify recomputes a run from its inputs and reports the max absolute difference per column versus
// the stored statements. When the inputs snapshot carries no member list, the members are rebuilt from
// the stored statements (share_capital + purchases), which is how legacy-imported runs are checked.
// Amounts are compared to the cent (tolerance 0.005); shares to 4 dp.
func Verify(in Inputs, stored []domain.DividendStatement) (*VerifyReport, error) {
	if len(in.Members) == 0 {
		in.Members = make([]domain.DividendMemberInput, 0, len(stored))
		for _, s := range stored {
			in.Members = append(in.Members, domain.DividendMemberInput{MemberID: s.MemberID, Code: s.MemberCode, Name: s.MemberName, Address: s.MemberAddress,
				ShareCapital: s.ShareCapital, Purchases: s.Purchases, IsWalkin: s.IsWalkin})
		}
	}
	res, err := Compute(in)
	if err != nil {
		return nil, err
	}
	rep := &VerifyReport{OK: true, Rows: len(stored), MaxAbsDiff: map[string]decimal.Decimal{}, SumDiff: map[string]decimal.Decimal{}, Totals: res.Totals}
	for _, c := range verifyColumns {
		rep.MaxAbsDiff[c] = decimal.Zero
		rep.SumDiff[c] = decimal.Zero
	}
	computed := map[string]domain.DividendStatement{}
	for _, s := range res.Statements {
		computed[s.MemberCode] = s
	}
	seen := map[string]bool{}
	var diffs []VerifyRowDiff
	for _, st := range stored {
		seen[st.MemberCode] = true
		c, okRow := computed[st.MemberCode]
		if !okRow {
			rep.ExtraCode = append(rep.ExtraCode, st.MemberCode)
			rep.OK = false
			continue
		}
		mismatch := false
		pairs := [][3]any{
			{"shares", st.Shares, c.Shares}, {"shares_effective", st.SharesEffective, c.SharesEffective}, {"purchases", st.Purchases, c.Purchases},
			{"share_dividend", st.ShareDividend, c.ShareDividend}, {"rebate", st.Rebate, c.Rebate}, {"total", st.Total, c.Total},
		}
		for _, p := range pairs {
			col := p[0].(string)
			sv, cv := p[1].(decimal.Decimal), p[2].(decimal.Decimal)
			d := cv.Sub(sv)
			ad := d.Abs()
			rep.SumDiff[col] = rep.SumDiff[col].Add(d)
			if ad.GreaterThan(rep.MaxAbsDiff[col]) {
				rep.MaxAbsDiff[col] = ad
			}
			tol := decimal.NewFromFloat(0.005)
			if col == "shares" || col == "shares_effective" {
				tol = decimal.NewFromFloat(0.00005)
			}
			if ad.GreaterThan(tol) {
				mismatch = true
				diffs = append(diffs, VerifyRowDiff{MemberCode: st.MemberCode, Column: col, Stored: sv, Computed: cv, AbsDifference: ad})
			}
		}
		if mismatch {
			rep.Mismatched++
			rep.OK = false
		}
	}
	for code := range computed {
		if !seen[code] {
			rep.MissingCode = append(rep.MissingCode, code)
			rep.OK = false
		}
	}
	sort.Strings(rep.MissingCode)
	sort.Strings(rep.ExtraCode)
	sort.SliceStable(diffs, func(i, j int) bool { return diffs[i].AbsDifference.GreaterThan(diffs[j].AbsDifference) })
	if len(diffs) > 10 {
		diffs = diffs[:10]
	}
	rep.Worst = diffs
	return rep, nil
}

// InputsFromRun builds engine Inputs from a stored run snapshot.
func InputsFromRun(r domain.DividendRunInputs) Inputs {
	return Inputs{NetProfit: r.NetProfit, Criteria: r.Criteria, Members: r.Members}
}
