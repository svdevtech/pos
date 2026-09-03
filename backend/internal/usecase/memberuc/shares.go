package memberuc

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
)

func (s *Service) ListShares(ctx context.Context, storeID, memberID uuid.UUID, limit, offset int) ([]domain.ShareTx, int64, error) {
	var out []domain.ShareTx
	var total int64
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		if _, err := s.members.Get(ctx, storeID, memberID); err != nil {
			return err
		}
		var err error
		out, total, err = s.shares.List(ctx, storeID, memberID, limit, offset)
		return err
	})
	return out, total, err
}

// ShareInput is the body of POST /members/{id}/shares.
type ShareInput struct {
	Type       string          `json:"type"` // deposit | withdraw | adjust
	Amount     decimal.Decimal `json:"amount"`
	Note       string          `json:"note"`
	OccurredAt *time.Time      `json:"occurred_at"`
}

// applyShare computes the signed ledger amount and the resulting balance for a manual share transaction.
// deposit/withdraw take a positive amount; adjust takes a signed non-zero amount. The balance may never go negative.
func applyShare(balance decimal.Decimal, typ domain.ShareTxType, amount decimal.Decimal) (signed, after decimal.Decimal, err error) {
	amount = amount.Round(2)
	switch typ {
	case domain.ShareDeposit:
		if !amount.IsPositive() {
			return signed, after, domain.ErrValidation.With("field", "amount")
		}
		signed = amount
	case domain.ShareWithdraw:
		if !amount.IsPositive() {
			return signed, after, domain.ErrValidation.With("field", "amount")
		}
		signed = amount.Neg()
	case domain.ShareAdjust:
		if amount.IsZero() {
			return signed, after, domain.ErrValidation.With("field", "amount")
		}
		signed = amount
	default:
		return signed, after, domain.ErrValidation.With("field", "type")
	}
	after = balance.Add(signed)
	if after.IsNegative() {
		return signed, after, domain.ErrShareInsufficient.With("balance", balance.StringFixed(2))
	}
	return signed, after, nil
}

func (s *Service) PostShare(ctx context.Context, actor Actor, storeID, memberID uuid.UUID, in ShareInput) (*domain.ShareTx, error) {
	typ := domain.ShareTxType(strings.ToLower(strings.TrimSpace(in.Type)))
	if typ != domain.ShareDeposit && typ != domain.ShareWithdraw && typ != domain.ShareAdjust {
		return nil, domain.ErrValidation.With("field", "type")
	}
	var out *domain.ShareTx
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		m, err := s.members.GetForUpdate(ctx, storeID, memberID)
		if err != nil {
			return err
		}
		if m.IsWalkin {
			return domain.ErrValidation.With("field", "member")
		}
		signed, after, err := applyShare(m.ShareCapital, typ, in.Amount)
		if err != nil {
			return err
		}
		tx := &domain.ShareTx{StoreID: storeID, MemberID: memberID, Type: typ, Amount: signed, BalanceAfter: after, Note: strings.TrimSpace(in.Note), CreatedBy: actorID(actor)}
		if in.OccurredAt != nil {
			tx.OccurredAt = *in.OccurredAt
		}
		if err := s.shares.Insert(ctx, tx); err != nil {
			return err
		}
		if err := s.members.SetShareCapital(ctx, storeID, memberID, after); err != nil {
			return err
		}
		out = tx
		return s.writeAudit(ctx, storeID, actor, "member.share."+string(typ), "member_share_tx", tx.ID.String(),
			map[string]any{"share_capital": m.ShareCapital}, tx)
	})
	return out, err
}
