package postgres

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
)

// SlipRepo stores the photographs of transfer/QR slips. A slip is proof of a bill at the till, of
// a member paying off credit, or of nothing yet — see domain.PaymentSlip.
type SlipRepo struct{}

// slipCols deliberately leaves the image out: lists must stay light, the bytes are fetched one by one.
const slipCols = `s.id, s.store_id, s.sale_id, COALESCE(sa.doc_no,''), s.ar_payment_id, COALESCE(s.ar_doc_no,''),
	COALESCE(sm.name, am.name, ''), s.method, s.amount::text, s.mime, s.size_bytes,
	COALESCE(s.note,''), s.captured_at, s.captured_by, COALESCE(cu.display_name,''),
	s.verified_at, s.verified_by, COALESCE(vu.display_name,'')`

const slipFrom = `FROM payment_slips s
	LEFT JOIN sales sa ON sa.id = s.sale_id
	LEFT JOIN members sm ON sm.id = sa.member_id
	LEFT JOIN ar_payments ap ON ap.id = s.ar_payment_id
	LEFT JOIN members am ON am.id = ap.member_id
	LEFT JOIN users cu ON cu.id = s.captured_by
	LEFT JOIN users vu ON vu.id = s.verified_by`

func scanSlip(row pgx.Row) (*domain.PaymentSlip, error) {
	var s domain.PaymentSlip
	var amount string
	if err := row.Scan(&s.ID, &s.StoreID, &s.SaleID, &s.SaleDocNo, &s.ARPaymentID, &s.ARDocNo, &s.MemberName,
		&s.Method, &amount, &s.Mime, &s.SizeBytes,
		&s.Note, &s.CapturedAt, &s.CapturedBy, &s.CapturedByName,
		&s.VerifiedAt, &s.VerifiedBy, &s.VerifiedByName); err != nil {
		return nil, err
	}
	s.Amount = dec(amount)
	return &s, nil
}

func collectSlips(rows pgx.Rows) ([]domain.PaymentSlip, error) {
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

func (SlipRepo) Create(ctx context.Context, s *domain.PaymentSlip, image []byte) error {
	return Q(ctx).QueryRow(ctx, `INSERT INTO payment_slips
		(store_id, sale_id, ar_payment_id, ar_doc_no, method, amount, image, mime, size_bytes, note, captured_by)
		VALUES ($1,$2,$3,NULLIF($4,''),$5,$6::numeric,$7,$8,$9,NULLIF($10,''),$11) RETURNING id, captured_at`,
		s.StoreID, s.SaleID, s.ARPaymentID, s.ARDocNo, s.Method, s.Amount.String(), image, s.Mime, len(image), s.Note, s.CapturedBy).
		Scan(&s.ID, &s.CapturedAt)
}

func (SlipRepo) ListBySale(ctx context.Context, storeID, saleID uuid.UUID) ([]domain.PaymentSlip, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT `+slipCols+` `+slipFrom+
		` WHERE s.store_id=$1 AND s.sale_id=$2 ORDER BY s.captured_at`, storeID, saleID)
	if err != nil {
		return nil, err
	}
	return collectSlips(rows)
}

// ListByARDoc returns the slips of one "รับชำระหนี้" receipt. The receipt writes a row per bill it
// settles, so the document number — not the row id — is what the photograph belongs to.
func (SlipRepo) ListByARDoc(ctx context.Context, storeID uuid.UUID, docNo string) ([]domain.PaymentSlip, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT `+slipCols+` `+slipFrom+
		` WHERE s.store_id=$1 AND s.ar_doc_no=$2 ORDER BY s.captured_at`, storeID, docNo)
	if err != nil {
		return nil, err
	}
	return collectSlips(rows)
}

// SlipFilter selects a page of the slip queues.
type SlipFilter struct {
	// Scope: "pending" (not checked yet), "unassigned" (no record yet), "all".
	Scope  string
	Limit  int
	Offset int
}

func (SlipRepo) List(ctx context.Context, storeID uuid.UUID, f SlipFilter) ([]domain.PaymentSlip, int64, error) {
	where := "s.store_id=$1"
	switch f.Scope {
	case "unassigned":
		where += " AND s.sale_id IS NULL AND s.ar_payment_id IS NULL"
	case "all":
	default: // pending
		where += " AND s.verified_at IS NULL"
	}
	var total int64
	if err := Q(ctx).QueryRow(ctx, `SELECT count(*) `+slipFrom+` WHERE `+where, storeID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := Q(ctx).Query(ctx, `SELECT `+slipCols+` `+slipFrom+` WHERE `+where+
		` ORDER BY s.captured_at DESC LIMIT $2 OFFSET $3`, storeID, f.Limit, f.Offset)
	if err != nil {
		return nil, 0, err
	}
	out, err := collectSlips(rows)
	return out, total, err
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

// Assign points an existing slip at a record (or, with all-nil arguments, back at nothing).
func (SlipRepo) Assign(ctx context.Context, storeID, id uuid.UUID, saleID, arPaymentID *uuid.UUID, arDocNo string) error {
	tag, err := Q(ctx).Exec(ctx, `UPDATE payment_slips SET sale_id=$3, ar_payment_id=$4, ar_doc_no=NULLIF($5,'')
		WHERE store_id=$1 AND id=$2`, storeID, id, saleID, arPaymentID, arDocNo)
	if err == nil && tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return err
}

func (SlipRepo) SetVerified(ctx context.Context, storeID, id uuid.UUID, by *uuid.UUID, verified bool) error {
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

// SlipCandidate is a record a loose slip could belong to: a bill or a debt-payment receipt that
// was settled by transfer or QR.
type SlipCandidate struct {
	RefType    string          `json:"ref_type"` // sale | ar_payment
	RefID      uuid.UUID       `json:"ref_id"`
	DocNo      string          `json:"doc_no"`
	Amount     decimal.Decimal `json:"amount"`
	At         time.Time       `json:"at"`
	MemberName string          `json:"member_name,omitempty"`
	Method     string          `json:"method"`
	HasSlip    bool            `json:"has_slip"`
}

// Candidates lists what a photograph taken now most likely belongs to. Money that arrived by
// transfer or QR is what needs proof, so cash bills are left out; when an amount is given the
// closest match comes first, which is almost always the right row.
func (SlipRepo) Candidates(ctx context.Context, storeID uuid.UUID, from, to time.Time, amount decimal.Decimal, limit int) ([]SlipCandidate, error) {
	amt := "NULL"
	args := []any{storeID, from, to, limit}
	if amount.IsPositive() {
		amt = "$5::numeric"
		args = append(args, amount.String())
	}
	q := `
WITH bills AS (
  SELECT 'sale'::text AS ref_type, s.id AS ref_id, s.doc_no, s.net AS amount, s.sold_at AS at,
         COALESCE(m.name,'') AS member_name,
         (SELECT string_agg(DISTINCT p.method::text, '/') FROM sale_payments p
            WHERE p.sale_id = s.id AND p.method IN ('qr','transfer')) AS method,
         EXISTS (SELECT 1 FROM payment_slips ps WHERE ps.sale_id = s.id) AS has_slip
  FROM sales s
  LEFT JOIN members m ON m.id = s.member_id
  WHERE s.store_id = $1 AND s.sold_at >= $2 AND s.sold_at < $3 AND s.status = 'completed'
    AND EXISTS (SELECT 1 FROM sale_payments p WHERE p.sale_id = s.id AND p.method IN ('qr','transfer'))
),
receipts AS (
  -- one representative row of the receipt (Postgres has no min() for uuid)
  SELECT 'ar_payment'::text AS ref_type, (array_agg(a.id ORDER BY a.paid_at, a.id))[1] AS ref_id, a.doc_no, sum(a.amount) AS amount,
         max(a.paid_at) AS at, COALESCE(max(m.name),'') AS member_name, max(a.method::text) AS method,
         EXISTS (SELECT 1 FROM payment_slips ps WHERE ps.ar_doc_no = a.doc_no AND ps.store_id = $1) AS has_slip
  FROM ar_payments a
  LEFT JOIN members m ON m.id = a.member_id
  WHERE a.store_id = $1 AND a.paid_at >= $2 AND a.paid_at < $3 AND a.method IN ('qr','transfer') AND a.doc_no IS NOT NULL
  GROUP BY a.doc_no
)
SELECT ref_type, ref_id, doc_no, amount::text, at, member_name, COALESCE(method,''), has_slip
FROM (SELECT * FROM bills UNION ALL SELECT * FROM receipts) c
ORDER BY CASE WHEN ` + amt + ` IS NULL THEN 0 ELSE abs(amount - ` + amt + `) END, has_slip, at DESC
LIMIT $4`

	rows, err := Q(ctx).Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SlipCandidate{}
	for rows.Next() {
		var c SlipCandidate
		var a string
		if err := rows.Scan(&c.RefType, &c.RefID, &c.DocNo, &a, &c.At, &c.MemberName, &c.Method, &c.HasSlip); err != nil {
			return nil, err
		}
		c.Amount = dec(a)
		c.Method = strings.TrimSpace(c.Method)
		out = append(out, c)
	}
	return out, rows.Err()
}

// ARPaymentDoc returns the receipt number of one ar_payments row, so a slip attached to the row is
// stored against the whole receipt.
func (SlipRepo) ARPaymentDoc(ctx context.Context, storeID, id uuid.UUID) (string, error) {
	var doc *string
	err := Q(ctx).QueryRow(ctx, `SELECT doc_no FROM ar_payments WHERE store_id=$1 AND id=$2`, storeID, id).Scan(&doc)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", domain.ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if doc == nil {
		return "", nil
	}
	return *doc, nil
}
