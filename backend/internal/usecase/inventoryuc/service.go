package inventoryuc

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

// Actor identifies who performs an action (for audit and created_by).
type Actor struct {
	UserID uuid.UUID
	Name   string
	IP     string
}

func (a Actor) userPtr() *uuid.UUID {
	if a.UserID == uuid.Nil {
		return nil
	}
	id := a.UserID
	return &id
}

type Service struct {
	db          *postgres.DB
	stock       postgres.StockRepo
	receipts    postgres.ReceiptRepo
	adjustments postgres.AdjustmentRepo
	takes       postgres.StockTakeRepo
	audit       postgres.AuditRepo
}

func New(db *postgres.DB) *Service { return &Service{db: db} }

func (s *Service) tx(ctx context.Context, storeID uuid.UUID, fn func(ctx context.Context) error) error {
	return s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error { return fn(ctx) })
}

func (s *Service) auditWrite(ctx context.Context, actor Actor, storeID uuid.UUID, action, entity string, entityID uuid.UUID, before, after any) error {
	return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: actor.userPtr(), ActorName: actor.Name, Action: action, Entity: entity,
		EntityID: entityID.String(), Before: before, After: after, IP: actor.IP})
}

// ---- movements / valuation -----------------------------------------------------

func (s *Service) ListMovements(ctx context.Context, storeID uuid.UUID, f postgres.MovementFilter) ([]postgres.StockMove, int64, error) {
	var out []postgres.StockMove
	var total int64
	err := s.tx(ctx, storeID, func(ctx context.Context) (err error) {
		out, total, err = s.stock.ListMovements(ctx, storeID, f)
		return
	})
	return out, total, err
}

func (s *Service) Valuation(ctx context.Context, storeID uuid.UUID) (domain.Valuation, error) {
	var out domain.Valuation
	err := s.tx(ctx, storeID, func(ctx context.Context) (err error) {
		out, err = s.stock.Valuation(ctx, storeID)
		return
	})
	return out, err
}

// ---- receipts -----------------------------------------------------------------------

type ReceiptLineInput struct {
	ProductID uuid.UUID       `json:"product_id"`
	Qty       decimal.Decimal `json:"qty"`
	UnitCost  decimal.Decimal `json:"unit_cost"`
}

type ReceiptInput struct {
	SupplierID  *uuid.UUID         `json:"supplier_id"`
	SupplierRef string             `json:"supplier_ref"`
	ReceivedAt  *time.Time         `json:"received_at"`
	VAT         *decimal.Decimal   `json:"vat"`
	Note        string             `json:"note"`
	Lines       []ReceiptLineInput `json:"lines"`
}

// PostReceipt records a goods receipt: doc_no OD…, one `receipt` movement per line and moving-average cost update.
func (s *Service) PostReceipt(ctx context.Context, actor Actor, storeID uuid.UUID, in ReceiptInput) (*domain.PurchaseReceipt, error) {
	if len(in.Lines) == 0 {
		return nil, domain.ErrValidation.With("field", "lines")
	}
	vat := decimal.Zero
	if in.VAT != nil {
		if in.VAT.IsNegative() {
			return nil, domain.ErrValidation.With("field", "vat")
		}
		vat = in.VAT.Round(2)
	}
	at := time.Now()
	if in.ReceivedAt != nil && !in.ReceivedAt.IsZero() {
		at = *in.ReceivedAt
	}
	lines := make([]domain.ReceiptLine, 0, len(in.Lines))
	for i, l := range in.Lines {
		if l.ProductID == uuid.Nil || l.Qty.Sign() <= 0 || l.UnitCost.IsNegative() {
			return nil, domain.ErrValidation.With("field", "lines")
		}
		pid := l.ProductID
		qty, cost := l.Qty.Round(3), l.UnitCost.Round(4)
		lines = append(lines, domain.ReceiptLine{LineNo: i + 1, ProductID: &pid, Qty: qty, UnitCost: cost, Total: qty.Mul(cost).Round(2)})
	}
	subtotal, total := ReceiptTotals(lines, vat)
	if in.SupplierID != nil && *in.SupplierID == uuid.Nil {
		in.SupplierID = nil
	}
	rc := &domain.PurchaseReceipt{StoreID: storeID, SupplierID: in.SupplierID, SupplierRef: strings.TrimSpace(in.SupplierRef), ReceivedAt: at,
		ReceivedBy: actor.userPtr(), ReceivedByName: actor.Name, Subtotal: subtotal, VAT: vat, Total: total, Status: domain.ReceiptPosted,
		Note: strings.TrimSpace(in.Note), Lines: lines}
	var out *domain.PurchaseReceipt
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		docNo, err := postgres.NextDocNo(ctx, storeID, postgres.DocReceipt, at)
		if err != nil {
			return err
		}
		rc.DocNo = docNo
		// Fill sku/description from the locked product rows and validate before writing anything.
		snaps := make([]*postgres.StockSnapshot, len(rc.Lines))
		for i := range rc.Lines {
			snap, err := s.stock.Snapshot(ctx, storeID, *rc.Lines[i].ProductID)
			if err != nil {
				return err
			}
			if snap.IsArchived {
				return domain.ErrProductArchived.With("name", snap.Name)
			}
			rc.Lines[i].SKU, rc.Lines[i].Description = snap.SKU, snap.Name
			snaps[i] = snap
		}
		if err := s.receipts.Create(ctx, rc); err != nil {
			return err
		}
		for i := range rc.Lines {
			l := rc.Lines[i]
			newAvg := MovingAverage(snaps[i].StockOnHand, snaps[i].CostAvg, l.Qty, l.UnitCost)
			if err := s.stock.SetCosts(ctx, storeID, *l.ProductID, l.UnitCost, newAvg); err != nil {
				return err
			}
			cost := l.UnitCost
			if _, err := s.stock.Apply(ctx, storeID, *l.ProductID, domain.MoveReceipt, l.Qty, &cost, domain.RefReceipt, &rc.ID, rc.DocNo, actor.userPtr()); err != nil {
				return err
			}
		}
		if out, err = s.receipts.Get(ctx, storeID, rc.ID); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "receipt.post", "purchase_receipt", rc.ID, nil, out)
	})
	return out, err
}

func (s *Service) ListReceipts(ctx context.Context, storeID uuid.UUID, f postgres.ReceiptFilter) ([]domain.PurchaseReceipt, int64, error) {
	var out []domain.PurchaseReceipt
	var total int64
	err := s.tx(ctx, storeID, func(ctx context.Context) (err error) {
		out, total, err = s.receipts.List(ctx, storeID, f)
		return
	})
	return out, total, err
}

func (s *Service) GetReceipt(ctx context.Context, storeID, id uuid.UUID) (*domain.PurchaseReceipt, error) {
	var out *domain.PurchaseReceipt
	err := s.tx(ctx, storeID, func(ctx context.Context) (err error) {
		out, err = s.receipts.Get(ctx, storeID, id)
		return
	})
	return out, err
}

// CancelReceipt reverses every line with a `receipt_cancel` movement and marks the receipt cancelled.
// Costs are not rolled back (the moving average already absorbed the receipt).
func (s *Service) CancelReceipt(ctx context.Context, actor Actor, storeID, id uuid.UUID, reason string) (*domain.PurchaseReceipt, error) {
	var out *domain.PurchaseReceipt
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		cur, err := s.receipts.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		if cur.Status == domain.ReceiptCancelled {
			return domain.ErrReceiptCancelled.With("doc_no", cur.DocNo)
		}
		if cur.Status != domain.ReceiptPosted {
			return domain.ErrConflict.With("field", "status")
		}
		note := strings.TrimSpace("cancel " + cur.DocNo + " " + strings.TrimSpace(reason))
		for _, l := range cur.Lines {
			if l.ProductID == nil {
				continue
			}
			cost := l.UnitCost
			if _, err := s.stock.Apply(ctx, storeID, *l.ProductID, domain.MoveReceiptCancel, l.Qty.Neg(), &cost, domain.RefReceipt, &cur.ID, note, actor.userPtr()); err != nil {
				return err
			}
		}
		if err := s.receipts.SetStatus(ctx, storeID, id, domain.ReceiptCancelled); err != nil {
			return err
		}
		if out, err = s.receipts.Get(ctx, storeID, id); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "receipt.cancel", "purchase_receipt", id, cur, map[string]any{"status": out.Status, "reason": reason})
	})
	return out, err
}

// ---- adjustments ---------------------------------------------------------------------

type AdjustmentLineInput struct {
	ProductID uuid.UUID       `json:"product_id"`
	QtyDelta  decimal.Decimal `json:"qty_delta"`
	Note      string          `json:"note"`
}

type AdjustmentInput struct {
	Reason string                `json:"reason"`
	Note   string                `json:"note"`
	Lines  []AdjustmentLineInput `json:"lines"`
}

// PostAdjustment posts doc ADJ… with one `adjustment` movement per line (unit_cost = current average cost).
// A negative delta may not take stock below zero.
func (s *Service) PostAdjustment(ctx context.Context, actor Actor, storeID uuid.UUID, in AdjustmentInput) (*domain.StockAdjustment, error) {
	if strings.TrimSpace(in.Reason) == "" {
		return nil, domain.ErrValidation.With("field", "reason")
	}
	if len(in.Lines) == 0 {
		return nil, domain.ErrValidation.With("field", "lines")
	}
	at := time.Now()
	adj := &domain.StockAdjustment{StoreID: storeID, Reason: strings.TrimSpace(in.Reason), Note: strings.TrimSpace(in.Note), AdjustedAt: at, CreatedBy: actor.userPtr()}
	for _, l := range in.Lines {
		if l.ProductID == uuid.Nil || l.QtyDelta.Sign() == 0 {
			return nil, domain.ErrValidation.With("field", "lines")
		}
		adj.Lines = append(adj.Lines, domain.AdjustmentLine{ProductID: l.ProductID, QtyDelta: l.QtyDelta.Round(3), Note: strings.TrimSpace(l.Note)})
	}
	var out *domain.StockAdjustment
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		docNo, err := postgres.NextDocNo(ctx, storeID, postgres.DocAdjustment, at)
		if err != nil {
			return err
		}
		adj.DocNo = docNo
		for i := range adj.Lines {
			l := &adj.Lines[i]
			snap, err := s.stock.Snapshot(ctx, storeID, l.ProductID)
			if err != nil {
				return err
			}
			if l.QtyDelta.Sign() < 0 && snap.StockOnHand.Add(l.QtyDelta).Sign() < 0 {
				return domain.ErrStockInsufficient.With("name", snap.Name).With("stock", snap.StockOnHand.String())
			}
			cost := snap.CostAvg
			l.UnitCost = &cost
		}
		if err := s.adjustments.Create(ctx, adj); err != nil {
			return err
		}
		for _, l := range adj.Lines {
			note := adj.DocNo
			if l.Note != "" {
				note += " " + l.Note
			}
			if _, err := s.stock.Apply(ctx, storeID, l.ProductID, domain.MoveAdjustment, l.QtyDelta, l.UnitCost, domain.RefAdjustment, &adj.ID, note, actor.userPtr()); err != nil {
				return err
			}
		}
		if out, err = s.adjustments.Get(ctx, storeID, adj.ID); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "adjustment.post", "stock_adjustment", adj.ID, nil, out)
	})
	return out, err
}

func (s *Service) ListAdjustments(ctx context.Context, storeID uuid.UUID, limit, offset int) ([]domain.StockAdjustment, int64, error) {
	var out []domain.StockAdjustment
	var total int64
	err := s.tx(ctx, storeID, func(ctx context.Context) (err error) {
		out, total, err = s.adjustments.List(ctx, storeID, limit, offset)
		return
	})
	return out, total, err
}

func (s *Service) GetAdjustment(ctx context.Context, storeID, id uuid.UUID) (*domain.StockAdjustment, error) {
	var out *domain.StockAdjustment
	err := s.tx(ctx, storeID, func(ctx context.Context) (err error) {
		out, err = s.adjustments.Get(ctx, storeID, id)
		return
	})
	return out, err
}

// ---- stock takes -------------------------------------------------------------------------

type StockTakeInput struct {
	Note       string      `json:"note"`
	ProductIDs []uuid.UUID `json:"product_ids"` // empty = every active, non-archived product
	// Empty starts a sheet with no lines at all: counting from a phone adds the items as they are
	// scanned, instead of snapshotting the whole catalogue.
	Empty bool `json:"empty"`
}

type CountInput struct {
	ProductID  uuid.UUID       `json:"product_id"`
	CountedQty decimal.Decimal `json:"counted_qty"`
	Note       string          `json:"note"`
}

// StockTakeView is a stock take with variances filled in and a summary.
type StockTakeView struct {
	domain.StockTake
	Summary VarianceSummary `json:"summary"`
}

func view(t *domain.StockTake) *StockTakeView {
	ApplyVariances(t.Lines)
	return &StockTakeView{StockTake: *t, Summary: Summarize(t.Lines)}
}

func (s *Service) CreateStockTake(ctx context.Context, actor Actor, storeID uuid.UUID, in StockTakeInput) (*StockTakeView, error) {
	at := time.Now()
	ids := make([]uuid.UUID, 0, len(in.ProductIDs))
	for _, id := range in.ProductIDs {
		if id != uuid.Nil {
			ids = append(ids, id)
		}
	}
	t := &domain.StockTake{StoreID: storeID, Status: domain.StockTakeOpen, Note: strings.TrimSpace(in.Note), StartedAt: at, CreatedBy: actor.userPtr()}
	var out *StockTakeView
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		docNo, err := postgres.NextDocNo(ctx, storeID, postgres.DocStockTake, at)
		if err != nil {
			return err
		}
		t.DocNo = docNo
		if err := s.takes.Create(ctx, t, ids, in.Empty); err != nil {
			return err
		}
		full, err := s.takes.Get(ctx, storeID, t.ID)
		if err != nil {
			return err
		}
		out = view(full)
		return s.auditWrite(ctx, actor, storeID, "stocktake.create", "stock_take", t.ID, nil, map[string]any{"doc_no": t.DocNo, "lines": full.LineCount})
	})
	return out, err
}

// UpsertCounts records counted quantities on an open stock take.
func (s *Service) UpsertCounts(ctx context.Context, actor Actor, storeID, id uuid.UUID, lines []CountInput) (*StockTakeView, error) {
	if len(lines) == 0 {
		return nil, domain.ErrValidation.With("field", "lines")
	}
	for _, l := range lines {
		if l.ProductID == uuid.Nil || l.CountedQty.IsNegative() {
			return nil, domain.ErrValidation.With("field", "lines")
		}
	}
	var out *StockTakeView
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		cur, err := s.takes.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		if cur.Status != domain.StockTakeOpen {
			return domain.ErrStockTakeClosed
		}
		for _, l := range lines {
			if err := s.takes.UpsertCount(ctx, storeID, id, l.ProductID, l.CountedQty.Round(3), strings.TrimSpace(l.Note)); err != nil {
				return err
			}
		}
		full, err := s.takes.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		out = view(full)
		return s.auditWrite(ctx, actor, storeID, "stocktake.count", "stock_take", id, nil, map[string]any{"doc_no": full.DocNo, "lines": len(lines)})
	})
	return out, err
}

// FinalizeStockTake posts a `stocktake` movement for every counted line whose count differs from the snapshot.
func (s *Service) FinalizeStockTake(ctx context.Context, actor Actor, storeID, id uuid.UUID) (*StockTakeView, error) {
	var out *StockTakeView
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		cur, err := s.takes.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		if cur.Status != domain.StockTakeOpen {
			return domain.ErrStockTakeClosed
		}
		diff := ApplyVariances(cur.Lines)
		for _, l := range diff {
			cost := l.CostAvg
			if _, err := s.stock.Apply(ctx, storeID, l.ProductID, domain.MoveStockTake, l.Variance, &cost, domain.RefStockTake, &cur.ID, cur.DocNo, actor.userPtr()); err != nil {
				return err
			}
		}
		now := time.Now()
		if err := s.takes.SetStatus(ctx, storeID, id, domain.StockTakeFinalized, &now); err != nil {
			return err
		}
		full, err := s.takes.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		out = view(full)
		return s.auditWrite(ctx, actor, storeID, "stocktake.finalize", "stock_take", id, map[string]any{"status": cur.Status},
			map[string]any{"status": full.Status, "doc_no": full.DocNo, "summary": out.Summary})
	})
	return out, err
}

func (s *Service) ListStockTakes(ctx context.Context, storeID uuid.UUID, limit, offset int) ([]domain.StockTake, int64, error) {
	var out []domain.StockTake
	var total int64
	err := s.tx(ctx, storeID, func(ctx context.Context) (err error) {
		out, total, err = s.takes.List(ctx, storeID, limit, offset)
		return
	})
	return out, total, err
}

func (s *Service) GetStockTake(ctx context.Context, storeID, id uuid.UUID) (*StockTakeView, error) {
	var out *StockTakeView
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		t, err := s.takes.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		out = view(t)
		return nil
	})
	return out, err
}
