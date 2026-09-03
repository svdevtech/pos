// Package promouc manages promotions (bill-level and product-level discounts).
package promouc

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

type Service struct {
	db    *postgres.DB
	repo  postgres.PromoRepo
	audit postgres.AuditRepo
}

func New(db *postgres.DB) *Service { return &Service{db: db} }

type Actor struct {
	UserID uuid.UUID
	Name   string
	IP     string
}

func validate(p *domain.Promotion) error {
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		return domain.ErrValidation.With("field", "name")
	}
	if p.Scope != "bill" && p.Scope != "product" {
		return domain.ErrValidation.With("field", "scope")
	}
	if p.Scope == "product" && p.ProductID == nil {
		return domain.ErrValidation.With("field", "product_id")
	}
	if p.DiscountType != "amount" && p.DiscountType != "percent" {
		return domain.ErrValidation.With("field", "discount_type")
	}
	if p.DiscountValue.IsNegative() || (p.DiscountType == "percent" && p.DiscountValue.GreaterThan(decimalHundred)) {
		return domain.ErrValidation.With("field", "discount_value")
	}
	if p.StartsAt != nil && p.EndsAt != nil && p.EndsAt.Before(*p.StartsAt) {
		return domain.ErrValidation.With("field", "ends_at")
	}
	return nil
}

func (s *Service) List(ctx context.Context, storeID uuid.UUID, activeOnly bool) ([]domain.Promotion, error) {
	var out []domain.Promotion
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.repo.List(ctx, storeID, activeOnly, time.Now())
		return err
	})
	return out, err
}

func (s *Service) Create(ctx context.Context, storeID uuid.UUID, actor Actor, p domain.Promotion) (*domain.Promotion, error) {
	if err := validate(&p); err != nil {
		return nil, err
	}
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		if err := s.repo.Insert(ctx, storeID, &p); err != nil {
			return err
		}
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: &actor.UserID, ActorName: actor.Name, Action: "promotion.create", Entity: "promotion", EntityID: p.ID.String(), After: p, IP: actor.IP})
	})
	return &p, err
}

func (s *Service) Update(ctx context.Context, storeID uuid.UUID, actor Actor, p domain.Promotion) (*domain.Promotion, error) {
	if err := validate(&p); err != nil {
		return nil, err
	}
	var out *domain.Promotion
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		before, err := s.repo.Get(ctx, storeID, p.ID)
		if err != nil {
			return err
		}
		if err := s.repo.Update(ctx, storeID, &p); err != nil {
			return err
		}
		if out, err = s.repo.Get(ctx, storeID, p.ID); err != nil {
			return err
		}
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: &actor.UserID, ActorName: actor.Name, Action: "promotion.update", Entity: "promotion", EntityID: p.ID.String(), Before: before, After: out, IP: actor.IP})
	})
	return out, err
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
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: &actor.UserID, ActorName: actor.Name, Action: "promotion.delete", Entity: "promotion", EntityID: id.String(), Before: before, IP: actor.IP})
	})
}
