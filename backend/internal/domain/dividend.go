package domain

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// DividendStatus mirrors the dividend_period_status enum.
// Lifecycle: draft → simulated → approved → paid → closed.
type DividendStatus string

const (
	DividendDraft     DividendStatus = "draft"
	DividendSimulated DividendStatus = "simulated"
	DividendApproved  DividendStatus = "approved"
	DividendPaid      DividendStatus = "paid"
	DividendClosed    DividendStatus = "closed"
)

func (s DividendStatus) Valid() bool {
	switch s {
	case DividendDraft, DividendSimulated, DividendApproved, DividendPaid, DividendClosed:
		return true
	}
	return false
}

// Editable reports whether criteria / net profit may still change.
func (s DividendStatus) Editable() bool { return s == DividendDraft || s == DividendSimulated }

// CanTransition encodes the period state machine.
func (s DividendStatus) CanTransition(to DividendStatus) bool {
	switch s {
	case DividendDraft:
		return to == DividendSimulated
	case DividendSimulated:
		return to == DividendSimulated || to == DividendApproved
	case DividendApproved:
		return to == DividendPaid
	case DividendPaid:
		return to == DividendClosed
	}
	return false
}

// DividendCriterionKind mirrors the dividend_criterion_kind enum.
type DividendCriterionKind string

const (
	CriterionShareRule  DividendCriterionKind = "share_rule"
	CriterionAllocation DividendCriterionKind = "allocation"
)

// DividendPool mirrors the dividend_pool enum.
type DividendPool string

const (
	PoolHUN   DividendPool = "HUN"   // share-dividend pool (ปันผลตามหุ้น)
	PoolAVG   DividendPool = "AVG"   // purchase-rebate pool (เฉลี่ยคืน)
	PoolOther DividendPool = "OTHER" // reserves, board compensation, public benefit …
)

func (p DividendPool) Valid() bool { return p == PoolHUN || p == PoolAVG || p == PoolOther }

// WalkinMemberCode is the legacy customer id of the anonymous walk-in row.
const WalkinMemberCode = "0"

// DividendPeriod is one Buddhist-year dividend cycle of a store.
type DividendPeriod struct {
	ID         uuid.UUID       `json:"id"`
	StoreID    uuid.UUID       `json:"store_id"`
	BEYear     int             `json:"be_year"`
	StartsOn   Date            `json:"starts_on"`
	EndsOn     Date            `json:"ends_on"`
	NetProfit  decimal.Decimal `json:"net_profit"`
	Status     DividendStatus  `json:"status"`
	ApprovedBy *uuid.UUID      `json:"approved_by,omitempty"`
	ApprovedAt *time.Time      `json:"approved_at,omitempty"`
	Note       string          `json:"note,omitempty"`
	LegacyYear string          `json:"legacy_year,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`
}

// DividendCriterion is one rule row of a period: exactly one share_rule and N allocations.
type DividendCriterion struct {
	ID           uuid.UUID             `json:"id"`
	StoreID      uuid.UUID             `json:"store_id,omitempty"`
	PeriodID     uuid.UUID             `json:"period_id,omitempty"`
	Kind         DividendCriterionKind `json:"kind"`
	Name         string                `json:"name"`
	NameEN       string                `json:"name_en,omitempty"`
	Percent      decimal.Decimal       `json:"percent"`                  // allocation: % of net profit
	BahtPerShare *decimal.Decimal      `json:"baht_per_share,omitempty"` // share_rule: ฿ per share
	MaxShares    *decimal.Decimal      `json:"max_shares,omitempty"`     // share_rule: cap per member
	ApplyCap     bool                  `json:"apply_cap"`
	PoolCode     DividendPool          `json:"pool_code"`
	IsLocked     bool                  `json:"is_locked"`
	SortOrder    int                   `json:"sort_order"`
	LegacyID     string                `json:"legacy_id,omitempty"`
	CreatedAt    time.Time             `json:"created_at,omitempty"`
}

// DividendMemberInput is the per-member snapshot the engine consumes (and the run stores in inputs).
type DividendMemberInput struct {
	MemberID     *uuid.UUID      `json:"member_id,omitempty"`
	Code         string          `json:"code"`
	Name         string          `json:"name"`
	Address      string          `json:"address,omitempty"`
	ShareCapital decimal.Decimal `json:"share_capital"`
	Purchases    decimal.Decimal `json:"purchases"`
	IsWalkin     bool            `json:"is_walkin,omitempty"`
}

// DividendRunInputs is the snapshot stored in dividend_runs.inputs.
type DividendRunInputs struct {
	NetProfit decimal.Decimal       `json:"net_profit"`
	StartsOn  Date                  `json:"starts_on,omitempty"`
	EndsOn    Date                  `json:"ends_on,omitempty"`
	Criteria  []DividendCriterion   `json:"criteria"`
	Members   []DividendMemberInput `json:"members,omitempty"`
}

// DividendAllocation is the computed amount of one allocation criterion.
type DividendAllocation struct {
	CriterionID uuid.UUID       `json:"criterion_id,omitempty"`
	Name        string          `json:"name"`
	NameEN      string          `json:"name_en,omitempty"`
	PoolCode    DividendPool    `json:"pool_code"`
	Percent     decimal.Decimal `json:"percent"`
	Amount      decimal.Decimal `json:"amount"`
}

// DividendTotals is stored in dividend_runs.totals. Key names rate_per_share / rebate_rate are read by the LIFF estimate.
type DividendTotals struct {
	NetProfit            decimal.Decimal      `json:"net_profit"`
	BahtPerShare         decimal.Decimal      `json:"baht_per_share"`
	MaxShares            *decimal.Decimal     `json:"max_shares,omitempty"`
	ApplyCap             bool                 `json:"apply_cap"`
	TotalShares          decimal.Decimal      `json:"total_shares"`
	TotalSharesEffective decimal.Decimal      `json:"total_shares_effective"`
	TotalPurchases       decimal.Decimal      `json:"total_purchases"`
	RatePerShare         decimal.Decimal      `json:"rate_per_share"`
	RebateRate           decimal.Decimal      `json:"rebate_rate"`
	PoolHUN              decimal.Decimal      `json:"pool_hun"`
	PoolAVG              decimal.Decimal      `json:"pool_avg"`
	Allocations          []DividendAllocation `json:"allocations"`
	SumShareDividend     decimal.Decimal      `json:"sum_share_dividend"`
	SumRebate            decimal.Decimal      `json:"sum_rebate"`
	SumTotal             decimal.Decimal      `json:"sum_total"`
	MemberCount          int                  `json:"member_count"`
	WalkinPurchases      decimal.Decimal      `json:"walkin_purchases"`
	WalkinRebate         decimal.Decimal      `json:"walkin_rebate"`
}

// DividendRun is one computation of a period (engine or legacy import).
type DividendRun struct {
	ID          uuid.UUID         `json:"id"`
	StoreID     uuid.UUID         `json:"store_id"`
	PeriodID    uuid.UUID         `json:"period_id"`
	RunNo       int               `json:"run_no"`
	Inputs      DividendRunInputs `json:"inputs"`
	Totals      DividendTotals    `json:"totals"`
	MemberCount int               `json:"member_count"`
	IsFinal     bool              `json:"is_final"`
	ComputedBy  *uuid.UUID        `json:"computed_by,omitempty"`
	ComputedAt  time.Time         `json:"computed_at"`
	Source      string            `json:"source"` // engine | legacy_import
}

// DividendStatement is one member's line of a run.
type DividendStatement struct {
	ID              uuid.UUID       `json:"id"`
	StoreID         uuid.UUID       `json:"store_id,omitempty"`
	RunID           uuid.UUID       `json:"run_id"`
	MemberID        *uuid.UUID      `json:"member_id,omitempty"`
	MemberCode      string          `json:"member_code"`
	MemberName      string          `json:"member_name"`
	MemberAddress   string          `json:"member_address,omitempty"`
	ShareCapital    decimal.Decimal `json:"share_capital"`
	Shares          decimal.Decimal `json:"shares"`
	SharesEffective decimal.Decimal `json:"shares_effective"`
	Purchases       decimal.Decimal `json:"purchases"`
	ShareDividend   decimal.Decimal `json:"share_dividend"`
	Rebate          decimal.Decimal `json:"rebate"`
	Total           decimal.Decimal `json:"total"`
	SeqNo           int             `json:"seq_no"`
	IsWalkin        bool            `json:"is_walkin"`
	PaidTotal       decimal.Decimal `json:"paid_total"`
}

// DividendPayout is money (or share reinvestment) handed to a member against a statement.
type DividendPayout struct {
	ID          uuid.UUID       `json:"id"`
	StoreID     uuid.UUID       `json:"store_id,omitempty"`
	StatementID uuid.UUID       `json:"statement_id"`
	Amount      decimal.Decimal `json:"amount"`
	Method      PaymentMethod   `json:"method"`
	PaidAt      time.Time       `json:"paid_at"`
	PaidBy      *uuid.UUID      `json:"paid_by,omitempty"`
	Note        string          `json:"note,omitempty"`
}
