package salesuc

import (
	"bytes"
	"context"
	"image"
	_ "image/jpeg" // decoding only: we accept what a phone camera produces
	_ "image/png"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

// A slip photo is evidence that a transfer or QR payment really arrived. The cashier takes it at
// the till; a manager checks it against the shop's bank account and marks it verified.

// MaxSlipBytes caps one photo. Phones happily produce 5 MB files; the UI shrinks them first, and
// this is the backstop so a till cannot fill the database.
const MaxSlipBytes = 3 << 20

var slipMimes = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true}

type SlipInput struct {
	SaleID uuid.UUID
	Method string
	Amount decimal.Decimal
	Mime   string
	Note   string
	Image  []byte
}

// AttachSlip stores one photograph against a sale of this store.
func (s *Service) AttachSlip(ctx context.Context, actor Actor, storeID uuid.UUID, in SlipInput) (*domain.PaymentSlip, error) {
	if len(in.Image) == 0 {
		return nil, domain.ErrValidation.With("field", "image")
	}
	if len(in.Image) > MaxSlipBytes {
		return nil, domain.ErrSlipTooLarge.With("max_mb", "3")
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
		StoreID: storeID, SaleID: in.SaleID, Method: strings.TrimSpace(in.Method), Amount: in.Amount.Round(2),
		Mime: mime, Note: strings.TrimSpace(in.Note), CapturedBy: actor.idPtr(),
	}
	if slip.Method == "" {
		slip.Method = string(domain.PayQR)
	}
	var out *domain.PaymentSlip
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		// the sale must belong to this store (the FK alone would not say which store)
		if _, err := s.sales.Get(ctx, storeID, in.SaleID); err != nil {
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
			After: map[string]any{"sale_id": in.SaleID, "method": slip.Method, "size": len(in.Image)}, IP: actor.IP})
	})
	return out, err
}

func (s *Service) SlipsOfSale(ctx context.Context, storeID, saleID uuid.UUID) ([]domain.PaymentSlip, error) {
	var out []domain.PaymentSlip
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) (err error) {
		out, err = s.slips.ListBySale(ctx, storeID, saleID)
		return
	})
	return out, err
}

// PendingSlips lists what nobody has checked yet — the manager's work queue.
func (s *Service) PendingSlips(ctx context.Context, storeID uuid.UUID, limit, offset int) ([]domain.PaymentSlip, int64, error) {
	var out []domain.PaymentSlip
	var total int64
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) (err error) {
		out, total, err = s.slips.ListPending(ctx, storeID, limit, offset)
		return
	})
	return out, total, err
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
		if _, err := s.slips.Get(ctx, storeID, id); err != nil {
			return err
		}
		if err := s.slips.SetVerified(ctx, storeID, id, actor.idPtr(), verified); err != nil {
			return err
		}
		var err error
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
