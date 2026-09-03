// Package expenseuc records store expenses (ค่าใช้จ่าย) and their types.
package expenseuc

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

type Service struct {
	db     *postgres.DB
	repo   postgres.ExpenseRepo
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

func (s *Service) ListTypes(ctx context.Context, storeID uuid.UUID) ([]domain.ExpenseType, error) {
	var out []domain.ExpenseType
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.repo.ListTypes(ctx, storeID)
		return err
	})
	return out, err
}

func (s *Service) SaveType(ctx context.Context, storeID uuid.UUID, t domain.ExpenseType) (*domain.ExpenseType, error) {
	if strings.TrimSpace(t.Name) == "" {
		return nil, domain.ErrValidation.With("field", "name")
	}
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		if t.ID == uuid.Nil {
			t.IsActive = true
			return s.repo.CreateType(ctx, storeID, &t)
		}
		return s.repo.UpdateType(ctx, storeID, &t)
	})
	return &t, err
}

type ExpenseInput struct {
	TypeID     *uuid.UUID           `json:"type_id"`
	ExpensedAt string               `json:"expensed_at"` // YYYY-MM-DD
	Amount     decimal.Decimal      `json:"amount"`
	Note       string               `json:"note"`
	PaidFrom   domain.PaymentMethod `json:"paid_from"`
	FromDrawer bool                 `json:"from_drawer"` // cash taken from the open shift's drawer
}

func (s *Service) parse(in ExpenseInput) (*domain.Expense, error) {
	if !in.Amount.IsPositive() {
		return nil, domain.ErrValidation.With("field", "amount")
	}
	d, err := time.ParseInLocation("2006-01-02", in.ExpensedAt, time.Local)
	if err != nil {
		return nil, domain.ErrValidation.With("field", "expensed_at")
	}
	if in.PaidFrom == "" {
		in.PaidFrom = domain.PayCash
	}
	if !in.PaidFrom.Valid() {
		return nil, domain.ErrValidation.With("field", "paid_from")
	}
	return &domain.Expense{TypeID: in.TypeID, ExpensedAt: d, Amount: domain.Money(in.Amount), Note: strings.TrimSpace(in.Note), PaidFrom: in.PaidFrom}, nil
}

func (s *Service) Create(ctx context.Context, storeID uuid.UUID, actor Actor, in ExpenseInput) (*domain.Expense, error) {
	e, err := s.parse(in)
	if err != nil {
		return nil, err
	}
	e.CreatedBy, e.CreatedByName = actor.idPtr(), actor.Name
	err = s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		if in.FromDrawer && e.PaidFrom == domain.PayCash {
			if shift, _ := s.shifts.CurrentOpen(ctx, storeID, actor.idPtr(), ""); shift != nil {
				e.ShiftID = &shift.ID
				_ = s.shifts.AddCash(ctx, shift.ID, decimal.Zero, decimal.Zero, e.Amount)
				_ = s.drawer.Log(ctx, storeID, &shift.ID, actor.idPtr(), actor.Name, "paid_out", e.Amount, "expense: "+e.Note)
			}
		}
		if err := s.repo.Insert(ctx, storeID, e); err != nil {
			return err
		}
		out, err := s.repo.Get(ctx, storeID, e.ID)
		if err != nil {
			return err
		}
		*e = *out
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: actor.idPtr(), ActorName: actor.Name, Action: "expense.create", Entity: "expense", EntityID: e.ID.String(), After: e, IP: actor.IP})
	})
	return e, err
}

func (s *Service) Update(ctx context.Context, storeID uuid.UUID, actor Actor, id uuid.UUID, in ExpenseInput) (*domain.Expense, error) {
	e, err := s.parse(in)
	if err != nil {
		return nil, err
	}
	e.ID = id
	err = s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		before, err := s.repo.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		if err := s.repo.Update(ctx, storeID, e); err != nil {
			return err
		}
		out, err := s.repo.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		*e = *out
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: actor.idPtr(), ActorName: actor.Name, Action: "expense.update", Entity: "expense", EntityID: id.String(), Before: before, After: e, IP: actor.IP})
	})
	return e, err
}

func (s *Service) Delete(ctx context.Context, storeID uuid.UUID, actor Actor, id uuid.UUID) error {
	return s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		before, err := s.repo.Get(ctx, storeID, id)
		if err != nil {
			return err
		}
		if err := s.repo.Delete(ctx, storeID, id); err != nil {
			return err
		}
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: actor.idPtr(), ActorName: actor.Name, Action: "expense.delete", Entity: "expense", EntityID: id.String(), Before: before, IP: actor.IP})
	})
}

type ListResult struct {
	Items    []domain.Expense `json:"items"`
	Total    int64            `json:"total"`
	Sum      decimal.Decimal  `json:"sum"`
	Page     int              `json:"page"`
	PageSize int              `json:"page_size"`
}

func (s *Service) List(ctx context.Context, storeID uuid.UUID, f postgres.ExpenseFilter, page, size int) (*ListResult, error) {
	out := &ListResult{Page: page, PageSize: size}
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out.Items, out.Total, out.Sum, err = s.repo.List(ctx, storeID, f)
		return err
	})
	return out, err
}
