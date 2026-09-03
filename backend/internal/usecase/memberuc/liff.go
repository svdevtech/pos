package memberuc

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/auth"
	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

// LiffAuthInput is the body of POST /auth/line/verify and POST /auth/line/link.
type LiffAuthInput struct {
	IDToken   string `json:"id_token"`
	StoreCode string `json:"store_code"`
	LinkCode  string `json:"link_code,omitempty"`
	Phone     string `json:"phone,omitempty"`
	IP        string `json:"-"`
}

// LiffStoreInfo is the public store card shown in LIFF.
type LiffStoreInfo struct {
	ID      uuid.UUID `json:"id"`
	Code    string    `json:"code"`
	Name    string    `json:"name"`
	NameEN  string    `json:"name_en,omitempty"`
	Phone   string    `json:"phone,omitempty"`
	Address string    `json:"address,omitempty"`
	HasLogo bool      `json:"has_logo"`
}

func storeInfo(st *domain.Store) LiffStoreInfo {
	return LiffStoreInfo{ID: st.ID, Code: st.Code, Name: st.Name, NameEN: st.NameEN, Phone: st.Phone, Address: st.Address, HasLogo: st.HasLogo}
}

// LiffAuthResult is returned by verify and link. linked=false carries the LINE profile so the app can show the link screen.
type LiffAuthResult struct {
	Linked      bool           `json:"linked"`
	AccessToken string         `json:"access_token,omitempty"`
	ExpiresAt   *time.Time     `json:"expires_at,omitempty"`
	Member      *domain.Member `json:"member,omitempty"`
	LineUserID  string         `json:"line_user_id,omitempty"`
	DisplayName string         `json:"display_name,omitempty"`
	Picture     string         `json:"picture,omitempty"`
	Store       LiffStoreInfo  `json:"store"`
}

func (s *Service) issueMemberToken(m *domain.Member, st *domain.Store) (string, time.Time, error) {
	return s.jwt.Issue(auth.Principal{UserID: m.ID, StoreID: st.ID, MemberID: m.ID, Role: "member", Kind: "member", Name: m.Name, Locale: st.DefaultLocale})
}

func (s *Service) linkedResult(m *domain.Member, st *domain.Store, p auth.LineProfile) (*LiffAuthResult, error) {
	if m.Status != domain.MemberActive {
		return nil, domain.ErrMemberInactive
	}
	tok, exp, err := s.issueMemberToken(m, st)
	if err != nil {
		return nil, err
	}
	return &LiffAuthResult{Linked: true, AccessToken: tok, ExpiresAt: &exp, Member: m, LineUserID: p.UserID, DisplayName: p.DisplayName, Picture: p.Picture, Store: storeInfo(st)}, nil
}

// resolveStore looks the store up by code inside a bypass transaction (the caller is not authenticated yet).
func (s *Service) resolveStore(ctx context.Context, code string) (*domain.Store, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil, domain.ErrValidation.With("field", "store_code")
	}
	st, err := s.stores.GetByCode(ctx, code)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, domain.ErrNotFound.With("field", "store_code")
		}
		return nil, err
	}
	if !st.IsActive {
		return nil, domain.ErrStoreInactive
	}
	return st, nil
}

// Verify validates the LINE id-token and signs the member in when their LINE account is linked.
// When it is not linked and link_code / phone are supplied, it performs the link in the same call.
func (s *Service) Verify(ctx context.Context, in LiffAuthInput) (*LiffAuthResult, error) {
	profile, err := s.line.Verify(ctx, in.IDToken)
	if err != nil {
		return nil, mapLineErr(err)
	}
	var out *LiffAuthResult
	err = s.db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, _ pgx.Tx) error {
		st, err := s.resolveStore(ctx, in.StoreCode)
		if err != nil {
			return err
		}
		m, err := s.members.FindByLineUserID(ctx, st.ID, profile.UserID)
		switch {
		case err == nil:
			out, err = s.linkedResult(m, st, profile)
			return err
		case !errors.Is(err, domain.ErrMemberNotFound):
			return err
		}
		if strings.TrimSpace(in.LinkCode) != "" || strings.TrimSpace(in.Phone) != "" {
			out, err = s.linkMember(ctx, st, profile, in)
			return err
		}
		out = &LiffAuthResult{Linked: false, LineUserID: profile.UserID, DisplayName: profile.DisplayName, Picture: profile.Picture, Store: storeInfo(st)}
		return nil
	})
	return out, err
}

// Link attaches the LINE account to a member identified by a link code, or by a phone that matches exactly one unlinked member.
func (s *Service) Link(ctx context.Context, in LiffAuthInput) (*LiffAuthResult, error) {
	profile, err := s.line.Verify(ctx, in.IDToken)
	if err != nil {
		return nil, mapLineErr(err)
	}
	var out *LiffAuthResult
	err = s.db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, _ pgx.Tx) error {
		st, err := s.resolveStore(ctx, in.StoreCode)
		if err != nil {
			return err
		}
		// Already linked to this LINE account → idempotent sign-in.
		if m, err := s.members.FindByLineUserID(ctx, st.ID, profile.UserID); err == nil {
			out, err = s.linkedResult(m, st, profile)
			return err
		} else if !errors.Is(err, domain.ErrMemberNotFound) {
			return err
		}
		out, err = s.linkMember(ctx, st, profile, in)
		return err
	})
	return out, err
}

// linkMember runs inside a transaction. Precedence: link_code, then phone.
func (s *Service) linkMember(ctx context.Context, st *domain.Store, profile auth.LineProfile, in LiffAuthInput) (*LiffAuthResult, error) {
	var memberID uuid.UUID
	var how string
	code := NormalizeLinkCode(in.LinkCode)
	phone := NormalizePhone(in.Phone)
	switch {
	case code != "":
		if !ValidLinkCode(code) {
			return nil, domain.ErrLinkCodeInvalid
		}
		lc, err := s.codes.Consume(ctx, st.ID, code)
		if err != nil {
			return nil, err
		}
		memberID, how = lc.MemberID, "link_code"
	case phone != "":
		matches, err := s.members.FindUnlinkedByPhone(ctx, st.ID, phone)
		if err != nil {
			return nil, err
		}
		if len(matches) != 1 {
			return nil, domain.ErrLinkCodeInvalid
		}
		memberID, how = matches[0].ID, "phone"
	default:
		return nil, domain.ErrLinkCodeInvalid
	}
	m, err := s.members.Get(ctx, st.ID, memberID)
	if err != nil {
		return nil, err
	}
	if m.LineLinked() && m.LineUserID != profile.UserID {
		return nil, domain.ErrMemberLinked
	}
	if m.Status != domain.MemberActive {
		return nil, domain.ErrMemberInactive
	}
	if err := s.members.SetLine(ctx, st.ID, m.ID, profile.UserID, profile.DisplayName); err != nil {
		return nil, err
	}
	m.LineUserID, m.LineDisplay = profile.UserID, profile.DisplayName
	if err := s.audit.Write(ctx, domain.AuditEntry{StoreID: &st.ID, ActorName: "LIFF:" + profile.DisplayName, Action: "member.line.link", Entity: "member", EntityID: m.ID.String(),
		After: map[string]any{"line_user_id": profile.UserID, "line_display": profile.DisplayName, "via": how}, IP: in.IP}); err != nil {
		return nil, err
	}
	return s.linkedResult(m, st, profile)
}

// ---- authenticated member routes ---------------------------------------------

// LiffMe is GET /liff/me (and GET /auth/me for member principals).
type LiffMe struct {
	Member       *domain.Member  `json:"member"`
	ShareCapital decimal.Decimal `json:"share_capital"`
	ARBalance    decimal.Decimal `json:"ar_balance"`
	ARBills      int             `json:"ar_bills"`
	YTDPurchases decimal.Decimal `json:"ytd_purchases"`
	Store        LiffStoreInfo   `json:"store"`
}

// Me returns *LiffMe typed as any (the LiffService interface is shared with handlers_auth.go).
func (s *Service) Me(ctx context.Context, storeID, memberID uuid.UUID) (any, error) {
	var out *LiffMe
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		m, err := s.members.Get(ctx, storeID, memberID)
		if err != nil {
			if errors.Is(err, domain.ErrMemberNotFound) {
				return domain.ErrTokenInvalid
			}
			return err
		}
		if m.Status != domain.MemberActive {
			return domain.ErrMemberInactive
		}
		stats, err := s.members.Stats(ctx, storeID, memberID)
		if err != nil {
			return err
		}
		st, err := s.stores.Get(ctx, storeID)
		if err != nil {
			return err
		}
		out = &LiffMe{Member: m, ShareCapital: m.ShareCapital, ARBalance: stats.ARBalance, ARBills: stats.ARBills, YTDPurchases: stats.YTDPurchases, Store: storeInfo(st)}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Service) LiffPurchases(ctx context.Context, storeID, memberID uuid.UUID, year int) (*PurchaseSummary, error) {
	return s.MemberPurchases(ctx, storeID, memberID, year)
}

// DividendEstimate projects the next payout from the latest final run's rates and the member's current position.
// Rates are applied per unit: share_dividend = shares × rate_per_share, rebate = purchases × rebate_rate.
// Shares are derived from share_capital using the share/capital ratio of the member's latest statement
// (falls back to 1 share per ฿1 when no statement exists). Nil rate → nil component.
type DividendEstimate struct {
	BasedOnYear   int              `json:"based_on_year"`
	RatePerShare  *decimal.Decimal `json:"rate_per_share"`
	RebateRate    *decimal.Decimal `json:"rebate_rate"`
	ShareCapital  decimal.Decimal  `json:"share_capital"`
	Shares        decimal.Decimal  `json:"shares"`
	Purchases     decimal.Decimal  `json:"purchases"`
	ShareDividend *decimal.Decimal `json:"share_dividend"`
	Rebate        *decimal.Decimal `json:"rebate"`
	Total         *decimal.Decimal `json:"total"`
}

// LiffDividend is GET /liff/dividend.
type LiffDividend struct {
	History  []postgres.DividendHistoryRow `json:"history"`
	Estimate *DividendEstimate             `json:"estimate"`
}

// estimateDividend is pure so it can be unit-tested.
func estimateDividend(rates postgres.DividendRates, capital, purchases decimal.Decimal, last *postgres.DividendHistoryRow) DividendEstimate {
	shares := capital
	if last != nil && last.ShareCapital.IsPositive() && last.Shares.IsPositive() {
		shares = capital.Mul(last.Shares).Div(last.ShareCapital).Round(4)
	}
	est := DividendEstimate{BasedOnYear: rates.BEYear, RatePerShare: rates.RatePerShare, RebateRate: rates.RebateRate, ShareCapital: capital, Shares: shares, Purchases: purchases}
	total := decimal.Zero
	any := false
	if rates.RatePerShare != nil {
		d := shares.Mul(*rates.RatePerShare).Round(2)
		est.ShareDividend = &d
		total = total.Add(d)
		any = true
	}
	if rates.RebateRate != nil {
		r := purchases.Mul(*rates.RebateRate).Round(2)
		est.Rebate = &r
		total = total.Add(r)
		any = true
	}
	if any {
		est.Total = &total
	}
	return est
}

func (s *Service) LiffDividend(ctx context.Context, storeID, memberID uuid.UUID) (*LiffDividend, error) {
	out := &LiffDividend{History: []postgres.DividendHistoryRow{}}
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		m, err := s.members.Get(ctx, storeID, memberID)
		if err != nil {
			return err
		}
		if out.History, err = s.dividends.MemberHistory(ctx, storeID, memberID); err != nil {
			return err
		}
		rates, found, err := s.dividends.LatestFinalRates(ctx, storeID)
		if err != nil || !found {
			return err
		}
		stats, err := s.members.Stats(ctx, storeID, memberID)
		if err != nil {
			return err
		}
		var last *postgres.DividendHistoryRow
		if len(out.History) > 0 {
			last = &out.History[0]
		}
		est := estimateDividend(rates, m.ShareCapital, stats.YTDPurchases, last)
		out.Estimate = &est
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Service) LiffStore(ctx context.Context, storeID uuid.UUID) (*LiffStoreInfo, error) {
	var out *LiffStoreInfo
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		st, err := s.stores.Get(ctx, storeID)
		if err != nil {
			return err
		}
		info := storeInfo(st)
		out = &info
		return nil
	})
	return out, err
}
