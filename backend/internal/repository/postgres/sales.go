package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
)

type SaleRepo struct{}

const saleCols = `s.id, s.store_id, s.doc_no, s.legacy_dup_seq, s.sold_at, s.cashier_id, COALESCE(s.cashier_name,''), s.member_id,
	COALESCE(m.member_code,''), COALESCE(m.name,''), s.shift_id, s.gross::text, s.discount::text, s.bill_discount::text, s.vat::text, s.net::text,
	s.tendered::text, s.change_amount::text, s.status::text, s.cancelled_by, COALESCE(s.cancelled_by_name,''), s.cancelled_at, COALESCE(s.cancel_reason,''),
	s.ar_status::text, s.ar_total::text, s.ar_paid::text, s.ar_balance::text, COALESCE(s.note,''), s.legacy_tender, COALESCE(s.legacy_id,''), s.created_at`

const saleFrom = ` FROM sales s LEFT JOIN members m ON m.id = s.member_id `

func scanSale(row pgx.Row) (*domain.Sale, error) {
	var s domain.Sale
	var gross, disc, bdisc, vat, net, tend, chg, status, arStatus, arTotal, arPaid, arBal string
	if err := row.Scan(&s.ID, &s.StoreID, &s.DocNo, &s.LegacyDupSeq, &s.SoldAt, &s.CashierID, &s.CashierName, &s.MemberID,
		&s.MemberCode, &s.MemberName, &s.ShiftID, &gross, &disc, &bdisc, &vat, &net, &tend, &chg, &status, &s.CancelledBy, &s.CancelledByName,
		&s.CancelledAt, &s.CancelReason, &arStatus, &arTotal, &arPaid, &arBal, &s.Note, &s.LegacyTender, &s.LegacyID, &s.CreatedAt); err != nil {
		return nil, err
	}
	s.Gross, s.Discount, s.BillDiscount, s.VAT, s.Net = dec(gross), dec(disc), dec(bdisc), dec(vat), dec(net)
	s.Tendered, s.Change = dec(tend), dec(chg)
	s.Status, s.ARStatus = domain.SaleStatus(status), domain.ARStatus(arStatus)
	s.ARTotal, s.ARPaid, s.ARBalance = dec(arTotal), dec(arPaid), dec(arBal)
	return &s, nil
}

func (SaleRepo) Insert(ctx context.Context, s *domain.Sale) error {
	return Q(ctx).QueryRow(ctx, `INSERT INTO sales (store_id, doc_no, legacy_dup_seq, sold_at, cashier_id, cashier_name, member_id, shift_id, gross, discount, bill_discount, vat, net,
		tendered, change_amount, status, ar_status, ar_total, ar_paid, ar_balance, note, legacy_tender, legacy_id)
		VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::sale_status,$17::ar_status,$18,$19,$20,NULLIF($21,''),$22,NULLIF($23,''))
		RETURNING id, created_at`,
		s.StoreID, s.DocNo, s.LegacyDupSeq, s.SoldAt, s.CashierID, s.CashierName, s.MemberID, s.ShiftID, s.Gross, s.Discount, s.BillDiscount, s.VAT, s.Net,
		s.Tendered, s.Change, string(s.Status), string(s.ARStatus), s.ARTotal, s.ARPaid, s.ARBalance, s.Note, s.LegacyTender, s.LegacyID).Scan(&s.ID, &s.CreatedAt)
}

func (SaleRepo) InsertLine(ctx context.Context, storeID uuid.UUID, l *domain.SaleLine) error {
	return Q(ctx).QueryRow(ctx, `INSERT INTO sale_lines (store_id, sale_id, line_no, product_id, sku, description, qty, unit_price, discount, line_total, cost_last, cost_avg, is_free, serial_no, promotion_id)
		VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8,$9,$10,$11,$12,$13,NULLIF($14,''),$15) RETURNING id`,
		storeID, l.SaleID, l.LineNo, l.ProductID, l.SKU, l.Description, l.Qty, l.UnitPrice, l.Discount, l.LineTotal, l.CostLast, l.CostAvg, l.IsFree, l.SerialNo, l.PromotionID).Scan(&l.ID)
}

func (SaleRepo) InsertPayment(ctx context.Context, storeID uuid.UUID, p *domain.SalePayment) error {
	return Q(ctx).QueryRow(ctx, `INSERT INTO sale_payments (store_id, sale_id, method, amount, reference) VALUES ($1,$2,$3::payment_method,$4,NULLIF($5,'')) RETURNING id`,
		storeID, p.SaleID, string(p.Method), p.Amount, p.Reference).Scan(&p.ID)
}

func (r SaleRepo) Get(ctx context.Context, storeID, id uuid.UUID) (*domain.Sale, error) {
	s, err := scanSale(Q(ctx).QueryRow(ctx, `SELECT `+saleCols+saleFrom+`WHERE s.store_id=$1 AND s.id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrSaleNotFound
	}
	if err != nil {
		return nil, err
	}
	if s.Lines, err = r.Lines(ctx, id); err != nil {
		return nil, err
	}
	if s.Payments, err = r.Payments(ctx, id); err != nil {
		return nil, err
	}
	return s, nil
}

func (r SaleRepo) GetByDocNo(ctx context.Context, storeID uuid.UUID, docNo string) (*domain.Sale, error) {
	var id uuid.UUID
	err := Q(ctx).QueryRow(ctx, `SELECT id FROM sales WHERE store_id=$1 AND doc_no=$2 ORDER BY legacy_dup_seq LIMIT 1`, storeID, docNo).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrSaleNotFound
	}
	if err != nil {
		return nil, err
	}
	return r.Get(ctx, storeID, id)
}

// GetForUpdate locks the sale header row.
func (SaleRepo) GetForUpdate(ctx context.Context, storeID, id uuid.UUID) (*domain.Sale, error) {
	s, err := scanSale(Q(ctx).QueryRow(ctx, `SELECT `+saleCols+saleFrom+`WHERE s.store_id=$1 AND s.id=$2 FOR UPDATE OF s`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrSaleNotFound
	}
	return s, err
}

func (SaleRepo) Lines(ctx context.Context, saleID uuid.UUID) ([]domain.SaleLine, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT l.id, l.sale_id, l.line_no, l.product_id, COALESCE(l.sku,''), l.description, l.qty::text, l.unit_price::text, l.discount::text,
		l.line_total::text, l.cost_last::text, l.cost_avg::text, l.is_free, COALESCE(l.serial_no,''), l.promotion_id, COALESCE(u.name,''),
		COALESCE((SELECT sum(rl.qty) FROM sale_return_lines rl WHERE rl.sale_line_id = l.id), 0)::text
		FROM sale_lines l LEFT JOIN products p ON p.id = l.product_id LEFT JOIN units u ON u.id = p.unit_id
		WHERE l.sale_id=$1 ORDER BY l.line_no`, saleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.SaleLine{}
	for rows.Next() {
		var l domain.SaleLine
		var qty, price, disc, total, cl, ca, ret string
		if err := rows.Scan(&l.ID, &l.SaleID, &l.LineNo, &l.ProductID, &l.SKU, &l.Description, &qty, &price, &disc, &total, &cl, &ca, &l.IsFree, &l.SerialNo, &l.PromotionID, &l.UnitName, &ret); err != nil {
			return nil, err
		}
		l.Qty, l.UnitPrice, l.Discount, l.LineTotal, l.CostLast, l.CostAvg, l.ReturnedQty = dec(qty), dec(price), dec(disc), dec(total), dec(cl), dec(ca), dec(ret)
		out = append(out, l)
	}
	return out, rows.Err()
}

func (SaleRepo) Payments(ctx context.Context, saleID uuid.UUID) ([]domain.SalePayment, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT id, sale_id, method::text, amount::text, COALESCE(reference,'') FROM sale_payments WHERE sale_id=$1 ORDER BY created_at, id`, saleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.SalePayment{}
	for rows.Next() {
		var p domain.SalePayment
		var m, amt string
		if err := rows.Scan(&p.ID, &p.SaleID, &m, &amt, &p.Reference); err != nil {
			return nil, err
		}
		p.Method, p.Amount = domain.PaymentMethod(m), dec(amt)
		out = append(out, p)
	}
	return out, rows.Err()
}

type SaleFilter struct {
	From, To  *time.Time
	MemberID  *uuid.UUID
	CashierID *uuid.UUID
	ShiftID   *uuid.UUID
	Status    string
	ARStatus  string
	DocNo     string
	Limit     int
	Offset    int
}

func (SaleRepo) List(ctx context.Context, storeID uuid.UUID, f SaleFilter) ([]domain.Sale, int64, error) {
	where := []string{"s.store_id=$1"}
	args := []any{storeID}
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, fmt.Sprintf(cond, len(args)))
	}
	if f.From != nil {
		add("s.sold_at >= $%d", *f.From)
	}
	if f.To != nil {
		add("s.sold_at < $%d", *f.To)
	}
	if f.MemberID != nil {
		add("s.member_id = $%d", *f.MemberID)
	}
	if f.CashierID != nil {
		add("s.cashier_id = $%d", *f.CashierID)
	}
	if f.ShiftID != nil {
		add("s.shift_id = $%d", *f.ShiftID)
	}
	if f.Status != "" {
		add("s.status = $%d::sale_status", f.Status)
	}
	if f.ARStatus != "" {
		add("s.ar_status = $%d::ar_status", f.ARStatus)
	}
	if f.DocNo != "" {
		add("s.doc_no ILIKE $%d", "%"+f.DocNo+"%")
	}
	w := strings.Join(where, " AND ")
	var total int64
	if err := Q(ctx).QueryRow(ctx, `SELECT count(*) FROM sales s WHERE `+w, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, f.Limit, f.Offset)
	rows, err := Q(ctx).Query(ctx, `SELECT `+saleCols+saleFrom+`WHERE `+w+fmt.Sprintf(` ORDER BY s.sold_at DESC, s.doc_no DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []domain.Sale{}
	for rows.Next() {
		s, err := scanSale(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *s)
	}
	return out, total, rows.Err()
}

func (SaleRepo) MarkCancelled(ctx context.Context, id uuid.UUID, by *uuid.UUID, byName, reason string) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE sales SET status='cancelled', cancelled_by=$2, cancelled_by_name=$3, cancelled_at=now(), cancel_reason=NULLIF($4,''),
		ar_status = CASE WHEN ar_status='none' THEN ar_status ELSE 'none' END, ar_balance=0 WHERE id=$1`, id, by, byName, reason)
	return err
}

func (SaleRepo) SetStatus(ctx context.Context, id uuid.UUID, status domain.SaleStatus) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE sales SET status=$2::sale_status WHERE id=$1`, id, string(status))
	return err
}

// UpdateAR applies a payment to the sale's receivable columns.
func (SaleRepo) UpdateAR(ctx context.Context, id uuid.UUID, paid, balance decimal.Decimal, status domain.ARStatus) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE sales SET ar_paid=$2, ar_balance=$3, ar_status=$4::ar_status WHERE id=$1`, id, paid, balance, string(status))
	return err
}

// OutstandingByMember returns unpaid/partial credit sales for a member, oldest first, with row locks.
func (SaleRepo) OutstandingByMember(ctx context.Context, storeID, memberID uuid.UUID, lock bool) ([]domain.Sale, error) {
	q := `SELECT ` + saleCols + saleFrom + `WHERE s.store_id=$1 AND s.member_id=$2 AND s.ar_status IN ('unpaid','partial') AND s.status='completed' ORDER BY s.sold_at, s.doc_no`
	if lock {
		q += ` FOR UPDATE OF s`
	}
	rows, err := Q(ctx).Query(ctx, q, storeID, memberID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Sale{}
	for rows.Next() {
		s, err := scanSale(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// DailySummary is used by the POS dashboard and shift close.
type DailySummary struct {
	Bills     int64                      `json:"bills"`
	Gross     decimal.Decimal            `json:"gross"`
	Discount  decimal.Decimal            `json:"discount"`
	Net       decimal.Decimal            `json:"net"`
	Cancelled int64                      `json:"cancelled"`
	ByMethod  map[string]decimal.Decimal `json:"by_method"`
}

func (SaleRepo) Summary(ctx context.Context, storeID uuid.UUID, from, to time.Time, shiftID *uuid.UUID) (*DailySummary, error) {
	out := &DailySummary{ByMethod: map[string]decimal.Decimal{}}
	var gross, disc, net string
	shiftCond := ""
	args := []any{storeID, from, to}
	if shiftID != nil {
		shiftCond = " AND s.shift_id=$4"
		args = append(args, *shiftID)
	}
	if err := Q(ctx).QueryRow(ctx, `SELECT count(*) FILTER (WHERE s.status='completed'), COALESCE(sum(s.gross) FILTER (WHERE s.status='completed'),0)::text,
		COALESCE(sum(s.discount) FILTER (WHERE s.status='completed'),0)::text, COALESCE(sum(s.net) FILTER (WHERE s.status='completed'),0)::text,
		count(*) FILTER (WHERE s.status='cancelled')
		FROM sales s WHERE s.store_id=$1 AND s.sold_at>=$2 AND s.sold_at<$3`+shiftCond, args...).Scan(&out.Bills, &gross, &disc, &net, &out.Cancelled); err != nil {
		return nil, err
	}
	out.Gross, out.Discount, out.Net = dec(gross), dec(disc), dec(net)
	rows, err := Q(ctx).Query(ctx, `SELECT p.method::text, COALESCE(sum(p.amount),0)::text FROM sale_payments p JOIN sales s ON s.id=p.sale_id
		WHERE s.store_id=$1 AND s.sold_at>=$2 AND s.sold_at<$3 AND s.status='completed'`+shiftCond+` GROUP BY p.method`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m, amt string
		if err := rows.Scan(&m, &amt); err != nil {
			return nil, err
		}
		out.ByMethod[m] = dec(amt)
	}
	return out, rows.Err()
}

// ---- returns -----------------------------------------------------------------

func (SaleRepo) InsertReturn(ctx context.Context, storeID uuid.UUID, r *domain.SaleReturn) error {
	return Q(ctx).QueryRow(ctx, `INSERT INTO sale_returns (store_id, doc_no, sale_id, returned_at, processed_by, refund_method, refund_amount, restock, reason)
		VALUES ($1,$2,$3,$4,$5,$6::payment_method,$7,$8,NULLIF($9,'')) RETURNING id`,
		storeID, r.DocNo, r.SaleID, r.ReturnedAt, r.ProcessedBy, string(r.RefundMethod), r.RefundAmount, r.Restock, r.Reason).Scan(&r.ID)
}

func (SaleRepo) InsertReturnLine(ctx context.Context, returnID uuid.UUID, l *domain.SaleReturnLine) error {
	return Q(ctx).QueryRow(ctx, `INSERT INTO sale_return_lines (return_id, sale_line_id, product_id, qty, unit_price, amount) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		returnID, l.SaleLineID, l.ProductID, l.Qty, l.UnitPrice, l.Amount).Scan(&l.ID)
}

func (SaleRepo) ListReturns(ctx context.Context, storeID uuid.UUID, saleID *uuid.UUID, limit, offset int) ([]domain.SaleReturn, int64, error) {
	cond := "r.store_id=$1"
	args := []any{storeID}
	if saleID != nil {
		cond += " AND r.sale_id=$2"
		args = append(args, *saleID)
	}
	var total int64
	if err := Q(ctx).QueryRow(ctx, `SELECT count(*) FROM sale_returns r WHERE `+cond, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, limit, offset)
	rows, err := Q(ctx).Query(ctx, `SELECT r.id, r.doc_no, r.sale_id, s.doc_no, r.returned_at, r.processed_by, r.refund_method::text, r.refund_amount::text, r.restock, COALESCE(r.reason,'')
		FROM sale_returns r JOIN sales s ON s.id=r.sale_id WHERE `+cond+fmt.Sprintf(` ORDER BY r.returned_at DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []domain.SaleReturn{}
	for rows.Next() {
		var x domain.SaleReturn
		var m, amt string
		if err := rows.Scan(&x.ID, &x.DocNo, &x.SaleID, &x.SaleDocNo, &x.ReturnedAt, &x.ProcessedBy, &m, &amt, &x.Restock, &x.Reason); err != nil {
			return nil, 0, err
		}
		x.RefundMethod, x.RefundAmount = domain.PaymentMethod(m), dec(amt)
		out = append(out, x)
	}
	return out, total, rows.Err()
}

// ---- product snapshot needed by the POS -----------------------------------------

type ProductSnapshot struct {
	ID         uuid.UUID
	SKU        string
	Name       string
	SellPrice  decimal.Decimal
	CostLast   decimal.Decimal
	CostAvg    decimal.Decimal
	Stock      decimal.Decimal
	IsSerial   bool
	IsActive   bool
	IsArchived bool
	PriceTiers map[int]decimal.Decimal
}

func (SaleRepo) ProductForSale(ctx context.Context, storeID, productID uuid.UUID) (*ProductSnapshot, error) {
	var p ProductSnapshot
	var price, cl, ca, stock string
	err := Q(ctx).QueryRow(ctx, `SELECT id, sku, name, sell_price::text, cost_last::text, cost_avg::text, stock_on_hand::text, is_serial, is_active, is_archived
		FROM products WHERE store_id=$1 AND id=$2 FOR NO KEY UPDATE`, storeID, productID).Scan(&p.ID, &p.SKU, &p.Name, &price, &cl, &ca, &stock, &p.IsSerial, &p.IsActive, &p.IsArchived)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrProductNotFound
	}
	if err != nil {
		return nil, err
	}
	p.SellPrice, p.CostLast, p.CostAvg, p.Stock = dec(price), dec(cl), dec(ca), dec(stock)
	p.PriceTiers = map[int]decimal.Decimal{}
	rows, err := Q(ctx).Query(ctx, `SELECT tier, price::text FROM price_tiers WHERE product_id=$1`, productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var tier int
		var pr string
		if err := rows.Scan(&tier, &pr); err != nil {
			return nil, err
		}
		p.PriceTiers[tier] = dec(pr)
	}
	return &p, rows.Err()
}

// MemberSnapshot is the member info the POS needs.
type MemberSnapshot struct {
	ID        uuid.UUID
	Code      string
	Name      string
	PriceTier int
	IsWalkin  bool
	Status    string
}

func (SaleRepo) MemberForSale(ctx context.Context, storeID, memberID uuid.UUID) (*MemberSnapshot, error) {
	var m MemberSnapshot
	err := Q(ctx).QueryRow(ctx, `SELECT id, member_code, name, price_tier, is_walkin, status::text FROM members WHERE store_id=$1 AND id=$2`, storeID, memberID).
		Scan(&m.ID, &m.Code, &m.Name, &m.PriceTier, &m.IsWalkin, &m.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrMemberNotFound
	}
	return &m, err
}
