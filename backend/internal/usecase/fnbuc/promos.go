package fnbuc

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

// ---------------------------------------------------------------------------
// Time-of-day promotions: happy hour, weekday lunch, a launch price
// ---------------------------------------------------------------------------

func (s *Service) Promos(ctx context.Context, storeID uuid.UUID, activeOnly bool) ([]domain.MenuPromo, error) {
	var out []domain.MenuPromo
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.repo.Promos(ctx, storeID, activeOnly)
		return err
	})
	return out, err
}

func (s *Service) SavePromo(ctx context.Context, storeID uuid.UUID, p domain.MenuPromo) (*domain.MenuPromo, error) {
	p.StoreID = storeID
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		return nil, domain.ErrValidation.With("field", "name")
	}
	switch p.Kind {
	case domain.PromoPercent, domain.PromoAmount, domain.PromoPrice:
	default:
		return nil, domain.ErrValidation.With("field", "kind")
	}
	if p.Value.IsNegative() || (p.Kind == domain.PromoPercent && p.Value.GreaterThan(decimal.NewFromInt(100))) {
		return nil, domain.ErrValidation.With("field", "value")
	}
	if p.CategoryID == nil && p.MenuItemID == nil {
		return nil, domain.ErrValidation.With("field", "menu_item_id")
	}
	if len(p.Days) == 0 {
		p.Days = []int{0, 1, 2, 3, 4, 5, 6}
	}
	for _, t := range []*string{&p.StartTime, &p.EndTime} {
		if *t == "" {
			*t = "00:00"
		}
		if _, err := time.Parse("15:04", *t); err != nil {
			return nil, domain.ErrValidation.With("field", "time")
		}
	}
	if p.EndTime == "00:00" {
		p.EndTime = "23:59"
	}
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error { return s.repo.UpsertPromo(ctx, &p) })
	return &p, err
}

// promoPrice is what an item costs right now under the promotions that apply to it. The best
// deal wins when several do; the list price is returned untouched when none does.
func promoPrice(item domain.MenuItem, promos []domain.MenuPromo, now time.Time) (decimal.Decimal, *domain.MenuPromo) {
	best := item.Price
	var winner *domain.MenuPromo
	for i := range promos {
		p := &promos[i]
		if !p.AppliesTo(item) || !p.RunsAt(now) {
			continue
		}
		price := p.PriceFor(item.Price)
		if price.LessThan(best) {
			best, winner = price, p
		}
	}
	return best, winner
}
