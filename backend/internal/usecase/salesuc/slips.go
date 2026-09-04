package salesuc

import (
	"bytes"
	"context"
	"image"
	_ "image/jpeg" // decoding only: we accept what a phone camera produces
	_ "image/png"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

// A slip photo is evidence that a transfer or QR payment really arrived. The cashier takes it at
// the till or on the debt-collection round; a manager checks it against the shop's bank account
// and marks it verified.

// MaxSlipBytes caps one photo. Phones happily produce 5 MB files; the UI shrinks them first, and
// this is the backstop so a till cannot fill the database.
const MaxSlipBytes = 3 << 20

var slipMimes = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true}

type SlipInput struct {
	// Exactly one target, or neither: a slip may be photographed before anyone knows which record
	// it belongs to, and matched later from the slip menu.
	SaleID      *uuid.UUID
	ARPaymentID *uuid.UUID
	Method      string
	Amount      decimal.Decimal
	Mime        string
	Note        string
	Image       []byte
}

// AttachSlip stores one photograph for this store.
func (s *Service) AttachSlip(ctx context.Context, actor Actor, storeID uuid.UUID, in SlipInput) (*domain.PaymentSlip, error) {
	if len(in.Image) == 0 {
		return nil, domain.ErrValidation.With("field", "image")
	}
	if len(in.Image) > MaxSlipBytes {
		return nil, domain.ErrSlipTooLarge.With("max_mb", "3")
	}
	if in.SaleID != nil && in.ARPaymentID != nil {
		return nil, domain.ErrValidation.With("field", "sale_id")
	}
	mime := strings.ToLower(strings.TrimSpace(in.Mime))
	if mime == "" {
		mime = "image/jpeg"
	}
	if !slipMimes[mime] {
		return nil, domain.ErrSlipFormat.With("mime", mime)
	}
	// it must actually be an image, not a renamed file
	if _, _, err := image.DecodeConfig(bytes.NewReader(in.Image)); err != nil && mime != "image/webp" {
		return nil, domain.ErrSlipFormat.With("mime", mime)
	}

	slip := &domain.PaymentSlip{
		StoreID: storeID, SaleID: in.SaleID, ARPaymentID: in.ARPaymentID,
		Method: strings.TrimSpace(in.Method), Amount: in.Amount.Round(2),
		Mime: mime, Note: strings.TrimSpace(in.Note), CapturedBy: actor.idPtr(),
	}
	if slip.Method == "" {
		slip.Method = string(domain.PayQR)
	}
	var out *domain.PaymentSlip
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		if err := s.resolveSlipTarget(ctx, storeID, slip); err != nil {
			return err
		}
		if err := s.slips.Create(ctx, slip, in.Image); err != nil {
			return err
		}
		var err error
		if out, err = s.slips.Get(ctx, storeID, slip.ID); err != nil {
			return err
		}
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: actor.idPtr(), ActorName: actor.Name,
			Action: "sale.slip.attach", Entity: "payment_slip", EntityID: slip.ID.String(),
			After: map[string]any{"ref_type": out.RefType(), "ref_doc_no": out.RefDocNo(), "size": len(in.Image)}, IP: actor.IP})
	})
	return out, err
}

// resolveSlipTarget checks that the record the slip points at belongs to this store, and fills in
// the receipt number a debt payment is filed under.
func (s *Service) resolveSlipTarget(ctx context.Context, storeID uuid.UUID, slip *domain.PaymentSlip) error {
	slip.ARDocNo = ""
	switch {
	case slip.SaleID != nil:
		// the foreign key alone would not say which store the bill is in
		if _, err := s.sales.Get(ctx, storeID, *slip.SaleID); err != nil {
			return err
		}
	case slip.ARPaymentID != nil:
		docNo, err := s.slips.ARPaymentDoc(ctx, storeID, *slip.ARPaymentID)
		if err != nil {
			return err
		}
		slip.ARDocNo = docNo
	}
	return nil
}

func (s *Service) SlipsOfSale(ctx context.Context, storeID, saleID uuid.UUID) ([]domain.PaymentSlip, error) {
	var out []domain.PaymentSlip
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) (err error) {
		out, err = s.slips.ListBySale(ctx, storeID, saleID)
		return
	})
	return out, err
}

// SlipsOfARPayment returns the slips filed against the receipt that row belongs to.
func (s *Service) SlipsOfARPayment(ctx context.Context, storeID, paymentID uuid.UUID) ([]domain.PaymentSlip, error) {
	var out []domain.PaymentSlip
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		docNo, err := s.slips.ARPaymentDoc(ctx, storeID, paymentID)
		if err != nil {
			return err
		}
		out, err = s.slips.ListByARDoc(ctx, storeID, docNo)
		return err
	})
	return out, err
}

// ListSlips serves the manager's queues: "pending" (unchecked), "unassigned" (not matched to a
// record yet) or "all".
func (s *Service) ListSlips(ctx context.Context, storeID uuid.UUID, scope string, limit, offset int) ([]domain.PaymentSlip, int64, error) {
	var out []domain.PaymentSlip
	var total int64
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) (err error) {
		out, total, err = s.slips.List(ctx, storeID, postgres.SlipFilter{Scope: scope, Limit: limit, Offset: offset})
		return
	})
	return out, total, err
}

// PendingSlips is the unchecked queue (kept for the existing callers).
func (s *Service) PendingSlips(ctx context.Context, storeID uuid.UUID, limit, offset int) ([]domain.PaymentSlip, int64, error) {
	return s.ListSlips(ctx, storeID, "pending", limit, offset)
}

// SlipCandidates lists the bills and debt receipts a loose photograph could belong to.
func (s *Service) SlipCandidates(ctx context.Context, storeID uuid.UUID, from, to time.Time, amount decimal.Decimal, limit int) ([]postgres.SlipCandidate, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var out []postgres.SlipCandidate
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) (err error) {
		out, err = s.slips.Candidates(ctx, storeID, from, to, amount, limit)
		return
	})
	return out, err
}

// AssignSlip matches a photograph to a bill or a debt receipt — the "map it to the right record"
// step. Passing neither id unmatches it again.
func (s *Service) AssignSlip(ctx context.Context, actor Actor, storeID, id uuid.UUID, saleID, arPaymentID *uuid.UUID) (*domain.PaymentSlip, error) {
	if saleID != nil && arPaymentID != nil {
		return nil, domain.ErrValidation.With("field", "sale_id")
	}
	var out *domain.PaymentSlip
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		before, err := s.slips.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		target := &domain.PaymentSlip{SaleID: saleID, ARPaymentID: arPaymentID}
		if err := s.resolveSlipTarget(ctx, storeID, target); err != nil {
			return err
		}
		if err := s.slips.Assign(ctx, storeID, id, saleID, arPaymentID, target.ARDocNo); err != nil {
			return err
		}
		if out, err = s.slips.Get(ctx, storeID, id); err != nil {
			return err
		}
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: actor.idPtr(), ActorName: actor.Name,
			Action: "sale.slip.assign", Entity: "payment_slip", EntityID: id.String(),
			Before: map[string]any{"ref_type": before.RefType(), "ref_doc_no": before.RefDocNo()},
			After:  map[string]any{"ref_type": out.RefType(), "ref_doc_no": out.RefDocNo()}, IP: actor.IP})
	})
	return out, err
}

func (s *Service) SlipImage(ctx context.Context, storeID, id uuid.UUID) ([]byte, string, error) {
	var img []byte
	var mime string
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) (err error) {
		img, mime, err = s.slips.Image(ctx, storeID, id)
		return
	})
	return img, mime, err
}

// SetSlipVerified records that a manager compared the slip with the bank account (or undoes it).
func (s *Service) SetSlipVerified(ctx context.Context, actor Actor, storeID, id uuid.UUID, verified bool) (*domain.PaymentSlip, error) {
	var out *domain.PaymentSlip
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		cur, err := s.slips.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		// checking off a slip that belongs to nothing would hide it from both queues
		if verified && cur.RefType() == domain.SlipRefUnassigned {
			return domain.ErrSlipUnassigned
		}
		if err := s.slips.SetVerified(ctx, storeID, id, actor.idPtr(), verified); err != nil {
			return err
		}
		if out, err = s.slips.Get(ctx, storeID, id); err != nil {
			return err
		}
		action := "sale.slip.verify"
		if !verified {
			action = "sale.slip.unverify"
		}
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: actor.idPtr(), ActorName: actor.Name,
			Action: action, Entity: "payment_slip", EntityID: id.String(), After: out, IP: actor.IP})
	})
	return out, err
}

func (s *Service) DeleteSlip(ctx context.Context, actor Actor, storeID, id uuid.UUID) error {
	return s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		cur, err := s.slips.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		if err := s.slips.Delete(ctx, storeID, id); err != nil {
			return err
		}
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: actor.idPtr(), ActorName: actor.Name,
			Action: "sale.slip.delete", Entity: "payment_slip", EntityID: id.String(), Before: cur, IP: actor.IP})
	})
}
