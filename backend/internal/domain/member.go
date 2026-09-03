package domain

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// MemberStatus mirrors the member_status enum.
type MemberStatus string

const (
	MemberActive    MemberStatus = "active"
	MemberInactive  MemberStatus = "inactive"
	MemberSuspended MemberStatus = "suspended"
)

func (s MemberStatus) Valid() bool {
	switch s {
	case MemberActive, MemberInactive, MemberSuspended:
		return true
	}
	return false
}

// ShareTxType mirrors the share_tx_type enum.
type ShareTxType string

const (
	ShareOpening          ShareTxType = "opening"
	ShareDeposit          ShareTxType = "deposit"
	ShareWithdraw         ShareTxType = "withdraw"
	ShareAdjust           ShareTxType = "adjust"
	ShareDividendReinvest ShareTxType = "dividend_reinvest"
)

// Date is a calendar date (no time component) serialised as "2006-01-02".
// It also accepts RFC3339 timestamps on input for convenience.
type Date struct {
	time.Time
}

func NewDate(t time.Time) Date {
	return Date{Time: time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)}
}

func (d Date) MarshalJSON() ([]byte, error) {
	if d.IsZero() {
		return []byte("null"), nil
	}
	return json.Marshal(d.Format("2006-01-02"))
}

func (d *Date) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	s = strings.TrimSpace(s)
	if s == "" {
		*d = Date{}
		return nil
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		*d = NewDate(t)
		return nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return err
	}
	*d = NewDate(t)
	return nil
}

// Member is a co-op member (customer) of a store.
type Member struct {
	ID           uuid.UUID       `json:"id"`
	StoreID      uuid.UUID       `json:"store_id"`
	MemberCode   string          `json:"member_code"`
	Name         string          `json:"name"`
	Address      string          `json:"address,omitempty"`
	Phone        string          `json:"phone,omitempty"`
	Email        string          `json:"email,omitempty"`
	NationalID   string          `json:"national_id,omitempty"`
	LineUserID   string          `json:"line_user_id,omitempty"`
	LineDisplay  string          `json:"line_display,omitempty"`
	ShareCapital decimal.Decimal `json:"share_capital"`
	JoinedAt     *Date           `json:"joined_at,omitempty"`
	PriceTier    int             `json:"price_tier"`
	IsWalkin     bool            `json:"is_walkin"`
	Status       MemberStatus    `json:"status"`
	Note         string          `json:"note,omitempty"`
	LegacyID     string          `json:"legacy_id,omitempty"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
}

// LineLinked reports whether the member has a LINE account attached.
func (m Member) LineLinked() bool { return m.LineUserID != "" }

// MemberView is a member plus computed balances used by lists.
type MemberView struct {
	Member
	ARBalance    decimal.Decimal `json:"ar_balance"`
	YTDPurchases decimal.Decimal `json:"ytd_purchases"`
}

// ShareTx is one entry of the member share-capital ledger.
type ShareTx struct {
	ID           uuid.UUID       `json:"id"`
	StoreID      uuid.UUID       `json:"store_id"`
	MemberID     uuid.UUID       `json:"member_id"`
	Type         ShareTxType     `json:"type"`
	Amount       decimal.Decimal `json:"amount"` // signed: deposit +, withdraw -
	BalanceAfter decimal.Decimal `json:"balance_after"`
	Note         string          `json:"note,omitempty"`
	RefType      string          `json:"ref_type,omitempty"`
	RefID        *uuid.UUID      `json:"ref_id,omitempty"`
	CreatedBy    *uuid.UUID      `json:"created_by,omitempty"`
	OccurredAt   time.Time       `json:"occurred_at"`
	CreatedAt    time.Time       `json:"created_at"`
}

// MemberLinkCode is a one-time code a member types into LIFF to attach their LINE account.
type MemberLinkCode struct {
	Code      string     `json:"code"`
	StoreID   uuid.UUID  `json:"store_id"`
	MemberID  uuid.UUID  `json:"member_id"`
	ExpiresAt time.Time  `json:"expires_at"`
	UsedAt    *time.Time `json:"used_at,omitempty"`
}
