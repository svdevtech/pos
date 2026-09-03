package inventoryuc

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

// Unit conversion turns a packing unit into loose units: 1 ลัง of beer becomes 12 ขวด.
// The two packings are separate products (they have their own barcode, price and stock), so the
// conversion moves stock from one to the other and carries the cost across.

type ConversionRuleInput struct {
	FromProductID uuid.UUID       `json:"from_product_id"`
	ToProductID   uuid.UUID       `json:"to_product_id"`
	Factor        decimal.Decimal `json:"factor"` // how many ToProduct one FromProduct yields
	Note          string          `json:"note"`
	IsActive      *bool           `json:"is_active"`
}

type ConversionInput struct {
	FromProductID uuid.UUID        `json:"from_product_id"`
	ToProductID   uuid.UUID        `json:"to_product_id"`
	FromQty       decimal.Decimal  `json:"from_qty"`
	Factor        *decimal.Decimal `json:"factor"` // omitted → the saved rule decides
	Note          string           `json:"note"`
	// SaveRule stores the factor for next time (or updates the existing rule).
	SaveRule bool `json:"save_rule"`
}

func (s *Service) ListConversionRules(ctx context.Context, storeID uuid.UUID, activeOnly bool) ([]domain.ProductConversion, error) {
	var out []domain.ProductConversion
	err := s.tx(ctx, storeID, func(ctx context.Context) (err error) {
		out, err = s.conversions.ListRules(ctx, storeID, activeOnly)
		return
	})
	return out, err
}

// ConversionRulesFrom lists what one product can be converted into (used by the scan screens).
func (s *Service) ConversionRulesFrom(ctx context.Context, storeID, productID uuid.UUID) ([]domain.ProductConversion, error) {
	var out []domain.ProductConversion
	err := s.tx(ctx, storeID, func(ctx context.Context) (err error) {
		out, err = s.conversions.RulesFrom(ctx, storeID, productID)
		return
	})
	return out, err
}

func (s *Service) SaveConversionRule(ctx context.Context, actor Actor, storeID uuid.UUID, in ConversionRuleInput) (*domain.ProductConversion, error) {
	if in.FromProductID == uuid.Nil || in.ToProductID == uuid.Nil || in.FromProductID == in.ToProductID {
		return nil, domain.ErrValidation.With("field", "product")
	}
	if in.Factor.Sign() <= 0 {
		return nil, domain.ErrValidation.With("field", "factor")
	}
	rule := &domain.ProductConversion{
		StoreID: storeID, FromProductID: in.FromProductID, ToProductID: in.ToProductID,
		Factor: in.Factor.Round(3), IsActive: true, Note: strings.TrimSpace(in.Note),
	}
	if in.IsActive != nil {
		rule.IsActive = *in.IsActive
	}
	var out *domain.ProductConversion
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		if err := s.conversions.UpsertRule(ctx, rule); err != nil {
			return err
		}
		var err error
		if out, err = s.conversions.GetRule(ctx, storeID, rule.ID); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "conversion.rule", "product_conversion", rule.ID, nil, out)
	})
	return out, err
}

func (s *Service) SetConversionRuleActive(ctx context.Context, actor Actor, storeID, id uuid.UUID, active bool) (*domain.ProductConversion, error) {
	var out *domain.ProductConversion
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		if err := s.conversions.SetRuleActive(ctx, storeID, id, active); err != nil {
			return err
		}
		var err error
		if out, err = s.conversions.GetRule(ctx, storeID, id); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "conversion.rule", "product_conversion", id, nil, out)
	})
	return out, err
}

func (s *Service) ListConversions(ctx context.Context, storeID uuid.UUID, limit, offset int) ([]domain.StockConversion, int64, error) {
	var out []domain.StockConversion
	var total int64
	err := s.tx(ctx, storeID, func(ctx context.Context) (err error) {
		out, total, err = s.conversions.List(ctx, storeID, limit, offset)
		return
	})
	return out, total, err
}

func (s *Service) GetConversion(ctx context.Context, storeID, id uuid.UUID) (*domain.StockConversion, error) {
	var out *domain.StockConversion
	err := s.tx(ctx, storeID, func(ctx context.Context) (err error) {
		out, err = s.conversions.Get(ctx, storeID, id)
		return
	})
	return out, err
}

// PostConversion breaks FromQty packs into FromQty*factor loose units: it takes the packs out of
// stock (transfer_out), puts the units in (transfer_in) and moves the cost across, so the shop's
// stock value does not change.
func (s *Service) PostConversion(ctx context.Context, actor Actor, storeID uuid.UUID, in ConversionInput) (*domain.StockConversion, error) {
	if in.FromProductID == uuid.Nil || in.ToProductID == uuid.Nil || in.FromProductID == in.ToProductID {
		return nil, domain.ErrValidation.With("field", "product")
	}
	if in.FromQty.Sign() <= 0 {
		return nil, domain.ErrValidation.With("field", "from_qty")
	}
	at := time.Now()
	doc := &domain.StockConversion{
		StoreID: storeID, FromProductID: in.FromProductID, ToProductID: in.ToProductID,
		FromQty: in.FromQty.Round(3), Note: strings.TrimSpace(in.Note), ConvertedAt: at, CreatedBy: actor.userPtr(),
	}
	var out *domain.StockConversion
	err := s.tx(ctx, storeID, func(ctx context.Context) error {
		factor := decimal.Zero
		if in.Factor != nil {
			factor = in.Factor.Round(3)
		}
		if factor.Sign() <= 0 {
			rule, err := s.conversions.FindRule(ctx, storeID, in.FromProductID, in.ToProductID)
			if err != nil {
				return err
			}
			if rule == nil || !rule.IsActive {
				return domain.ErrConversionRuleMissing
			}
			factor = rule.Factor
		}
		if factor.Sign() <= 0 {
			return domain.ErrValidation.With("field", "factor")
		}
		doc.Factor = factor
		doc.ToQty = doc.FromQty.Mul(factor).Round(3)
		if doc.ToQty.Sign() <= 0 {
			return domain.ErrValidation.With("field", "factor")
		}

		from, err := s.stock.Snapshot(ctx, storeID, in.FromProductID)
		if err != nil {
			return err
		}
		to, err := s.stock.Snapshot(ctx, storeID, in.ToProductID)
		if err != nil {
			return err
		}
		if from.IsArchived || to.IsArchived {
			name := from.Name
			if to.IsArchived {
				name = to.Name
			}
			return domain.ErrProductArchived.With("name", name)
		}
		// you cannot break packs you do not have
		if from.StockOnHand.Sub(doc.FromQty).Sign() < 0 {
			return domain.ErrStockInsufficient.With("name", from.Name).With("stock", from.StockOnHand.String())
		}

		// the cost of the consumed packs is spread over the units they produce
		doc.TotalCost, doc.UnitCost = ConversionCost(doc.FromQty, from.CostAvg, doc.ToQty)

		docNo, err := postgres.NextDocNo(ctx, storeID, postgres.DocConversion, at)
		if err != nil {
			return err
		}
		doc.DocNo = docNo
		if err := s.conversions.Create(ctx, doc); err != nil {
			return err
		}

		packCost := from.CostAvg
		if _, err := s.stock.Apply(ctx, storeID, in.FromProductID, domain.MoveTransferOut, doc.FromQty.Neg(), &packCost,
			domain.RefConversion, &doc.ID, doc.DocNo, actor.userPtr()); err != nil {
			return err
		}
		unitCost := doc.UnitCost
		if _, err := s.stock.Apply(ctx, storeID, in.ToProductID, domain.MoveTransferIn, doc.ToQty, &unitCost,
			domain.RefConversion, &doc.ID, doc.DocNo, actor.userPtr()); err != nil {
			return err
		}
		// the produced units join the destination's moving average at that cost
		newAvg := MovingAverage(to.StockOnHand, to.CostAvg, doc.ToQty, unitCost)
		if err := s.stock.SetCosts(ctx, storeID, in.ToProductID, unitCost, newAvg); err != nil {
			return err
		}

		if in.SaveRule {
			rule := &domain.ProductConversion{StoreID: storeID, FromProductID: in.FromProductID, ToProductID: in.ToProductID,
				Factor: factor, IsActive: true, Note: doc.Note}
			if err := s.conversions.UpsertRule(ctx, rule); err != nil {
				return err
			}
		}

		if out, err = s.conversions.Get(ctx, storeID, doc.ID); err != nil {
			return err
		}
		return s.auditWrite(ctx, actor, storeID, "conversion.post", "stock_conversion", doc.ID, nil, out)
	})
	return out, err
}

// ConversionCost splits the cost of the consumed packs over the units they produce, so converting
// never changes the value of the stock on hand: 2 ลัง at ฿240 → ฿480 over 24 ขวด = ฿20 each.
func ConversionCost(fromQty, fromCostAvg, toQty decimal.Decimal) (total, unit decimal.Decimal) {
	total = fromQty.Mul(fromCostAvg).Round(4)
	if toQty.Sign() <= 0 {
		return total, decimal.Zero
	}
	return total, total.Div(toQty).Round(4)
}
