package salesuc

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

// StockLedger is satisfied by postgres.StockRepo (inventory module).
type StockLedger interface {
	Apply(ctx context.Context, storeID, productID uuid.UUID, moveType string, qtyDelta decimal.Decimal, unitCost *decimal.Decimal, refType string, refID *uuid.UUID, note string, by *uuid.UUID) (decimal.Decimal, error)
}

type Service struct {
	db     *postgres.DB
	sales  postgres.SaleRepo
	shifts postgres.ShiftRepo
	drawer postgres.DrawerRepo
	held   postgres.HeldRepo
	promos postgres.PromoRepo
	stores postgres.StoreRepo
	audit  postgres.AuditRepo
	stock  StockLedger
}

func New(db *postgres.DB, stock StockLedger) *Service { return &Service{db: db, stock: stock} }

type Actor struct {
	UserID uuid.UUID
	Name   string
	IP     string
}

func (a Actor) idPtr() *uuid.UUID {
	if a.UserID == uuid.Nil {
		return nil
	}
	id := a.UserID
	return &id
}

// ---------------------------------------------------------------------------
// Create sale
// ---------------------------------------------------------------------------

type LineInput struct {
	ProductID uuid.UUID        `json:"product_id"`
	Qty       decimal.Decimal  `json:"qty"`
	UnitPrice *decimal.Decimal `json:"unit_price,omitempty"` // manual override (requires allow_price_edit)
	Discount  decimal.Decimal  `json:"discount"`
	IsFree    bool             `json:"is_free"`
	SerialNo  string           `json:"serial_no,omitempty"`
}

type CreateSaleInput struct {
	MemberID        *uuid.UUID      `json:"member_id,omitempty"`
	Lines           []LineInput     `json:"lines"`
	Payments        []Tender        `json:"payments"`
	BillDiscount    decimal.Decimal `json:"bill_discount"`
	BillDiscountPct decimal.Decimal `json:"bill_discount_pct"`
	Note            string          `json:"note,omitempty"`
	Terminal        string          `json:"terminal,omitempty"`
	SoldAt          *time.Time      `json:"sold_at,omitempty"` // back-dated entry (managers)
	AllowNegative   bool            `json:"-"`
	HeldBillID      *uuid.UUID      `json:"held_bill_id,omitempty"`
}

// Quote prices a cart without posting (used by the POS screen for live totals).
func (s *Service) Quote(ctx context.Context, storeID uuid.UUID, in CreateSaleInput) (*Totals, []CartLine, error) {
	var tot Totals
	var lines []CartLine
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		lines, _, err = s.buildLines(ctx, storeID, in, false)
		if err != nil {
			return err
		}
		promos, err := s.promos.List(ctx, storeID, true, time.Now())
		if err != nil {
			return err
		}
		tot, lines = Compute(lines, promos, in.BillDiscount, in.BillDiscountPct)
		return nil
	})
	return &tot, lines, err
}

func (s *Service) buildLines(ctx context.Context, storeID uuid.UUID, in CreateSaleInput, lock bool) ([]CartLine, *postgres.MemberSnapshot, error) {
	if len(in.Lines) == 0 {
		return nil, nil, domain.ErrSaleEmpty
	}
	var member *postgres.MemberSnapshot
	if in.MemberID != nil {
		m, err := s.sales.MemberForSale(ctx, storeID, *in.MemberID)
		if err != nil {
			return nil, nil, err
		}
		member = m
	}
	settings, _ := s.stores.GetSettings(ctx, storeID)
	allowPriceEdit, _ := settings["allow_price_edit"].(bool)
	lines := make([]CartLine, 0, len(in.Lines))
	for i, li := range in.Lines {
		if li.Qty.IsZero() {
			return nil, nil, domain.ErrValidation.With("field", "lines.qty")
		}
		p, err := s.sales.ProductForSale(ctx, storeID, li.ProductID)
		if err != nil {
			return nil, nil, err
		}
		if p.IsArchived || !p.IsActive {
			return nil, nil, domain.ErrProductArchived.With("name", p.Name)
		}
		if p.IsSerial && strings.TrimSpace(li.SerialNo) == "" && !li.IsFree {
			return nil, nil, domain.ErrSaleSerialRequired.With("name", p.Name)
		}
		price := p.SellPrice
		if member != nil {
			price = TierPrice(p.SellPrice, p.PriceTiers, member.PriceTier)
		}
		if li.UnitPrice != nil && allowPriceEdit {
			price = *li.UnitPrice
		}
		if li.Discount.IsNegative() {
			return nil, nil, domain.ErrValidation.With("field", "lines.discount")
		}
		lines = append(lines, CartLine{
			ProductID: p.ID, SKU: p.SKU, Description: p.Name, Qty: li.Qty, UnitPrice: price, Discount: domain.Money(li.Discount),
			IsFree: li.IsFree, SerialNo: strings.TrimSpace(li.SerialNo), CostLast: p.CostLast, CostAvg: p.CostAvg,
		})
		_ = i
	}
	return lines, member, nil
}

// Create posts a sale atomically: header, lines, tenders, stock ledger, AR, shift cash and drawer log.
func (s *Service) Create(ctx context.Context, storeID uuid.UUID, actor Actor, in CreateSaleInput) (*domain.Sale, error) {
	var out *domain.Sale
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		lines, member, err := s.buildLines(ctx, storeID, in, true)
		if err != nil {
			return err
		}
		now := time.Now()
		soldAt := now
		if in.SoldAt != nil {
			soldAt = *in.SoldAt
		}
		promos, err := s.promos.List(ctx, storeID, true, soldAt)
		if err != nil {
			return err
		}
		tot, lines := Compute(lines, promos, in.BillDiscount, in.BillDiscountPct)
		settle, err := Settle(tot.Net, in.Payments)
		if err != nil {
			return err
		}
		if settle.Credit.IsPositive() && (member == nil || member.IsWalkin) {
			return domain.ErrSaleCreditNeedsMember
		}
		settings, _ := s.stores.GetSettings(ctx, storeID)
		requireShift, _ := settings["require_shift"].(bool)
		allowNegative := true
		if v, ok := settings["allow_negative_stock"].(bool); ok {
			allowNegative = v
		}
		shift, err := s.shifts.CurrentOpen(ctx, storeID, actor.idPtr(), "")
		if err != nil {
			return err
		}
		if shift == nil && requireShift {
			return domain.ErrShiftNotOpen
		}

		docNo, err := postgres.NextDocNo(ctx, storeID, postgres.DocSale, soldAt)
		if err != nil {
			return err
		}
		sale := &domain.Sale{
			StoreID: storeID, DocNo: docNo, SoldAt: soldAt, CashierID: actor.idPtr(), CashierName: actor.Name,
			Gross: tot.Gross, Discount: tot.LineDiscount.Add(tot.BillDiscount), BillDiscount: tot.BillDiscount, Net: tot.Net,
			Tendered: settle.Tendered, Change: settle.Change, Status: domain.SaleCompleted, ARStatus: domain.ARNone, Note: in.Note,
		}
		if member != nil {
			sale.MemberID = &member.ID
		}
		if shift != nil {
			sale.ShiftID = &shift.ID
		}
		if settle.Credit.IsPositive() {
			sale.ARStatus = domain.ARUnpaid
			sale.ARTotal = settle.Credit
			sale.ARBalance = settle.Credit
		}
		if err := s.sales.Insert(ctx, sale); err != nil {
			return err
		}
		for i := range lines {
			l := lines[i]
			sl := &domain.SaleLine{SaleID: sale.ID, LineNo: i + 1, ProductID: ptr(l.ProductID), SKU: l.SKU, Description: l.Description, Qty: l.Qty, UnitPrice: l.UnitPrice,
				Discount: l.Discount.Add(l.PromoDisc), LineTotal: l.LineTotal(), CostLast: l.CostLast, CostAvg: l.CostAvg, IsFree: l.IsFree, SerialNo: l.SerialNo, PromotionID: l.PromotionID}
			if err := s.sales.InsertLine(ctx, storeID, sl); err != nil {
				return err
			}
			cost := l.CostAvg
			bal, err := s.stock.Apply(ctx, storeID, l.ProductID, "sale", l.Qty.Neg(), &cost, "sale", &sale.ID, docNo, actor.idPtr())
			if err != nil {
				return err
			}
			if bal.IsNegative() && !allowNegative {
				return domain.ErrStockInsufficient.With("name", l.Description).With("stock", bal.Add(l.Qty).String())
			}
		}
		for _, t := range in.Payments {
			amt := t.Amount
			if t.Method == domain.PayCredit {
				amt = settle.Credit
			}
			if amt.IsZero() && t.Method != domain.PayCash {
				continue
			}
			if t.Method == domain.PayCash {
				amt = settle.CashIn // record net cash kept, not the tendered note
			}
			if err := s.sales.InsertPayment(ctx, storeID, &domain.SalePayment{SaleID: sale.ID, Method: t.Method, Amount: domain.Money(amt), Reference: t.Reference}); err != nil {
				return err
			}
		}
		if shift != nil && settle.CashIn.IsPositive() {
			if err := s.shifts.AddCash(ctx, shift.ID, settle.CashIn, decimal.Zero, decimal.Zero); err != nil {
				return err
			}
		}
		if settle.CashIn.IsPositive() || settle.Change.IsPositive() {
			var sid *uuid.UUID
			if shift != nil {
				sid = &shift.ID
			}
			if err := s.drawer.Log(ctx, storeID, sid, actor.idPtr(), actor.Name, "sale", settle.CashIn, docNo); err != nil {
				return err
			}
		}
		if in.HeldBillID != nil {
			_ = s.held.Delete(ctx, storeID, *in.HeldBillID)
		}
		out, err = s.sales.Get(ctx, storeID, sale.ID)
		return err
	})
	return out, err
}

func ptr(id uuid.UUID) *uuid.UUID { return &id }

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

func (s *Service) Get(ctx context.Context, storeID, id uuid.UUID) (*domain.Sale, error) {
	var out *domain.Sale
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.sales.Get(ctx, storeID, id)
		return err
	})
	return out, err
}

func (s *Service) GetByDocNo(ctx context.Context, storeID uuid.UUID, docNo string) (*domain.Sale, error) {
	var out *domain.Sale
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.sales.GetByDocNo(ctx, storeID, docNo)
		return err
	})
	return out, err
}

func (s *Service) List(ctx context.Context, storeID uuid.UUID, f postgres.SaleFilter) ([]domain.Sale, int64, error) {
	var out []domain.Sale
	var total int64
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, total, err = s.sales.List(ctx, storeID, f)
		return err
	})
	return out, total, err
}

func (s *Service) Summary(ctx context.Context, storeID uuid.UUID, from, to time.Time, shiftID *uuid.UUID) (*postgres.DailySummary, error) {
	var out *postgres.DailySummary
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.sales.Summary(ctx, storeID, from, to, shiftID)
		return err
	})
	return out, err
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

func (s *Service) Cancel(ctx context.Context, storeID uuid.UUID, actor Actor, id uuid.UUID, reason string) (*domain.Sale, error) {
	var out *domain.Sale
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		sale, err := s.sales.GetForUpdate(ctx, storeID, id)
		if err != nil {
			return err
		}
		if sale.Status == domain.SaleCancelled {
			return domain.ErrSaleAlreadyCancelled
		}
		if sale.ARPaid.IsPositive() {
			return domain.ErrConflict.With("reason", "credit bill has received payments; refund them first")
		}
		lines, err := s.sales.Lines(ctx, id)
		if err != nil {
			return err
		}
		for _, l := range lines {
			if l.ProductID == nil {
				continue
			}
			restock := l.Qty.Sub(l.ReturnedQty)
			if restock.IsPositive() {
				cost := l.CostAvg
				if _, err := s.stock.Apply(ctx, storeID, *l.ProductID, "sale_cancel", restock, &cost, "sale", &sale.ID, sale.DocNo, actor.idPtr()); err != nil {
					return err
				}
			}
		}
		if err := s.sales.MarkCancelled(ctx, id, actor.idPtr(), actor.Name, reason); err != nil {
			return err
		}
		// reverse cash from the shift if still open
		cash := decimal.Zero
		for _, p := range sale.Payments {
			if p.Method == domain.PayCash {
				cash = cash.Add(p.Amount)
			}
		}
		if pays, err := s.sales.Payments(ctx, id); err == nil {
			cash = decimal.Zero
			for _, p := range pays {
				if p.Method == domain.PayCash {
					cash = cash.Add(p.Amount)
				}
			}
		}
		if cash.IsPositive() {
			if shift, _ := s.shifts.CurrentOpen(ctx, storeID, actor.idPtr(), ""); shift != nil {
				_ = s.shifts.AddCash(ctx, shift.ID, cash.Neg(), decimal.Zero, decimal.Zero)
				_ = s.drawer.Log(ctx, storeID, &shift.ID, actor.idPtr(), actor.Name, "paid_out", cash, "cancel "+sale.DocNo)
			}
		}
		if err := s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: actor.idPtr(), ActorName: actor.Name, Action: "sale.cancel", Entity: "sale", EntityID: id.String(),
			Before: map[string]any{"status": sale.Status, "net": sale.Net}, After: map[string]any{"status": "cancelled", "reason": reason}, IP: actor.IP}); err != nil {
			return err
		}
		out, err = s.sales.Get(ctx, storeID, id)
		return err
	})
	return out, err
}

// ---------------------------------------------------------------------------
// Returns / refunds
// ---------------------------------------------------------------------------

type ReturnLineInput struct {
	SaleLineID uuid.UUID       `json:"sale_line_id"`
	Qty        decimal.Decimal `json:"qty"`
}

type ReturnInput struct {
	Lines        []ReturnLineInput    `json:"lines"`
	RefundMethod domain.PaymentMethod `json:"refund_method"`
	Restock      bool                 `json:"restock"`
	Reason       string               `json:"reason,omitempty"`
}

func (s *Service) Return(ctx context.Context, storeID uuid.UUID, actor Actor, saleID uuid.UUID, in ReturnInput) (*domain.SaleReturn, error) {
	if len(in.Lines) == 0 {
		return nil, domain.ErrSaleEmpty
	}
	if in.RefundMethod == "" {
		in.RefundMethod = domain.PayCash
	}
	if !in.RefundMethod.Valid() {
		return nil, domain.ErrValidation.With("field", "refund_method")
	}
	var out *domain.SaleReturn
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		sale, err := s.sales.GetForUpdate(ctx, storeID, saleID)
		if err != nil {
			return err
		}
		if sale.Status == domain.SaleCancelled {
			return domain.ErrSaleAlreadyCancelled
		}
		lines, err := s.sales.Lines(ctx, saleID)
		if err != nil {
			return err
		}
		byID := map[uuid.UUID]domain.SaleLine{}
		for _, l := range lines {
			byID[l.ID] = l
		}
		now := time.Now()
		docNo, err := postgres.NextDocNo(ctx, storeID, postgres.DocReturn, now)
		if err != nil {
			return err
		}
		ret := &domain.SaleReturn{DocNo: docNo, SaleID: saleID, SaleDocNo: sale.DocNo, ReturnedAt: now, ProcessedBy: actor.idPtr(), RefundMethod: in.RefundMethod, Restock: in.Restock, Reason: in.Reason}
		total := decimal.Zero
		var rls []domain.SaleReturnLine
		for _, ri := range in.Lines {
			l, ok := byID[ri.SaleLineID]
			if !ok {
				return domain.ErrNotFound.With("field", "sale_line_id")
			}
			if !ri.Qty.IsPositive() || ri.Qty.GreaterThan(l.Qty.Sub(l.ReturnedQty)) {
				return domain.ErrReturnExceeds.With("name", l.Description)
			}
			// refund proportionally to what was actually paid for the line
			unit := decimal.Zero
			if l.Qty.IsPositive() {
				unit = l.LineTotal.Div(l.Qty)
			}
			amt := domain.Money(unit.Mul(ri.Qty))
			total = total.Add(amt)
			rls = append(rls, domain.SaleReturnLine{SaleLineID: l.ID, ProductID: l.ProductID, Qty: ri.Qty, UnitPrice: domain.Money(unit), Amount: amt})
		}
		ret.RefundAmount = total
		if err := s.sales.InsertReturn(ctx, storeID, ret); err != nil {
			return err
		}
		allReturned := true
		for i := range rls {
			rl := &rls[i]
			if err := s.sales.InsertReturnLine(ctx, ret.ID, rl); err != nil {
				return err
			}
			if in.Restock && rl.ProductID != nil {
				l := byID[rl.SaleLineID]
				cost := l.CostAvg
				if _, err := s.stock.Apply(ctx, storeID, *rl.ProductID, "return", rl.Qty, &cost, "sale_return", &ret.ID, docNo, actor.idPtr()); err != nil {
					return err
				}
			}
		}
		for _, l := range lines {
			returned := l.ReturnedQty
			for _, rl := range rls {
				if rl.SaleLineID == l.ID {
					returned = returned.Add(rl.Qty)
				}
			}
			if returned.LessThan(l.Qty) {
				allReturned = false
			}
		}
		status := domain.SalePartialRefund
		if allReturned {
			status = domain.SaleRefunded
		}
		if err := s.sales.SetStatus(ctx, saleID, status); err != nil {
			return err
		}
		// credit bills: reduce the receivable first, refund cash only for the paid part
		if sale.ARBalance.IsPositive() {
			reduce := decimal.Min(total, sale.ARBalance)
			newBal := sale.ARBalance.Sub(reduce)
			st := domain.ARPartial
			if newBal.IsZero() {
				st = domain.ARPaid
			}
			if err := s.sales.UpdateAR(ctx, saleID, sale.ARPaid, newBal, st); err != nil {
				return err
			}
			total = total.Sub(reduce)
		}
		if total.IsPositive() && in.RefundMethod == domain.PayCash {
			if shift, _ := s.shifts.CurrentOpen(ctx, storeID, actor.idPtr(), ""); shift != nil {
				_ = s.shifts.AddCash(ctx, shift.ID, decimal.Zero, decimal.Zero, total)
				_ = s.drawer.Log(ctx, storeID, &shift.ID, actor.idPtr(), actor.Name, "paid_out", total, "refund "+docNo)
			}
		}
		ret.Lines = rls
		out = ret
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: actor.idPtr(), ActorName: actor.Name, Action: "sale.return", Entity: "sale", EntityID: saleID.String(), After: ret, IP: actor.IP})
	})
	return out, err
}

func (s *Service) ListReturns(ctx context.Context, storeID uuid.UUID, saleID *uuid.UUID, limit, offset int) ([]domain.SaleReturn, int64, error) {
	var out []domain.SaleReturn
	var total int64
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, total, err = s.sales.ListReturns(ctx, storeID, saleID, limit, offset)
		return err
	})
	return out, total, err
}

// ---------------------------------------------------------------------------
// Held bills
// ---------------------------------------------------------------------------

func (s *Service) Hold(ctx context.Context, storeID uuid.UUID, actor Actor, label string, memberID *uuid.UUID, cart any) (*domain.HeldBill, error) {
	var out *domain.HeldBill
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.held.Create(ctx, storeID, actor.UserID, label, memberID, cart)
		return err
	})
	return out, err
}

func (s *Service) ListHeld(ctx context.Context, storeID uuid.UUID) ([]domain.HeldBill, error) {
	var out []domain.HeldBill
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.held.List(ctx, storeID)
		return err
	})
	return out, err
}

func (s *Service) DeleteHeld(ctx context.Context, storeID, id uuid.UUID) error {
	return s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		return s.held.Delete(ctx, storeID, id)
	})
}

// ---------------------------------------------------------------------------
// Shifts & drawer
// ---------------------------------------------------------------------------

func (s *Service) OpenShift(ctx context.Context, storeID uuid.UUID, actor Actor, terminal string, openingFloat decimal.Decimal, note string) (*domain.Shift, error) {
	if terminal == "" {
		terminal = "POS1"
	}
	var out *domain.Shift
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		if cur, err := s.shifts.CurrentOpen(ctx, storeID, actor.idPtr(), ""); err != nil {
			return err
		} else if cur != nil {
			return domain.ErrShiftAlreadyOpen
		}
		sh, err := s.shifts.Open(ctx, storeID, actor.UserID, terminal, openingFloat, note)
		if err != nil {
			return err
		}
		if err := s.drawer.Log(ctx, storeID, &sh.ID, actor.idPtr(), actor.Name, "shift_open", openingFloat, note); err != nil {
			return err
		}
		out = sh
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: actor.idPtr(), ActorName: actor.Name, Action: "shift.open", Entity: "shift", EntityID: sh.ID.String(), After: sh, IP: actor.IP})
	})
	return out, err
}

func (s *Service) CurrentShift(ctx context.Context, storeID uuid.UUID, actor Actor) (*domain.Shift, error) {
	var out *domain.Shift
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.shifts.CurrentOpen(ctx, storeID, actor.idPtr(), "")
		return err
	})
	return out, err
}

type CloseShiftResult struct {
	Shift   *domain.Shift          `json:"shift"`
	Summary *postgres.DailySummary `json:"summary"`
}

func (s *Service) CloseShift(ctx context.Context, storeID uuid.UUID, actor Actor, shiftID uuid.UUID, counted decimal.Decimal, note string) (*CloseShiftResult, error) {
	var out CloseShiftResult
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		sh, err := s.shifts.Get(ctx, storeID, shiftID)
		if err != nil {
			return err
		}
		if sh.Status != "open" {
			return domain.ErrShiftNotOpen
		}
		expected := sh.OpeningFloat.Add(sh.CashSales).Add(sh.CashIn).Sub(sh.CashOut)
		if err := s.shifts.Close(ctx, shiftID, actor.UserID, expected, counted, note); err != nil {
			return err
		}
		if err := s.drawer.Log(ctx, storeID, &sh.ID, actor.idPtr(), actor.Name, "shift_close", counted, note); err != nil {
			return err
		}
		out.Shift, err = s.shifts.Get(ctx, storeID, shiftID)
		if err != nil {
			return err
		}
		out.Summary, err = s.sales.Summary(ctx, storeID, sh.OpenedAt, time.Now().Add(time.Second), &shiftID)
		if err != nil {
			return err
		}
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: actor.idPtr(), ActorName: actor.Name, Action: "shift.close", Entity: "shift", EntityID: shiftID.String(), After: out.Shift, IP: actor.IP})
	})
	return &out, err
}

func (s *Service) ShiftReport(ctx context.Context, storeID, shiftID uuid.UUID) (*CloseShiftResult, error) {
	var out CloseShiftResult
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		sh, err := s.shifts.Get(ctx, storeID, shiftID)
		if err != nil {
			return err
		}
		end := time.Now().Add(time.Second)
		if sh.ClosedAt != nil {
			end = sh.ClosedAt.Add(time.Second)
		}
		out.Shift = sh
		out.Summary, err = s.sales.Summary(ctx, storeID, sh.OpenedAt, end, &shiftID)
		return err
	})
	return &out, err
}

func (s *Service) ListShifts(ctx context.Context, storeID uuid.UUID, limit, offset int) ([]domain.Shift, int64, error) {
	var out []domain.Shift
	var total int64
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, total, err = s.shifts.List(ctx, storeID, limit, offset)
		return err
	})
	return out, total, err
}

// DrawerOp records a manual drawer event: no_sale (open drawer), paid_in, paid_out.
func (s *Service) DrawerOp(ctx context.Context, storeID uuid.UUID, actor Actor, reason string, amount decimal.Decimal, note string) error {
	switch reason {
	case "no_sale", "paid_in", "paid_out":
	default:
		return domain.ErrValidation.With("field", "reason")
	}
	if amount.IsNegative() {
		return domain.ErrValidation.With("field", "amount")
	}
	return s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		shift, err := s.shifts.CurrentOpen(ctx, storeID, actor.idPtr(), "")
		if err != nil {
			return err
		}
		var sid *uuid.UUID
		if shift != nil {
			sid = &shift.ID
			switch reason {
			case "paid_in":
				err = s.shifts.AddCash(ctx, shift.ID, decimal.Zero, amount, decimal.Zero)
			case "paid_out":
				err = s.shifts.AddCash(ctx, shift.ID, decimal.Zero, decimal.Zero, amount)
			}
			if err != nil {
				return err
			}
		}
		return s.drawer.Log(ctx, storeID, sid, actor.idPtr(), actor.Name, reason, amount, note)
	})
}

func (s *Service) DrawerLogs(ctx context.Context, storeID uuid.UUID, from, to time.Time, limit, offset int) ([]postgres.DrawerLog, int64, error) {
	var out []postgres.DrawerLog
	var total int64
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, total, err = s.drawer.List(ctx, storeID, from, to, limit, offset)
		return err
	})
	return out, total, err
}

// ---------------------------------------------------------------------------
// Receipt rendering data
// ---------------------------------------------------------------------------

type Receipt struct {
	Store    *domain.Store        `json:"store"`
	Settings domain.StoreSettings `json:"settings"`
	Sale     *domain.Sale         `json:"sale"`
	Returns  []domain.SaleReturn  `json:"returns,omitempty"`
}

func (s *Service) Receipt(ctx context.Context, storeID, saleID uuid.UUID) (*Receipt, error) {
	var out Receipt
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		if out.Sale, err = s.sales.Get(ctx, storeID, saleID); err != nil {
			return err
		}
		if out.Store, err = s.stores.Get(ctx, storeID); err != nil {
			return err
		}
		out.Settings, _ = s.stores.GetSettings(ctx, storeID)
		out.Returns, _, err = s.sales.ListReturns(ctx, storeID, &saleID, 50, 0)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		return nil
	})
	return &out, err
}
