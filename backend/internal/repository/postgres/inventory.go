package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
)

// ---------------------------------------------------------------------------
// Stock ledger
// ---------------------------------------------------------------------------

// StockMove is one row of the stock ledger, decorated with product name/sku for listing.
type StockMove struct {
	ID           int64            `json:"id"`
	ProductID    uuid.UUID        `json:"product_id"`
	SKU          string           `json:"sku"`
	ProductName  string           `json:"product_name"`
	MoveType     string           `json:"move_type"`
	QtyDelta     decimal.Decimal  `json:"qty_delta"`
	UnitCost     *decimal.Decimal `json:"unit_cost,omitempty"`
	BalanceAfter decimal.Decimal  `json:"balance_after"`
	RefType      string           `json:"ref_type,omitempty"`
	RefID        *uuid.UUID       `json:"ref_id,omitempty"`
	Note         string           `json:"note,omitempty"`
	CreatedBy    *uuid.UUID       `json:"created_by,omitempty"`
	OccurredAt   time.Time        `json:"occurred_at"`
}

// MovementFilter drives StockRepo.ListMovements.
type MovementFilter struct {
	ProductID *uuid.UUID
	From      *time.Time
	To        *time.Time
	Type      string
	Limit     int
	Offset    int
}

// StockSnapshot is the row-locked state of a product needed by stock postings.
type StockSnapshot struct {
	ProductID   uuid.UUID
	SKU         string
	Name        string
	StockOnHand decimal.Decimal
	CostLast    decimal.Decimal
	CostAvg     decimal.Decimal
	SellPrice   decimal.Decimal
	IsActive    bool
	IsArchived  bool
}

// StockRepo is the single writer of stock_on_hand; every change goes through Apply so the ledger stays complete.
type StockRepo struct{}

// Apply adds qtyDelta to the product's stock and records the movement. Returns the balance after the move.
// Must run inside WithTx. Other modules (sales, returns) call this too – keep the signature stable.
func (StockRepo) Apply(ctx context.Context, storeID, productID uuid.UUID, moveType string, qtyDelta decimal.Decimal, unitCost *decimal.Decimal,
	refType string, refID *uuid.UUID, note string, by *uuid.UUID) (decimal.Decimal, error) {
	var bal string
	err := Q(ctx).QueryRow(ctx, `UPDATE products SET stock_on_hand = stock_on_hand + $3::numeric WHERE store_id=$1 AND id=$2 RETURNING stock_on_hand::text`,
		storeID, productID, qtyDelta.String()).Scan(&bal)
	if errors.Is(err, pgx.ErrNoRows) {
		return decimal.Zero, domain.ErrProductNotFound
	}
	if err != nil {
		return decimal.Zero, err
	}
	balance := dec(bal)
	_, err = Q(ctx).Exec(ctx, `INSERT INTO stock_movements (store_id, product_id, move_type, qty_delta, unit_cost, balance_after, ref_type, ref_id, note, created_by)
		VALUES ($1,$2,$3::stock_move_type,$4::numeric,$5::numeric,$6::numeric,NULLIF($7,''),$8,NULLIF($9,''),$10)`,
		storeID, productID, moveType, qtyDelta.String(), nullDec(unitCost), balance.String(), refType, refID, note, by)
	if err != nil {
		return decimal.Zero, err
	}
	return balance, nil
}

// UpdateCostOnReceipt sets cost_last and recomputes the moving-average cost for a received quantity.
// It reads the CURRENT stock_on_hand as the "old" stock, so call it BEFORE Apply for the same receipt line.
// avg = (max(old_stock,0)*old_avg + qty*unit_cost) / (max(old_stock,0)+qty) when the denominator > 0, else unit_cost.
func (StockRepo) UpdateCostOnReceipt(ctx context.Context, productID uuid.UUID, qty, unitCost decimal.Decimal) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE products SET cost_last=$3::numeric,
		cost_avg = CASE WHEN GREATEST(stock_on_hand,0) + $2::numeric > 0
			THEN round((GREATEST(stock_on_hand,0)*cost_avg + $2::numeric*$3::numeric) / (GREATEST(stock_on_hand,0) + $2::numeric), 4)
			ELSE $3::numeric END
		WHERE id=$1`, productID, qty.String(), unitCost.String())
	return err
}

// SetCosts writes cost_last / cost_avg directly (used when the caller computed the average itself).
func (StockRepo) SetCosts(ctx context.Context, storeID, productID uuid.UUID, costLast, costAvg decimal.Decimal) error {
	tag, err := Q(ctx).Exec(ctx, `UPDATE products SET cost_last=$3::numeric, cost_avg=$4::numeric WHERE store_id=$1 AND id=$2`,
		storeID, productID, costLast.String(), costAvg.String())
	if err == nil && tag.RowsAffected() == 0 {
		return domain.ErrProductNotFound
	}
	return err
}

// Snapshot locks the product row (FOR UPDATE) and returns its stock/cost state.
func (StockRepo) Snapshot(ctx context.Context, storeID, productID uuid.UUID) (*StockSnapshot, error) {
	var s StockSnapshot
	var stock, cl, ca, sp string
	err := Q(ctx).QueryRow(ctx, `SELECT id, sku, name, stock_on_hand::text, cost_last::text, cost_avg::text, sell_price::text, is_active, is_archived
		FROM products WHERE store_id=$1 AND id=$2 FOR NO KEY UPDATE`, storeID, productID).
		Scan(&s.ProductID, &s.SKU, &s.Name, &stock, &cl, &ca, &sp, &s.IsActive, &s.IsArchived)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrProductNotFound
	}
	if err != nil {
		return nil, err
	}
	s.StockOnHand, s.CostLast, s.CostAvg, s.SellPrice = dec(stock), dec(cl), dec(ca), dec(sp)
	return &s, nil
}

func (StockRepo) ListMovements(ctx context.Context, storeID uuid.UUID, f MovementFilter) ([]StockMove, int64, error) {
	where := ` FROM stock_movements m JOIN products p ON p.id=m.product_id WHERE m.store_id=$1
		AND ($2::uuid IS NULL OR m.product_id=$2::uuid)
		AND ($3::timestamptz IS NULL OR m.occurred_at >= $3::timestamptz)
		AND ($4::timestamptz IS NULL OR m.occurred_at < $4::timestamptz)
		AND ($5='' OR m.move_type::text=$5)`
	args := []any{storeID, f.ProductID, f.From, f.To, f.Type}
	var total int64
	if err := Q(ctx).QueryRow(ctx, `SELECT count(*)`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := Q(ctx).Query(ctx, `SELECT m.id, m.product_id, p.sku, p.name, m.move_type::text, m.qty_delta::text, m.unit_cost::text, m.balance_after::text,
		COALESCE(m.ref_type,''), m.ref_id, COALESCE(m.note,''), m.created_by, m.occurred_at`+where+` ORDER BY m.occurred_at DESC, m.id DESC LIMIT $6 OFFSET $7`,
		append(args, f.Limit, f.Offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []StockMove{}
	for rows.Next() {
		var m StockMove
		var qty, bal string
		var cost *string
		if err := rows.Scan(&m.ID, &m.ProductID, &m.SKU, &m.ProductName, &m.MoveType, &qty, &cost, &bal, &m.RefType, &m.RefID, &m.Note, &m.CreatedBy, &m.OccurredAt); err != nil {
			return nil, 0, err
		}
		m.QtyDelta, m.BalanceAfter = dec(qty), dec(bal)
		m.UnitCost = decPtr(cost)
		out = append(out, m)
	}
	return out, total, rows.Err()
}

// Valuation sums positive stock across active, non-archived products.
func (StockRepo) Valuation(ctx context.Context, storeID uuid.UUID) (domain.Valuation, error) {
	var units, cost, retail string
	err := Q(ctx).QueryRow(ctx, `SELECT COALESCE(SUM(GREATEST(stock_on_hand,0)),0)::text,
		COALESCE(SUM(CASE WHEN stock_on_hand > 0 THEN stock_on_hand*cost_avg ELSE 0 END),0)::text,
		COALESCE(SUM(CASE WHEN stock_on_hand > 0 THEN stock_on_hand*sell_price ELSE 0 END),0)::text
		FROM products WHERE store_id=$1 AND is_active AND NOT is_archived`, storeID).Scan(&units, &cost, &retail)
	if err != nil {
		return domain.Valuation{}, err
	}
	return domain.Valuation{Units: dec(units), CostValue: dec(cost).Round(2), RetailValue: dec(retail).Round(2)}, nil
}

func nullDec(d *decimal.Decimal) any {
	if d == nil {
		return nil
	}
	return d.String()
}

func decPtr(s *string) *decimal.Decimal {
	if s == nil {
		return nil
	}
	d := dec(*s)
	return &d
}

// ---------------------------------------------------------------------------
// Purchase receipts
// ---------------------------------------------------------------------------

const receiptCols = `r.id, r.store_id, r.doc_no, r.supplier_id, COALESCE(s.name,''), COALESCE(r.supplier_ref,''), r.received_at, r.received_by, COALESCE(r.received_by_name,''),
	r.subtotal::text, r.vat::text, r.total::text, r.status::text, COALESCE(r.note,''), r.created_at, r.updated_at`

const receiptFrom = ` FROM purchase_receipts r LEFT JOIN suppliers s ON s.id=r.supplier_id `

func scanReceipt(row pgx.Row) (*domain.PurchaseReceipt, error) {
	var r domain.PurchaseReceipt
	var sub, vat, total string
	if err := row.Scan(&r.ID, &r.StoreID, &r.DocNo, &r.SupplierID, &r.SupplierName, &r.SupplierRef, &r.ReceivedAt, &r.ReceivedBy, &r.ReceivedByName,
		&sub, &vat, &total, &r.Status, &r.Note, &r.CreatedAt, &r.UpdatedAt); err != nil {
		return nil, err
	}
	r.Subtotal, r.VAT, r.Total = dec(sub), dec(vat), dec(total)
	return &r, nil
}

type ReceiptFilter struct {
	From       *time.Time
	To         *time.Time
	SupplierID *uuid.UUID
	Limit      int
	Offset     int
}

type ReceiptRepo struct{}

// Create inserts the receipt header and its lines (ids/timestamps are filled in).
func (ReceiptRepo) Create(ctx context.Context, r *domain.PurchaseReceipt) error {
	err := Q(ctx).QueryRow(ctx, `INSERT INTO purchase_receipts (store_id, doc_no, supplier_id, supplier_ref, received_at, received_by, received_by_name, subtotal, vat, total, status, note)
		VALUES ($1,$2,$3,NULLIF($4,''),$5,$6,NULLIF($7,''),$8::numeric,$9::numeric,$10::numeric,$11::receipt_status,NULLIF($12,'')) RETURNING id, created_at, updated_at`,
		r.StoreID, r.DocNo, r.SupplierID, r.SupplierRef, r.ReceivedAt, r.ReceivedBy, r.ReceivedByName, r.Subtotal.String(), r.VAT.String(), r.Total.String(), r.Status, r.Note).
		Scan(&r.ID, &r.CreatedAt, &r.UpdatedAt)
	if isFKViolation(err) {
		return domain.ErrValidation.With("field", "supplier_id")
	}
	if err != nil {
		return err
	}
	for i := range r.Lines {
		l := &r.Lines[i]
		l.ReceiptID = r.ID
		if err := Q(ctx).QueryRow(ctx, `INSERT INTO purchase_receipt_lines (store_id, receipt_id, line_no, product_id, sku, description, qty, unit_cost, total)
			VALUES ($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),$7::numeric,$8::numeric,$9::numeric) RETURNING id`,
			r.StoreID, r.ID, l.LineNo, l.ProductID, l.SKU, l.Description, l.Qty.String(), l.UnitCost.String(), l.Total.String()).Scan(&l.ID); err != nil {
			return err
		}
	}
	return nil
}

func (ReceiptRepo) Get(ctx context.Context, storeID, id uuid.UUID) (*domain.PurchaseReceipt, error) {
	r, err := scanReceipt(Q(ctx).QueryRow(ctx, `SELECT `+receiptCols+receiptFrom+` WHERE r.store_id=$1 AND r.id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrReceiptNotFound
	}
	if err != nil {
		return nil, err
	}
	rows, err := Q(ctx).Query(ctx, `SELECT l.id, l.receipt_id, l.line_no, l.product_id, COALESCE(l.sku, p.sku, ''), COALESCE(l.description, p.name, ''), l.qty::text, l.unit_cost::text, l.total::text
		FROM purchase_receipt_lines l LEFT JOIN products p ON p.id=l.product_id WHERE l.receipt_id=$1 ORDER BY l.line_no`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	r.Lines = []domain.ReceiptLine{}
	for rows.Next() {
		var l domain.ReceiptLine
		var qty, cost, total string
		if err := rows.Scan(&l.ID, &l.ReceiptID, &l.LineNo, &l.ProductID, &l.SKU, &l.Description, &qty, &cost, &total); err != nil {
			return nil, err
		}
		l.Qty, l.UnitCost, l.Total = dec(qty), dec(cost), dec(total)
		r.Lines = append(r.Lines, l)
	}
	return r, rows.Err()
}

func (ReceiptRepo) List(ctx context.Context, storeID uuid.UUID, f ReceiptFilter) ([]domain.PurchaseReceipt, int64, error) {
	where := receiptFrom + ` WHERE r.store_id=$1
		AND ($2::timestamptz IS NULL OR r.received_at >= $2::timestamptz)
		AND ($3::timestamptz IS NULL OR r.received_at < $3::timestamptz)
		AND ($4::uuid IS NULL OR r.supplier_id=$4::uuid)`
	args := []any{storeID, f.From, f.To, f.SupplierID}
	var total int64
	if err := Q(ctx).QueryRow(ctx, `SELECT count(*)`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := Q(ctx).Query(ctx, `SELECT `+receiptCols+where+` ORDER BY r.received_at DESC, r.doc_no DESC LIMIT $5 OFFSET $6`, append(args, f.Limit, f.Offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []domain.PurchaseReceipt{}
	for rows.Next() {
		r, err := scanReceipt(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *r)
	}
	return out, total, rows.Err()
}

func (ReceiptRepo) SetStatus(ctx context.Context, storeID, id uuid.UUID, status string) error {
	tag, err := Q(ctx).Exec(ctx, `UPDATE purchase_receipts SET status=$3::receipt_status WHERE store_id=$1 AND id=$2`, storeID, id, status)
	if err == nil && tag.RowsAffected() == 0 {
		return domain.ErrReceiptNotFound
	}
	return err
}

// ---------------------------------------------------------------------------
// Stock adjustments
// ---------------------------------------------------------------------------

type AdjustmentRepo struct{}

func (AdjustmentRepo) Create(ctx context.Context, a *domain.StockAdjustment) error {
	if err := Q(ctx).QueryRow(ctx, `INSERT INTO stock_adjustments (store_id, doc_no, reason, note, adjusted_at, created_by)
		VALUES ($1,$2,$3,NULLIF($4,''),$5,$6) RETURNING id`, a.StoreID, a.DocNo, a.Reason, a.Note, a.AdjustedAt, a.CreatedBy).Scan(&a.ID); err != nil {
		return err
	}
	for i := range a.Lines {
		l := &a.Lines[i]
		if err := Q(ctx).QueryRow(ctx, `INSERT INTO stock_adjustment_lines (adjustment_id, product_id, qty_delta, unit_cost, note)
			VALUES ($1,$2,$3::numeric,$4::numeric,NULLIF($5,'')) RETURNING id`, a.ID, l.ProductID, l.QtyDelta.String(), nullDec(l.UnitCost), l.Note).Scan(&l.ID); err != nil {
			return err
		}
	}
	return nil
}

func scanAdjustment(row pgx.Row) (*domain.StockAdjustment, error) {
	var a domain.StockAdjustment
	if err := row.Scan(&a.ID, &a.StoreID, &a.DocNo, &a.Reason, &a.Note, &a.AdjustedAt, &a.CreatedBy); err != nil {
		return nil, err
	}
	return &a, nil
}

const adjustmentCols = `id, store_id, doc_no, reason, COALESCE(note,''), adjusted_at, created_by`

func (AdjustmentRepo) Get(ctx context.Context, storeID, id uuid.UUID) (*domain.StockAdjustment, error) {
	a, err := scanAdjustment(Q(ctx).QueryRow(ctx, `SELECT `+adjustmentCols+` FROM stock_adjustments WHERE store_id=$1 AND id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	rows, err := Q(ctx).Query(ctx, `SELECT l.id, l.product_id, p.sku, p.name, l.qty_delta::text, l.unit_cost::text, COALESCE(l.note,'')
		FROM stock_adjustment_lines l JOIN products p ON p.id=l.product_id WHERE l.adjustment_id=$1 ORDER BY p.name`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	a.Lines = []domain.AdjustmentLine{}
	for rows.Next() {
		var l domain.AdjustmentLine
		var qty string
		var cost *string
		if err := rows.Scan(&l.ID, &l.ProductID, &l.SKU, &l.ProductName, &qty, &cost, &l.Note); err != nil {
			return nil, err
		}
		l.QtyDelta, l.UnitCost = dec(qty), decPtr(cost)
		a.Lines = append(a.Lines, l)
	}
	return a, rows.Err()
}

func (AdjustmentRepo) List(ctx context.Context, storeID uuid.UUID, limit, offset int) ([]domain.StockAdjustment, int64, error) {
	var total int64
	if err := Q(ctx).QueryRow(ctx, `SELECT count(*) FROM stock_adjustments WHERE store_id=$1`, storeID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := Q(ctx).Query(ctx, `SELECT `+adjustmentCols+` FROM stock_adjustments WHERE store_id=$1 ORDER BY adjusted_at DESC, doc_no DESC LIMIT $2 OFFSET $3`, storeID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []domain.StockAdjustment{}
	for rows.Next() {
		a, err := scanAdjustment(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *a)
	}
	return out, total, rows.Err()
}

// ---------------------------------------------------------------------------
// Stock takes
// ---------------------------------------------------------------------------

type StockTakeRepo struct{}

const stockTakeCols = `t.id, t.store_id, t.doc_no, t.status::text, COALESCE(t.note,''), t.started_at, t.finalized_at, t.created_by,
	(SELECT count(*) FROM stock_take_lines l WHERE l.stock_take_id=t.id)`

func scanStockTake(row pgx.Row) (*domain.StockTake, error) {
	var t domain.StockTake
	if err := row.Scan(&t.ID, &t.StoreID, &t.DocNo, &t.Status, &t.Note, &t.StartedAt, &t.FinalizedAt, &t.CreatedBy, &t.LineCount); err != nil {
		return nil, err
	}
	return &t, nil
}

// Create inserts the header and snapshots system_qty for productIDs (empty = every active, non-archived product).
// Create opens a sheet. With `empty` no lines are seeded (they arrive through UpsertCount); with
// no product ids every active product is snapshotted.
func (StockTakeRepo) Create(ctx context.Context, t *domain.StockTake, productIDs []uuid.UUID, empty bool) error {
	if err := Q(ctx).QueryRow(ctx, `INSERT INTO stock_takes (store_id, doc_no, status, note, started_at, created_by)
		VALUES ($1,$2,$3::stocktake_status,NULLIF($4,''),$5,$6) RETURNING id`, t.StoreID, t.DocNo, t.Status, t.Note, t.StartedAt, t.CreatedBy).Scan(&t.ID); err != nil {
		return err
	}
	var err error
	if empty {
		return Q(ctx).QueryRow(ctx, `SELECT count(*) FROM stock_take_lines WHERE stock_take_id=$1`, t.ID).Scan(&t.LineCount)
	}
	if len(productIDs) == 0 {
		_, err = Q(ctx).Exec(ctx, `INSERT INTO stock_take_lines (stock_take_id, product_id, system_qty)
			SELECT $1, id, stock_on_hand FROM products WHERE store_id=$2 AND is_active AND NOT is_archived`, t.ID, t.StoreID)
	} else {
		_, err = Q(ctx).Exec(ctx, `INSERT INTO stock_take_lines (stock_take_id, product_id, system_qty)
			SELECT $1, id, stock_on_hand FROM products WHERE store_id=$2 AND id = ANY($3)`, t.ID, t.StoreID, productIDs)
	}
	if err != nil {
		return err
	}
	return Q(ctx).QueryRow(ctx, `SELECT count(*) FROM stock_take_lines WHERE stock_take_id=$1`, t.ID).Scan(&t.LineCount)
}

// UpsertCount records a counted quantity; products not yet on the sheet are added with the current stock as system_qty.
func (StockTakeRepo) UpsertCount(ctx context.Context, storeID, takeID, productID uuid.UUID, counted decimal.Decimal, note string) error {
	tag, err := Q(ctx).Exec(ctx, `INSERT INTO stock_take_lines (stock_take_id, product_id, system_qty, counted_qty, note)
		SELECT $1, id, stock_on_hand, $3::numeric, NULLIF($4,'') FROM products WHERE store_id=$5 AND id=$2
		ON CONFLICT (stock_take_id, product_id) DO UPDATE SET counted_qty=EXCLUDED.counted_qty, note=COALESCE(EXCLUDED.note, stock_take_lines.note)`,
		takeID, productID, counted.String(), note, storeID)
	if err == nil && tag.RowsAffected() == 0 {
		return domain.ErrProductNotFound
	}
	return err
}

func (StockTakeRepo) Get(ctx context.Context, storeID, id uuid.UUID) (*domain.StockTake, error) {
	t, err := scanStockTake(Q(ctx).QueryRow(ctx, `SELECT `+stockTakeCols+` FROM stock_takes t WHERE t.store_id=$1 AND t.id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	rows, err := Q(ctx).Query(ctx, `SELECT l.id, l.product_id, p.sku, p.name, p.cost_avg::text, l.system_qty::text, l.counted_qty::text, COALESCE(l.note,'')
		FROM stock_take_lines l JOIN products p ON p.id=l.product_id WHERE l.stock_take_id=$1 ORDER BY p.name, p.sku`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	t.Lines = []domain.StockTakeLine{}
	for rows.Next() {
		var l domain.StockTakeLine
		var costAvg, sys string
		var counted *string
		if err := rows.Scan(&l.ID, &l.ProductID, &l.SKU, &l.ProductName, &costAvg, &sys, &counted, &l.Note); err != nil {
			return nil, err
		}
		l.CostAvg, l.SystemQty, l.CountedQty = dec(costAvg), dec(sys), decPtr(counted)
		t.Lines = append(t.Lines, l)
	}
	return t, rows.Err()
}

func (StockTakeRepo) List(ctx context.Context, storeID uuid.UUID, limit, offset int) ([]domain.StockTake, int64, error) {
	var total int64
	if err := Q(ctx).QueryRow(ctx, `SELECT count(*) FROM stock_takes WHERE store_id=$1`, storeID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := Q(ctx).Query(ctx, `SELECT `+stockTakeCols+` FROM stock_takes t WHERE t.store_id=$1 ORDER BY t.started_at DESC LIMIT $2 OFFSET $3`, storeID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []domain.StockTake{}
	for rows.Next() {
		t, err := scanStockTake(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *t)
	}
	return out, total, rows.Err()
}

func (StockTakeRepo) SetStatus(ctx context.Context, storeID, id uuid.UUID, status string, finalizedAt *time.Time) error {
	tag, err := Q(ctx).Exec(ctx, `UPDATE stock_takes SET status=$3::stocktake_status, finalized_at=COALESCE($4, finalized_at) WHERE store_id=$1 AND id=$2`,
		storeID, id, status, finalizedAt)
	if err == nil && tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return err
}
