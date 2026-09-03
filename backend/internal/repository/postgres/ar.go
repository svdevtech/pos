package postgres

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
)

type ARRepo struct{}

const arCols = `p.id, COALESCE(p.doc_no,''), p.member_id, COALESCE(m.member_code,''), COALESCE(m.name,''), p.sale_id, COALESCE(s.doc_no,''), COALESCE(p.legacy_bill_no,''),
	p.bill_total::text, p.balance_before::text, p.amount::text, p.balance_after::text, p.method::text, p.paid_at, p.received_by, COALESCE(p.received_by_name,''), COALESCE(p.note,'')`

func scanAR(row pgx.Row) (*domain.ARPayment, error) {
	var p domain.ARPayment
	var bt, bb, amt, ba, m string
	if err := row.Scan(&p.ID, &p.DocNo, &p.MemberID, &p.MemberCode, &p.MemberName, &p.SaleID, &p.SaleDocNo, &p.LegacyBillNo, &bt, &bb, &amt, &ba, &m, &p.PaidAt, &p.ReceivedBy, &p.ReceivedByName, &p.Note); err != nil {
		return nil, err
	}
	p.BillTotal, p.BalanceBefore, p.Amount, p.BalanceAfter, p.Method = dec(bt), dec(bb), dec(amt), dec(ba), domain.PaymentMethod(m)
	return &p, nil
}

func (ARRepo) Insert(ctx context.Context, storeID uuid.UUID, p *domain.ARPayment) error {
	return Q(ctx).QueryRow(ctx, `INSERT INTO ar_payments (store_id, doc_no, member_id, sale_id, legacy_bill_no, bill_total, balance_before, amount, balance_after, method, paid_at, received_by, received_by_name, note)
		VALUES ($1,NULLIF($2,''),$3,$4,NULLIF($5,''),$6,$7,$8,$9,$10::payment_method,$11,$12,NULLIF($13,''),NULLIF($14,'')) RETURNING id`,
		storeID, p.DocNo, p.MemberID, p.SaleID, p.LegacyBillNo, p.BillTotal, p.BalanceBefore, p.Amount, p.BalanceAfter, string(p.Method), p.PaidAt, p.ReceivedBy, p.ReceivedByName, p.Note).Scan(&p.ID)
}

type ARFilter struct {
	MemberID *uuid.UUID
	SaleID   *uuid.UUID
	From, To *time.Time
	Limit    int
	Offset   int
}

func (ARRepo) List(ctx context.Context, storeID uuid.UUID, f ARFilter) ([]domain.ARPayment, int64, error) {
	where := []string{"p.store_id=$1"}
	args := []any{storeID}
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, fmt.Sprintf(cond, len(args)))
	}
	if f.MemberID != nil {
		add("p.member_id=$%d", *f.MemberID)
	}
	if f.SaleID != nil {
		add("p.sale_id=$%d", *f.SaleID)
	}
	if f.From != nil {
		add("p.paid_at>=$%d", *f.From)
	}
	if f.To != nil {
		add("p.paid_at<$%d", *f.To)
	}
	w := strings.Join(where, " AND ")
	var total int64
	if err := Q(ctx).QueryRow(ctx, `SELECT count(*) FROM ar_payments p WHERE `+w, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, f.Limit, f.Offset)
	rows, err := Q(ctx).Query(ctx, `SELECT `+arCols+` FROM ar_payments p LEFT JOIN members m ON m.id=p.member_id LEFT JOIN sales s ON s.id=p.sale_id WHERE `+w+
		fmt.Sprintf(` ORDER BY p.paid_at DESC, p.id DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []domain.ARPayment{}
	for rows.Next() {
		p, err := scanAR(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *p)
	}
	return out, total, rows.Err()
}

// ARAccount summarises a member's receivable.
type ARAccount struct {
	MemberID   uuid.UUID       `json:"member_id"`
	MemberCode string          `json:"member_code"`
	MemberName string          `json:"member_name"`
	Phone      string          `json:"phone,omitempty"`
	OpenBills  int             `json:"open_bills"`
	Balance    decimal.Decimal `json:"balance"`
	OldestDue  *time.Time      `json:"oldest_due,omitempty"`
	LastPaidAt *time.Time      `json:"last_paid_at,omitempty"`
}

func (ARRepo) Accounts(ctx context.Context, storeID uuid.UUID, q string, limit, offset int) ([]ARAccount, int64, error) {
	base := `FROM members m JOIN sales s ON s.member_id=m.id AND s.status='completed' AND s.ar_status IN ('unpaid','partial')
		WHERE m.store_id=$1 AND ($2='' OR m.member_code ILIKE $2||'%' OR m.name ILIKE '%'||$2||'%')`
	var total int64
	if err := Q(ctx).QueryRow(ctx, `SELECT count(DISTINCT m.id) `+base, storeID, q).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := Q(ctx).Query(ctx, `SELECT m.id, m.member_code, m.name, COALESCE(m.phone,''), count(s.id), sum(s.ar_balance)::text, min(s.sold_at),
		(SELECT max(paid_at) FROM ar_payments p WHERE p.member_id=m.id) `+base+` GROUP BY m.id ORDER BY sum(s.ar_balance) DESC LIMIT $3 OFFSET $4`, storeID, q, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []ARAccount{}
	for rows.Next() {
		var a ARAccount
		var bal string
		if err := rows.Scan(&a.MemberID, &a.MemberCode, &a.MemberName, &a.Phone, &a.OpenBills, &bal, &a.OldestDue, &a.LastPaidAt); err != nil {
			return nil, 0, err
		}
		a.Balance = dec(bal)
		out = append(out, a)
	}
	return out, total, rows.Err()
}

// AgingBucket groups outstanding balances by age.
type AgingBucket struct {
	Bucket  string          `json:"bucket"` // 0-30, 31-60, 61-90, 90+
	Bills   int64           `json:"bills"`
	Balance decimal.Decimal `json:"balance"`
}

func (ARRepo) Aging(ctx context.Context, storeID uuid.UUID, asOf time.Time) ([]AgingBucket, decimal.Decimal, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT CASE WHEN age<=30 THEN '0-30' WHEN age<=60 THEN '31-60' WHEN age<=90 THEN '61-90' ELSE '90+' END AS bucket, count(*), sum(bal)::text
		FROM (SELECT ($2::timestamptz::date - sold_at::date) AS age, ar_balance AS bal FROM sales WHERE store_id=$1 AND status='completed' AND ar_status IN ('unpaid','partial')) x
		GROUP BY 1 ORDER BY 1`, storeID, asOf)
	if err != nil {
		return nil, decimal.Zero, err
	}
	defer rows.Close()
	out := []AgingBucket{}
	total := decimal.Zero
	for rows.Next() {
		var b AgingBucket
		var bal string
		if err := rows.Scan(&b.Bucket, &b.Bills, &bal); err != nil {
			return nil, decimal.Zero, err
		}
		b.Balance = dec(bal)
		total = total.Add(b.Balance)
		out = append(out, b)
	}
	return out, total, rows.Err()
}
