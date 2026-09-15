package fnbuc

import (
	"testing"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"
)

func d(s string) decimal.Decimal { return decimal.RequireFromString(s) }

var (
	beans   = uuid.New() // stocked in grams
	milk    = uuid.New() // stocked in litres
	oatMilk = uuid.New() // stocked in litres
	syrup   = uuid.New() // stocked in millilitres
	pork    = uuid.New() // stocked in kg
	salt    = uuid.New() // stocked in kg
)

// The latte every café sells: 18 g of beans with 5 % wasted in the grinder, 200 ml of milk.
func latte() Recipe {
	return Recipe{
		YieldQty: d("1"),
		Lines: []RecipeLine{
			{IngredientID: beans, Qty: d("18"), FactorToStock: d("1"), WastePct: d("5"), Mode: LineAdd},
			{IngredientID: milk, Qty: d("200"), FactorToStock: d("0.001"), Mode: LineAdd},
		},
	}
}

func find(t *testing.T, deds []Deduction, id uuid.UUID) decimal.Decimal {
	t.Helper()
	for _, x := range deds {
		if x.ProductID == id {
			return x.Qty
		}
	}
	t.Fatalf("no deduction for %s", id)
	return decimal.Zero
}

func TestExplodeOneLatte(t *testing.T) {
	deds, err := Explode(d("1"), latte(), nil)
	require.NoError(t, err)
	require.Len(t, deds, 2)
	// 18 g × 1.05 waste = 18.9 g
	require.Equal(t, "18.900", find(t, deds, beans).StringFixed(3))
	// 200 ml of milk stocked by the litre
	require.Equal(t, "0.200", find(t, deds, milk).StringFixed(3))
	// output keeps the recipe's own order so a kitchen printout reads like the recipe card
	require.Equal(t, beans, deds[0].ProductID)
	require.Equal(t, milk, deds[1].ProductID)
}

func TestExplodeScalesWithOrderQty(t *testing.T) {
	deds, err := Explode(d("3"), latte(), nil)
	require.NoError(t, err)
	require.Equal(t, "56.700", find(t, deds, beans).StringFixed(3))
	require.Equal(t, "0.600", find(t, deds, milk).StringFixed(3))
}

func TestExplodeModifierAddsOnTop(t *testing.T) {
	extraShot := []RecipeLine{{IngredientID: beans, Qty: d("18"), FactorToStock: d("1"), WastePct: d("5"), Mode: LineAdd}}
	deds, err := Explode(d("2"), latte(), [][]RecipeLine{extraShot})
	require.NoError(t, err)
	// (18.9 + 18.9) × 2 cups
	require.Equal(t, "75.600", find(t, deds, beans).StringFixed(3))
	require.Equal(t, "0.400", find(t, deds, milk).StringFixed(3))
}

func TestExplodeModifierReplacesAnIngredient(t *testing.T) {
	m := milk
	oat := []RecipeLine{{IngredientID: oatMilk, Qty: d("200"), FactorToStock: d("0.001"), Mode: LineReplace, ReplacesID: &m}}
	deds, err := Explode(d("1"), latte(), [][]RecipeLine{oat})
	require.NoError(t, err)
	require.Len(t, deds, 2)
	require.Equal(t, "18.900", find(t, deds, beans).StringFixed(3))
	require.Equal(t, "0.200", find(t, deds, oatMilk).StringFixed(3))
	// fresh milk is gone entirely, not merely reduced
	for _, x := range deds {
		require.NotEqual(t, milk, x.ProductID, "fresh milk must not be deducted when oat milk replaces it")
	}
}

func TestExplodeTwoModifiersTogether(t *testing.T) {
	m := milk
	oat := []RecipeLine{{IngredientID: oatMilk, Qty: d("200"), FactorToStock: d("0.001"), Mode: LineReplace, ReplacesID: &m}}
	vanilla := []RecipeLine{{IngredientID: syrup, Qty: d("15"), FactorToStock: d("1"), Mode: LineAdd}}
	deds, err := Explode(d("1"), latte(), [][]RecipeLine{oat, vanilla})
	require.NoError(t, err)
	require.Len(t, deds, 3)
	require.Equal(t, "15.000", find(t, deds, syrup).StringFixed(3))
}

// A pot of soup makes ten bowls; ordering three bowls takes three tenths of the pot's ingredients.
func TestExplodeBatchYield(t *testing.T) {
	pot := Recipe{
		YieldQty: d("10"),
		Lines: []RecipeLine{
			{IngredientID: pork, Qty: d("1.5"), FactorToStock: d("1"), Mode: LineAdd},
			{IngredientID: salt, Qty: d("20"), FactorToStock: d("0.001"), Mode: LineAdd},
		},
	}
	deds, err := Explode(d("3"), pot, nil)
	require.NoError(t, err)
	require.Equal(t, "0.450", find(t, deds, pork).StringFixed(3))
	// 20 g of salt over ten bowls is 2 g a bowl = 0.006 kg for three bowls: still recorded
	require.Equal(t, "0.006", find(t, deds, salt).StringFixed(3))
}

func TestExplodeDropsWhatRoundsToNothing(t *testing.T) {
	pot := Recipe{
		YieldQty: d("100"),
		Lines:    []RecipeLine{{IngredientID: salt, Qty: d("1"), FactorToStock: d("0.001"), Mode: LineAdd}},
	}
	// 1 g of salt across 100 bowls is 0.00001 kg per bowl: not a stock movement
	deds, err := Explode(d("1"), pot, nil)
	require.NoError(t, err)
	require.Empty(t, deds)
}

func TestExplodeDefaultsAMissingFactorToOne(t *testing.T) {
	r := Recipe{YieldQty: d("1"), Lines: []RecipeLine{{IngredientID: beans, Qty: d("18"), Mode: LineAdd}}}
	deds, err := Explode(d("1"), r, nil)
	require.NoError(t, err)
	require.Equal(t, "18.000", find(t, deds, beans).StringFixed(3))
}

func TestExplodeRejectsBadInput(t *testing.T) {
	_, err := Explode(d("0"), latte(), nil)
	require.Error(t, err, "nothing ordered")
	_, err = Explode(d("-1"), latte(), nil)
	require.Error(t, err, "negative order")
	_, err = Explode(d("1"), Recipe{YieldQty: d("0"), Lines: latte().Lines}, nil)
	require.Error(t, err, "a recipe that yields nothing would divide by zero")
	bad := latte()
	bad.Lines[0].Qty = d("-18")
	_, err = Explode(d("1"), bad, nil)
	require.Error(t, err, "negative ingredient")
}

func TestCostPricesAtAverageCostAndForgivesUnknowns(t *testing.T) {
	deds, err := Explode(d("1"), latte(), nil)
	require.NoError(t, err)
	// beans ฿0.90/g, milk ฿52/L; 18.9 × 0.9 + 0.2 × 52 = 17.01 + 10.40
	cost := Cost(deds, map[uuid.UUID]decimal.Decimal{beans: d("0.9"), milk: d("52")})
	require.Equal(t, "27.41", cost.StringFixed(2))
	// an ingredient with no receipt yet costs nothing rather than stopping the sale
	cost = Cost(deds, map[uuid.UUID]decimal.Decimal{beans: d("0.9")})
	require.Equal(t, "17.01", cost.StringFixed(2))
}
