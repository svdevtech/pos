// Package fnbuc is the restaurant / café side of the POS: menus, recipes, orders, kitchen.
//
// This file is the recipe arithmetic on its own, with no database in sight, so the numbers a
// shop sees on its stock can be reasoned about and tested line by line. Persisting the result
// (writing stock_movements of type `recipe`) is the caller's job.
package fnbuc

import (
	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
)

// LineMode says what a modifier's ingredient line does to the dish's own recipe.
type LineMode string

const (
	// LineAdd puts the ingredient on top of the recipe (an extra shot: +18 g of beans).
	LineAdd LineMode = "add"
	// LineReplace stands in for the recipe's line for ReplacesID (oat milk instead of fresh milk).
	LineReplace LineMode = "replace"
)

// RecipeLine is one ingredient of a recipe or of a modifier.
//
// Qty is in whatever unit the cook thinks in; FactorToStock turns it into the unit the
// ingredient's stock is counted in. 200 ml of milk that is stocked by the litre is Qty 200 with
// FactorToStock 0.001. WastePct is the allowance for what does not make it into the cup.
type RecipeLine struct {
	IngredientID  uuid.UUID
	Qty           decimal.Decimal
	FactorToStock decimal.Decimal
	WastePct      decimal.Decimal
	Mode          LineMode
	ReplacesID    *uuid.UUID
}

// Recipe is what one menu item is made of. YieldQty is how many sell units it makes: 1 for a
// latte, 10 for a pot of soup that fills ten bowls.
type Recipe struct {
	YieldQty decimal.Decimal
	Lines    []RecipeLine
}

// Deduction is what comes off one ingredient's stock, in that ingredient's stock unit.
type Deduction struct {
	ProductID uuid.UUID
	Qty       decimal.Decimal
}

// stockQtyPerUnit is what one sell unit of the dish takes of the line's ingredient, in stock units.
func stockQtyPerUnit(l RecipeLine, yield decimal.Decimal) decimal.Decimal {
	factor := l.FactorToStock
	if factor.IsZero() {
		factor = decimal.NewFromInt(1)
	}
	waste := decimal.NewFromInt(1).Add(l.WastePct.Div(decimal.NewFromInt(100)))
	return l.Qty.Mul(factor).Mul(waste).Div(yield)
}

// Explode turns "orderQty of this dish with these modifiers" into the stock to take off each
// ingredient. Modifiers are given per chosen option; a `replace` line drops the recipe's own
// lines for the ingredient it replaces before adding its own.
//
// Quantities are rounded to 3 dp, the precision stock is kept at, and ingredients that round to
// nothing are left out — a pinch of salt on a 10-bowl pot is not a movement worth recording.
func Explode(orderQty decimal.Decimal, r Recipe, modifiers [][]RecipeLine) ([]Deduction, error) {
	if !orderQty.IsPositive() {
		return nil, domain.ErrValidation.With("field", "qty")
	}
	if !r.YieldQty.IsPositive() {
		return nil, domain.ErrValidation.With("field", "recipe.yield_qty")
	}
	for _, l := range r.Lines {
		if l.Qty.IsNegative() {
			return nil, domain.ErrValidation.With("field", "recipe.lines.qty")
		}
	}

	// the dish's own lines, per sell unit; replaced ingredients are dropped wholesale
	replaced := map[uuid.UUID]bool{}
	for _, opt := range modifiers {
		for _, l := range opt {
			if l.Mode == LineReplace && l.ReplacesID != nil {
				replaced[*l.ReplacesID] = true
			}
		}
	}
	perUnit := map[uuid.UUID]decimal.Decimal{}
	order := []uuid.UUID{} // stable output order: recipe lines first, then modifiers, as written
	add := func(id uuid.UUID, q decimal.Decimal) {
		if _, seen := perUnit[id]; !seen {
			order = append(order, id)
		}
		perUnit[id] = perUnit[id].Add(q)
	}
	for _, l := range r.Lines {
		if replaced[l.IngredientID] {
			continue
		}
		add(l.IngredientID, stockQtyPerUnit(l, r.YieldQty))
	}
	// a modifier's lines are per sell unit already: an extra shot is an extra shot per cup
	for _, opt := range modifiers {
		for _, l := range opt {
			if l.Qty.IsNegative() {
				return nil, domain.ErrValidation.With("field", "modifier.lines.qty")
			}
			add(l.IngredientID, stockQtyPerUnit(l, decimal.NewFromInt(1)))
		}
	}

	out := make([]Deduction, 0, len(order))
	for _, id := range order {
		q := perUnit[id].Mul(orderQty).Round(3)
		if q.IsZero() {
			continue
		}
		out = append(out, Deduction{ProductID: id, Qty: q})
	}
	return out, nil
}

// Cost prices a set of deductions at the ingredients' average cost, rounded to money. Ingredients
// with no known cost count as free rather than failing — a new ingredient with no receipt yet
// must not stop a dish from being sold.
func Cost(deds []Deduction, costAvg map[uuid.UUID]decimal.Decimal) decimal.Decimal {
	total := decimal.Zero
	for _, d := range deds {
		if c, ok := costAvg[d.ProductID]; ok {
			total = total.Add(d.Qty.Mul(c))
		}
	}
	return domain.Money(total)
}
