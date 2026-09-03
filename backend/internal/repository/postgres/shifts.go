package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
)

type ShiftRepo struct{}

const shiftCols = `s.id, s.store_id, s.cashier_id, COALESCE(u.display_name,''), s.terminal, s.opened_at, s.closed_at, s.closed_by, s.opening_float::text, s.cash_sales::text,
	s.cash_in::text, s.cash_out::text, s.expected_cash::text, s.counted_cash::text, s.variance::text, s.status::text, COALESCE(s.note,'')`

func scanShift(row pgx.Row) (*domain.Shift, error) {
	var s domain.Shift
	var of, cs, ci, co string
	var ec, cc, v *string
	if err := row.Scan(&s.ID, &s.StoreID, &s.CashierID, &s.CashierName, &s.Terminal, &s.OpenedAt, &s.ClosedAt, &s.ClosedBy, &of, &cs, &ci, &co, &ec, &cc, &v, &s.Status, &s.Note); err != nil {
		return nil, err
	}
	s.OpeningFloat, s.CashSales, s.CashIn, s.CashOut = dec(of), dec(cs), dec(ci), dec(co)
	if ec != nil {
		d := dec(*ec)
		s.ExpectedCash = &d
	}
	if cc != nil {
		d := dec(*cc)
		s.CountedCash = &d
	}
	if v != nil {
		d := dec(*v)
		s.Variance = &d
	}
	return &s, nil
}

func (ShiftRepo) Open(ctx context.Context, storeID, cashierID uuid.UUID, terminal string, float decimal.Decimal, note string) (*domain.Shift, error) {
	var id uuid.UUID
	if err := Q(ctx).QueryRow(ctx, `INSERT INTO shifts (store_id, cashier_id, terminal, opening_float, note) VALUES ($1,$2,$3,$4,NULLIF($5,'')) RETURNING id`,
		storeID, cashierID, terminal, float, note).Scan(&id); err != nil {
		return nil, err
	}
	return ShiftRepo{}.Get(ctx, storeID, id)
}

func (ShiftRepo) Get(ctx context.Context, storeID, id uuid.UUID) (*domain.Shift, error) {
	s, err := scanShift(Q(ctx).QueryRow(ctx, `SELECT `+shiftCols+` FROM shifts s LEFT JOIN users u ON u.id=s.cashier_id WHERE s.store_id=$1 AND s.id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return s, err
}

// CurrentOpen returns the open shift for a cashier (or any open shift on the terminal when cashierID is nil).
func (ShiftRepo) CurrentOpen(ctx context.Context, storeID uuid.UUID, cashierID *uuid.UUID, terminal string) (*domain.Shift, error) {
	q := `SELECT ` + shiftCols + ` FROM shifts s LEFT JOIN users u ON u.id=s.cashier_id WHERE s.store_id=$1 AND s.status='open'`
	args := []any{storeID}
	if cashierID != nil {
		q += ` AND s.cashier_id=$2`
		args = append(args, *cashierID)
	} else if terminal != "" {
		q += ` AND s.terminal=$2`
		args = append(args, terminal)
	}
	q += ` ORDER BY s.opened_at DESC LIMIT 1`
	s, err := scanShift(Q(ctx).QueryRow(ctx, q, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return s, err
}

func (ShiftRepo) AddCash(ctx context.Context, id uuid.UUID, sales, in, out decimal.Decimal) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE shifts SET cash_sales=cash_sales+$2, cash_in=cash_in+$3, cash_out=cash_out+$4 WHERE id=$1 AND status='open'`, id, sales, in, out)
	return err
}

func (ShiftRepo) Close(ctx context.Context, id, by uuid.UUID, expected, counted decimal.Decimal, note string) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE shifts SET status='closed', closed_at=now(), closed_by=$2, expected_cash=$3::numeric, counted_cash=$4::numeric, variance=($4::numeric - $3::numeric), note=COALESCE(NULLIF($5::text,''), note) WHERE id=$1 AND status='open'`,
		id, by, expected, counted, note)
	return err
}

func (ShiftRepo) List(ctx context.Context, storeID uuid.UUID, limit, offset int) ([]domain.Shift, int64, error) {
	var total int64
	if err := Q(ctx).QueryRow(ctx, `SELECT count(*) FROM shifts WHERE store_id=$1`, storeID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := Q(ctx).Query(ctx, `SELECT `+shiftCols+` FROM shifts s LEFT JOIN users u ON u.id=s.cashier_id WHERE s.store_id=$1 ORDER BY s.opened_at DESC LIMIT $2 OFFSET $3`, storeID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []domain.Shift{}
	for rows.Next() {
		s, err := scanShift(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *s)
	}
	return out, total, rows.Err()
}

// ---- cash drawer log ------------------------------------------------------------

type DrawerRepo struct{}

func (DrawerRepo) Log(ctx context.Context, storeID uuid.UUID, shiftID, userID *uuid.UUID, userName, reason string, amount decimal.Decimal, note string) error {
	_, err := Q(ctx).Exec(ctx, `INSERT INTO cash_drawer_logs (store_id, shift_id, user_id, user_name, reason, amount, note) VALUES ($1,$2,$3,$4,$5::drawer_reason,$6,NULLIF($7,''))`,
		storeID, shiftID, userID, userName, reason, amount, note)
	return err
}

type DrawerLog struct {
	ID         int64           `json:"id"`
	ShiftID    *uuid.UUID      `json:"shift_id,omitempty"`
	UserName   string          `json:"user_name"`
	Reason     string          `json:"reason"`
	Amount     decimal.Decimal `json:"amount"`
	Note       string          `json:"note,omitempty"`
	OccurredAt time.Time       `json:"occurred_at"`
}

func (DrawerRepo) List(ctx context.Context, storeID uuid.UUID, from, to time.Time, limit, offset int) ([]DrawerLog, int64, error) {
	var total int64
	if err := Q(ctx).QueryRow(ctx, `SELECT count(*) FROM cash_drawer_logs WHERE store_id=$1 AND occurred_at>=$2 AND occurred_at<$3`, storeID, from, to).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := Q(ctx).Query(ctx, `SELECT id, shift_id, COALESCE(user_name,''), reason::text, amount::text, COALESCE(note,''), occurred_at FROM cash_drawer_logs
		WHERE store_id=$1 AND occurred_at>=$2 AND occurred_at<$3 ORDER BY occurred_at DESC LIMIT $4 OFFSET $5`, storeID, from, to, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []DrawerLog{}
	for rows.Next() {
		var d DrawerLog
		var amt string
		if err := rows.Scan(&d.ID, &d.ShiftID, &d.UserName, &d.Reason, &amt, &d.Note, &d.OccurredAt); err != nil {
			return nil, 0, err
		}
		d.Amount = dec(amt)
		out = append(out, d)
	}
	return out, total, rows.Err()
}

// ---- held bills ----------------------------------------------------------------

type HeldRepo struct{}

func (HeldRepo) Create(ctx context.Context, storeID, cashierID uuid.UUID, label string, memberID *uuid.UUID, cart any) (*domain.HeldBill, error) {
	b, err := json.Marshal(cart)
	if err != nil {
		return nil, err
	}
	var h domain.HeldBill
	if err := Q(ctx).QueryRow(ctx, `INSERT INTO held_bills (store_id, cashier_id, label, member_id, cart) VALUES ($1,$2,NULLIF($3,''),$4,$5) RETURNING id, created_at, expires_at`,
		storeID, cashierID, label, memberID, b).Scan(&h.ID, &h.CreatedAt, &h.ExpiresAt); err != nil {
		return nil, err
	}
	h.CashierID, h.Label, h.MemberID, h.CartJSON = cashierID, label, memberID, cart
	return &h, nil
}

func (HeldRepo) List(ctx context.Context, storeID uuid.UUID) ([]domain.HeldBill, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT id, cashier_id, COALESCE(label,''), member_id, cart, created_at, expires_at FROM held_bills WHERE store_id=$1 AND expires_at>now() ORDER BY created_at DESC`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.HeldBill{}
	for rows.Next() {
		var h domain.HeldBill
		if err := rows.Scan(&h.ID, &h.CashierID, &h.Label, &h.MemberID, &h.Cart, &h.CreatedAt, &h.ExpiresAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(h.Cart, &h.CartJSON)
		out = append(out, h)
	}
	return out, rows.Err()
}

func (HeldRepo) Delete(ctx context.Context, storeID, id uuid.UUID) error {
	tag, err := Q(ctx).Exec(ctx, `DELETE FROM held_bills WHERE store_id=$1 AND id=$2`, storeID, id)
	if err == nil && tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return err
}
