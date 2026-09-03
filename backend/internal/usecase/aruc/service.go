// Package aruc manages accounts receivable (ลูกหนี้): credit bills and their payments.
package aruc

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

type Service struct {
	db     *postgres.DB
	ar     postgres.ARRepo
	sales  postgres.SaleRepo
	shifts postgres.ShiftRepo
	drawer postgres.DrawerRepo
	audit  postgres.AuditRepo
}

func New(db *postgres.DB) *Service { return &Service{db: db} }

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

type PaymentInput struct {
	MemberID uuid.UUID            `json:"member_id"`
	SaleID   *uuid.UUID           `json:"sale_id,omitempty"` // pay one bill; nil = oldest-first allocation
	Amount   decimal.Decimal      `json:"amount"`
	Method   domain.PaymentMethod `json:"method"`
	Note     string               `json:"note,omitempty"`
	PaidAt   *time.Time           `json:"paid_at,omitempty"`
}

// Pay receives money against a member's credit bills. One ar_payments row is written per bill touched.
func (s *Service) Pay(ctx context.Context, storeID uuid.UUID, actor Actor, in PaymentInput) ([]domain.ARPayment, error) {
	if !in.Amount.IsPositive() {
		return nil, domain.ErrValidation.With("field", "amount")
	}
	if in.Method == "" {
		in.Method = domain.PayCash
	}
	if !in.Method.Valid() || in.Method == domain.PayCredit {
		return nil, domain.ErrValidation.With("field", "method")
	}
	paidAt := time.Now()
	if in.PaidAt != nil {
		paidAt = *in.PaidAt
	}
	var out []domain.ARPayment
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var bills []domain.Sale
		if in.SaleID != nil {
			b, err := s.sales.GetForUpdate(ctx, storeID, *in.SaleID)
			if err != nil {
				return err
			}
			if b.MemberID == nil || *b.MemberID != in.MemberID {
				return domain.ErrNotFound
			}
			if !b.ARBalance.IsPositive() {
				return domain.ErrARNothingDue
			}
			bills = []domain.Sale{*b}
		} else {
			var err error
			if bills, err = s.sales.OutstandingByMember(ctx, storeID, in.MemberID, true); err != nil {
				return err
			}
			if len(bills) == 0 {
				return domain.ErrARNothingDue
			}
		}
		totalDue := decimal.Zero
		for _, b := range bills {
			totalDue = totalDue.Add(b.ARBalance)
		}
		if in.Amount.GreaterThan(totalDue) {
			return domain.ErrAROverpay.With("balance", totalDue.StringFixed(2))
		}
		remaining := in.Amount
		docNo, err := postgres.NextDocNo(ctx, storeID, postgres.DocARPayment, paidAt)
		if err != nil {
			return err
		}
		for _, b := range bills {
			if !remaining.IsPositive() {
				break
			}
			pay := decimal.Min(remaining, b.ARBalance)
			newPaid := b.ARPaid.Add(pay)
			newBal := b.ARBalance.Sub(pay)
			st := domain.ARPartial
			if newBal.IsZero() {
				st = domain.ARPaid
			}
			if err := s.sales.UpdateAR(ctx, b.ID, newPaid, newBal, st); err != nil {
				return err
			}
			p := domain.ARPayment{DocNo: docNo, MemberID: &in.MemberID, SaleID: &b.ID, SaleDocNo: b.DocNo, BillTotal: b.ARTotal, BalanceBefore: b.ARBalance,
				Amount: pay, BalanceAfter: newBal, Method: in.Method, PaidAt: paidAt, ReceivedBy: actor.idPtr(), ReceivedByName: actor.Name, Note: in.Note}
			if err := s.ar.Insert(ctx, storeID, &p); err != nil {
				return err
			}
			out = append(out, p)
			remaining = remaining.Sub(pay)
		}
		if in.Method == domain.PayCash {
			if shift, _ := s.shifts.CurrentOpen(ctx, storeID, actor.idPtr(), ""); shift != nil {
				_ = s.shifts.AddCash(ctx, shift.ID, decimal.Zero, in.Amount, decimal.Zero)
				_ = s.drawer.Log(ctx, storeID, &shift.ID, actor.idPtr(), actor.Name, "paid_in", in.Amount, "AR "+docNo)
			}
		}
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: actor.idPtr(), ActorName: actor.Name, Action: "ar.pay", Entity: "member", EntityID: in.MemberID.String(), After: out, IP: actor.IP})
	})
	return out, err
}

func (s *Service) Accounts(ctx context.Context, storeID uuid.UUID, q string, limit, offset int) ([]postgres.ARAccount, int64, error) {
	var out []postgres.ARAccount
	var total int64
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, total, err = s.ar.Accounts(ctx, storeID, q, limit, offset)
		return err
	})
	return out, total, err
}

type MemberBills struct {
	Bills    []domain.Sale      `json:"bills"`
	Balance  decimal.Decimal    `json:"balance"`
	Payments []domain.ARPayment `json:"payments"`
}

func (s *Service) MemberBills(ctx context.Context, storeID, memberID uuid.UUID) (*MemberBills, error) {
	var out MemberBills
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		if out.Bills, err = s.sales.OutstandingByMember(ctx, storeID, memberID, false); err != nil {
			return err
		}
		for _, b := range out.Bills {
			out.Balance = out.Balance.Add(b.ARBalance)
		}
		out.Payments, _, err = s.ar.List(ctx, storeID, postgres.ARFilter{MemberID: &memberID, Limit: 50})
		return err
	})
	return &out, err
}

func (s *Service) Payments(ctx context.Context, storeID uuid.UUID, f postgres.ARFilter) ([]domain.ARPayment, int64, error) {
	var out []domain.ARPayment
	var total int64
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, total, err = s.ar.List(ctx, storeID, f)
		return err
	})
	return out, total, err
}

type Aging struct {
	AsOf    time.Time              `json:"as_of"`
	Buckets []postgres.AgingBucket `json:"buckets"`
	Total   decimal.Decimal        `json:"total"`
}

func (s *Service) Aging(ctx context.Context, storeID uuid.UUID, asOf time.Time) (*Aging, error) {
	out := &Aging{AsOf: asOf}
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out.Buckets, out.Total, err = s.ar.Aging(ctx, storeID, asOf)
		return err
	})
	return out, err
}
