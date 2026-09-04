package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/svdev/pos/internal/domain"
)

// SlipRepo stores the photographs of transfer/QR slips attached to a sale.
type SlipRepo struct{}

// slipCols deliberately leaves the image out: lists must stay light, the bytes are fetched one by one.
const slipCols = `s.id, s.store_id, s.sale_id, sa.doc_no, s.method, s.amount::text, s.mime, s.size_bytes,
	COALESCE(s.note,''), s.captured_at, s.captured_by, COALESCE(cu.display_name,''),
	s.verified_at, s.verified_by, COALESCE(vu.display_name,'')`

const slipFrom = `FROM payment_slips s
	JOIN sales sa ON sa.id = s.sale_id
	LEFT JOIN users cu ON cu.id = s.captured_by
	LEFT JOIN users vu ON vu.id = s.verified_by`

func scanSlip(row pgx.Row) (*domain.PaymentSlip, error) {
	var s domain.PaymentSlip
	var amount string
	if err := row.Scan(&s.ID, &s.StoreID, &s.SaleID, &s.SaleDocNo, &s.Method, &amount, &s.Mime, &s.SizeBytes,
		&s.Note, &s.CapturedAt, &s.CapturedBy, &s.CapturedByName,
		&s.VerifiedAt, &s.VerifiedBy, &s.VerifiedByName); err != nil {
		return nil, err
	}
	s.Amount = dec(amount)
	return &s, nil
}

func (SlipRepo) Create(ctx context.Context, s *domain.PaymentSlip, image []byte) error {
	return Q(ctx).QueryRow(ctx, `INSERT INTO payment_slips
		(store_id, sale_id, method, amount, image, mime, size_bytes, note, captured_by)
		VALUES ($1,$2,$3,$4::numeric,$5,$6,$7,NULLIF($8,''),$9) RETURNING id, captured_at`,
		s.StoreID, s.SaleID, s.Method, s.Amount.String(), image, s.Mime, len(image), s.Note, s.CapturedBy).
		Scan(&s.ID, &s.CapturedAt)
}

func (SlipRepo) ListBySale(ctx context.Context, storeID, saleID uuid.UUID) ([]domain.PaymentSlip, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT `+slipCols+` `+slipFrom+
		` WHERE s.store_id=$1 AND s.sale_id=$2 ORDER BY s.captured_at`, storeID, saleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.PaymentSlip{}
	for rows.Next() {
		s, err := scanSlip(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// ListPending returns slips nobody has checked yet, newest first.
func (SlipRepo) ListPending(ctx context.Context, storeID uuid.UUID, limit, offset int) ([]domain.PaymentSlip, int64, error) {
	var total int64
	if err := Q(ctx).QueryRow(ctx, `SELECT count(*) FROM payment_slips WHERE store_id=$1 AND verified_at IS NULL`, storeID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := Q(ctx).Query(ctx, `SELECT `+slipCols+` `+slipFrom+
		` WHERE s.store_id=$1 AND s.verified_at IS NULL ORDER BY s.captured_at DESC LIMIT $2 OFFSET $3`, storeID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []domain.PaymentSlip{}
	for rows.Next() {
		s, err := scanSlip(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *s)
	}
	return out, total, rows.Err()
}

func (SlipRepo) Get(ctx context.Context, storeID, id uuid.UUID) (*domain.PaymentSlip, error) {
	s, err := scanSlip(Q(ctx).QueryRow(ctx, `SELECT `+slipCols+` `+slipFrom+` WHERE s.store_id=$1 AND s.id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return s, err
}

// Image returns the stored bytes and their type.
func (SlipRepo) Image(ctx context.Context, storeID, id uuid.UUID) ([]byte, string, error) {
	var img []byte
	var mime string
	err := Q(ctx).QueryRow(ctx, `SELECT image, mime FROM payment_slips WHERE store_id=$1 AND id=$2`, storeID, id).Scan(&img, &mime)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", domain.ErrNotFound
	}
	return img, mime, err
}

func (SlipRepo) SetVerified(ctx context.Context, storeID, id uuid.UUID, by *uuid.UUID, verified bool) error {
	var tag pgx.Rows
	_ = tag
	var err error
	if verified {
		_, err = Q(ctx).Exec(ctx, `UPDATE payment_slips SET verified_at=now(), verified_by=$3 WHERE store_id=$1 AND id=$2`, storeID, id, by)
	} else {
		_, err = Q(ctx).Exec(ctx, `UPDATE payment_slips SET verified_at=NULL, verified_by=NULL WHERE store_id=$1 AND id=$2`, storeID, id)
	}
	return err
}

func (SlipRepo) Delete(ctx context.Context, storeID, id uuid.UUID) error {
	tag, err := Q(ctx).Exec(ctx, `DELETE FROM payment_slips WHERE store_id=$1 AND id=$2`, storeID, id)
	if err == nil && tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return err
}
