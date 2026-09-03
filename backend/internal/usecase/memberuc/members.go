package memberuc

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

// ListFilter is the query for GET /members.
type ListFilter struct {
	Q         string
	Status    string
	HasShares *bool
	Page      int
	PageSize  int
}

func (s *Service) ListMembers(ctx context.Context, storeID uuid.UUID, f ListFilter) ([]domain.MemberView, int64, error) {
	if f.Status != "" && !domain.MemberStatus(f.Status).Valid() {
		return nil, 0, domain.ErrValidation.With("field", "status")
	}
	if f.Page < 1 {
		f.Page = 1
	}
	if f.PageSize < 1 {
		f.PageSize = 50
	}
	var out []domain.MemberView
	var total int64
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, total, err = s.members.List(ctx, storeID, postgres.MemberFilter{Q: f.Q, Status: f.Status, HasShares: f.HasShares, Limit: f.PageSize, Offset: (f.Page - 1) * f.PageSize})
		return err
	})
	return out, total, err
}

func (s *Service) SearchMembers(ctx context.Context, storeID uuid.UUID, q string, limit int) ([]domain.Member, error) {
	if limit < 1 || limit > 50 {
		limit = 10
	}
	var out []domain.Member
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.members.Search(ctx, storeID, q, limit)
		return err
	})
	return out, err
}

// MemberInput is the body of POST /members.
type MemberInput struct {
	MemberCode   string          `json:"member_code"`
	Name         string          `json:"name"`
	Address      string          `json:"address"`
	Phone        string          `json:"phone"`
	Email        string          `json:"email"`
	NationalID   string          `json:"national_id"`
	JoinedAt     *domain.Date    `json:"joined_at"`
	PriceTier    int             `json:"price_tier"`
	Note         string          `json:"note"`
	OpeningShare decimal.Decimal `json:"opening_share"`
}

func validatePriceTier(t int) error {
	if t < 0 || t > 4 {
		return domain.ErrValidation.With("field", "price_tier")
	}
	return nil
}

func (s *Service) CreateMember(ctx context.Context, actor Actor, storeID uuid.UUID, in MemberInput) (*domain.Member, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, domain.ErrValidation.With("field", "name")
	}
	if err := validatePriceTier(in.PriceTier); err != nil {
		return nil, err
	}
	opening := in.OpeningShare.Round(2)
	if opening.IsNegative() {
		return nil, domain.ErrValidation.With("field", "opening_share")
	}
	m := &domain.Member{
		StoreID: storeID, MemberCode: NormalizeMemberCode(in.MemberCode), Name: name,
		Address: strings.TrimSpace(in.Address), Phone: NormalizePhone(in.Phone), Email: strings.TrimSpace(in.Email),
		NationalID: strings.TrimSpace(in.NationalID), JoinedAt: in.JoinedAt, PriceTier: in.PriceTier,
		Status: domain.MemberActive, Note: strings.TrimSpace(in.Note), ShareCapital: opening,
	}
	if m.JoinedAt != nil && m.JoinedAt.IsZero() {
		m.JoinedAt = nil
	}
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		if m.MemberCode == "" {
			max, err := s.members.MaxNumericCode(ctx, storeID)
			if err != nil {
				return err
			}
			m.MemberCode = NextMemberCode(max)
		}
		if err := s.members.Create(ctx, m); err != nil {
			return err
		}
		if opening.IsPositive() {
			tx := &domain.ShareTx{StoreID: storeID, MemberID: m.ID, Type: domain.ShareOpening, Amount: opening, BalanceAfter: opening, Note: "opening balance", CreatedBy: actorID(actor)}
			if err := s.shares.Insert(ctx, tx); err != nil {
				return err
			}
			if err := s.writeAudit(ctx, storeID, actor, "member.share.opening", "member_share_tx", tx.ID.String(), nil, tx); err != nil {
				return err
			}
		}
		return s.writeAudit(ctx, storeID, actor, "member.create", "member", m.ID.String(), nil, m)
	})
	if err != nil {
		return nil, err
	}
	return m, nil
}

// MemberDetail is GET /members/{id}: the member, computed balances and the latest share transactions.
type MemberDetail struct {
	domain.Member
	postgres.MemberStats
	ShareBalance      decimal.Decimal  `json:"share_balance"`
	ShareTransactions []domain.ShareTx `json:"share_transactions"`
}

func (s *Service) GetMember(ctx context.Context, storeID, id uuid.UUID) (*MemberDetail, error) {
	var out MemberDetail
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		m, err := s.members.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		out.Member = *m
		out.ShareBalance = m.ShareCapital
		if out.MemberStats, err = s.members.Stats(ctx, storeID, id); err != nil {
			return err
		}
		out.ShareTransactions, _, err = s.shares.List(ctx, storeID, id, 20, 0)
		return err
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// MemberPatch is the body of PATCH /members/{id}; nil fields are left unchanged.
type MemberPatch struct {
	MemberCode *string      `json:"member_code"`
	Name       *string      `json:"name"`
	Address    *string      `json:"address"`
	Phone      *string      `json:"phone"`
	Email      *string      `json:"email"`
	NationalID *string      `json:"national_id"`
	JoinedAt   *domain.Date `json:"joined_at"`
	PriceTier  *int         `json:"price_tier"`
	Note       *string      `json:"note"`
}

func (s *Service) UpdateMember(ctx context.Context, actor Actor, storeID, id uuid.UUID, in MemberPatch) (*domain.Member, error) {
	var out *domain.Member
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		m, err := s.members.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		before := *m
		if in.MemberCode != nil {
			code := NormalizeMemberCode(*in.MemberCode)
			if code == "" || (m.IsWalkin && code != m.MemberCode) {
				return domain.ErrValidation.With("field", "member_code")
			}
			m.MemberCode = code
		}
		if in.Name != nil {
			if strings.TrimSpace(*in.Name) == "" {
				return domain.ErrValidation.With("field", "name")
			}
			m.Name = strings.TrimSpace(*in.Name)
		}
		if in.Address != nil {
			m.Address = strings.TrimSpace(*in.Address)
		}
		if in.Phone != nil {
			m.Phone = NormalizePhone(*in.Phone)
		}
		if in.Email != nil {
			m.Email = strings.TrimSpace(*in.Email)
		}
		if in.NationalID != nil {
			m.NationalID = strings.TrimSpace(*in.NationalID)
		}
		if in.JoinedAt != nil {
			if in.JoinedAt.IsZero() {
				m.JoinedAt = nil
			} else {
				m.JoinedAt = in.JoinedAt
			}
		}
		if in.PriceTier != nil {
			if err := validatePriceTier(*in.PriceTier); err != nil {
				return err
			}
			m.PriceTier = *in.PriceTier
		}
		if in.Note != nil {
			m.Note = strings.TrimSpace(*in.Note)
		}
		if err := s.members.Update(ctx, m); err != nil {
			return err
		}
		if out, err = s.members.Get(ctx, storeID, id); err != nil {
			return err
		}
		return s.writeAudit(ctx, storeID, actor, "member.update", "member", id.String(), before, out)
	})
	return out, err
}

func (s *Service) SetMemberStatus(ctx context.Context, actor Actor, storeID, id uuid.UUID, status string) (*domain.Member, error) {
	st := domain.MemberStatus(status)
	if !st.Valid() {
		return nil, domain.ErrValidation.With("field", "status")
	}
	var out *domain.Member
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		m, err := s.members.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		if m.IsWalkin {
			return domain.ErrValidation.With("field", "status")
		}
		if m.Status == st {
			out = m
			return nil
		}
		if err := s.members.SetStatus(ctx, storeID, id, st); err != nil {
			return err
		}
		if out, err = s.members.Get(ctx, storeID, id); err != nil {
			return err
		}
		return s.writeAudit(ctx, storeID, actor, "member.status", "member", id.String(), map[string]any{"status": m.Status}, map[string]any{"status": st})
	})
	return out, err
}

// PurchaseSummary is the yearly purchase view (staff GET /members/{id}/purchases and LIFF GET /liff/purchases).
type PurchaseSummary struct {
	Year   int                   `json:"year"`
	Total  decimal.Decimal       `json:"total"`
	Bills  int                   `json:"bills"`
	Months []postgres.MonthTotal `json:"months"`
	Recent []postgres.SaleBrief  `json:"recent"`
}

const recentSalesLimit = 50

func normalizeYear(year int) (int, error) {
	cur := postgres.CurrentYear()
	if year == 0 {
		return cur, nil
	}
	if year < 2000 || year > cur+1 {
		return 0, domain.ErrValidation.With("field", "year")
	}
	return year, nil
}

func (s *Service) purchases(ctx context.Context, storeID, memberID uuid.UUID, year int) (*PurchaseSummary, error) {
	months, err := s.members.MonthlyPurchases(ctx, storeID, memberID, year)
	if err != nil {
		return nil, err
	}
	recent, err := s.members.RecentSales(ctx, storeID, memberID, year, recentSalesLimit)
	if err != nil {
		return nil, err
	}
	out := &PurchaseSummary{Year: year, Total: decimal.Zero, Months: months, Recent: recent}
	for _, m := range months {
		out.Total = out.Total.Add(m.Total)
		out.Bills += m.Bills
	}
	return out, nil
}

func (s *Service) MemberPurchases(ctx context.Context, storeID, id uuid.UUID, year int) (*PurchaseSummary, error) {
	year, err := normalizeYear(year)
	if err != nil {
		return nil, err
	}
	var out *PurchaseSummary
	err = s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		if _, err := s.members.Get(ctx, storeID, id); err != nil {
			return err
		}
		var err error
		out, err = s.purchases(ctx, storeID, id, year)
		return err
	})
	return out, err
}
