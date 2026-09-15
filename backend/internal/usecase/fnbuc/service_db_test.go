package fnbuc

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

// The one test that matters for the shop: a dish sent to the kitchen takes its ingredients off
// the shelf, by the recipe, and a void puts them back. Runs against TEST_DATABASE_URL (a
// migrated database) and skips without it.

type fixture struct {
	db      *postgres.DB
	svc     *Service
	store   uuid.UUID
	beans   uuid.UUID // stocked in grams
	milk    uuid.UUID // stocked in litres
	oatMilk uuid.UUID
	latte   uuid.UUID
	oatOpt  uuid.UUID
	shotOpt uuid.UUID
}

func setup(t *testing.T) *fixture {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	db, err := postgres.Open(ctx, url)
	require.NoError(t, err)
	t.Cleanup(db.Close)
	f := &fixture{db: db, svc: New(db, postgres.StockRepo{})}

	code := "T" + uuid.NewString()[:6]
	require.NoError(t, db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `INSERT INTO stores (code, name, kind) VALUES ($1, $2, 'fnb') RETURNING id`, code, "test café "+code).Scan(&f.store)
	}))
	t.Cleanup(func() {
		_ = db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `DELETE FROM stores WHERE id=$1`, f.store)
			return err
		})
	})

	require.NoError(t, db.WithTx(ctx, postgres.Scope{StoreID: f.store}, func(ctx context.Context, tx pgx.Tx) error {
		product := func(sku, name string, stock, cost string) uuid.UUID {
			var id uuid.UUID
			require.NoError(t, tx.QueryRow(ctx, `INSERT INTO products (store_id, sku, name, stock_on_hand, cost_avg, cost_last, sell_price) VALUES ($1,$2,$3,$4,$5,$5,0) RETURNING id`,
				f.store, sku, name, stock, cost).Scan(&id))
			return id
		}
		f.beans = product("BEANS", "เมล็ดกาแฟ", "1000", "0.9") // 1 kg of beans at ฿0.90/g
		f.milk = product("MILK", "นมสด", "10", "52")           // 10 L at ฿52/L
		f.oatMilk = product("OAT", "นมโอ๊ต", "5", "95")        // 5 L at ฿95/L

		repo := postgres.FnbRepo{}
		st := domain.KitchenStation{StoreID: f.store, Name: "บาร์", Output: domain.StationKDS, IsActive: true}
		require.NoError(t, repo.UpsertStation(ctx, &st))
		cat := domain.MenuCategory{StoreID: f.store, Name: "กาแฟ", IsActive: true}
		require.NoError(t, repo.UpsertCategory(ctx, &cat))

		milkID := f.milk
		group := domain.ModifierGroup{StoreID: f.store, Name: "นม / เพิ่ม", MinSelect: 0, MaxSelect: 2, IsActive: true, Modifiers: []domain.Modifier{
			{Name: "นมโอ๊ต", PriceDelta: decimal.NewFromInt(15), IsActive: true, Lines: []domain.RecipeLine{
				{IngredientProductID: f.oatMilk, Qty: decimal.NewFromInt(200), FactorToStock: decimal.NewFromFloat(0.001), Mode: "replace", ReplacesProductID: &milkID},
			}},
			{Name: "ช็อตเสริม", PriceDelta: decimal.NewFromInt(15), IsActive: true, Lines: []domain.RecipeLine{
				{IngredientProductID: f.beans, Qty: decimal.NewFromInt(18), FactorToStock: decimal.NewFromInt(1), WastePct: decimal.NewFromInt(5), Mode: "add"},
			}},
		}}
		require.NoError(t, repo.UpsertModifierGroup(ctx, &group))
		f.oatOpt, f.shotOpt = group.Modifiers[0].ID, group.Modifiers[1].ID

		item := domain.MenuItem{StoreID: f.store, CategoryID: &cat.ID, StationID: &st.ID, Name: "ลาเต้", Price: decimal.NewFromInt(55), IsActive: true, ModifierGroupIDs: []uuid.UUID{group.ID}}
		require.NoError(t, repo.UpsertMenuItem(ctx, &item))
		rc := domain.Recipe{StoreID: f.store, MenuItemID: item.ID, YieldQty: decimal.NewFromInt(1), Lines: []domain.RecipeLine{
			{IngredientProductID: f.beans, Qty: decimal.NewFromInt(18), FactorToStock: decimal.NewFromInt(1), WastePct: decimal.NewFromInt(5), Mode: "add"},
			{IngredientProductID: f.milk, Qty: decimal.NewFromInt(200), FactorToStock: decimal.NewFromFloat(0.001), Mode: "add"},
		}}
		require.NoError(t, repo.UpsertRecipe(ctx, &rc))
		f.latte = item.ID
		return nil
	}))
	return f
}

func (f *fixture) stock(t *testing.T, id uuid.UUID) string {
	t.Helper()
	var s string
	require.NoError(t, f.db.WithTx(context.Background(), postgres.Scope{StoreID: f.store}, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT stock_on_hand::text FROM products WHERE id=$1`, id).Scan(&s)
	}))
	return decimal.RequireFromString(s).StringFixed(3)
}

func (f *fixture) movements(t *testing.T, itemID uuid.UUID) []string {
	t.Helper()
	var out []string
	require.NoError(t, f.db.WithTx(context.Background(), postgres.Scope{StoreID: f.store}, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT move_type::text || ' ' || qty_delta::text FROM stock_movements WHERE ref_type=$1 AND ref_id=$2 ORDER BY id`, domain.RefOrderItem, itemID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var s string
			if err := rows.Scan(&s); err != nil {
				return err
			}
			out = append(out, s)
		}
		return rows.Err()
	}))
	return out
}

func TestSendingADishTakesItsRecipeOffStock(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	actor := Actor{Name: "test"}

	// the menu the till gets says when stock moves
	menu, err := f.svc.Menu(ctx, f.store, true)
	require.NoError(t, err)
	require.Equal(t, domain.DeductOnSend, menu.DeductOn)
	require.Len(t, menu.Items, 1)
	require.NotNil(t, menu.Items[0].Recipe)
	require.Len(t, menu.Items[0].Recipe.Lines, 2)

	// the kitchen's screen is listening before the order is placed
	subCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	events := f.svc.Subscribe(subCtx, f.store)

	// two lattes, one of them with oat milk and an extra shot
	order, err := f.svc.CreateOrder(ctx, f.store, actor, CreateOrderInput{Channel: domain.ChannelCounter, Lines: []LineInput{
		{MenuItemID: f.latte, Qty: decimal.NewFromInt(1)},
		{MenuItemID: f.latte, Qty: decimal.NewFromInt(1), ModifierIDs: []uuid.UUID{f.oatOpt, f.shotOpt}},
	}})
	require.NoError(t, err)
	require.Equal(t, 1, order.OrderNo, "first order of the day")
	require.Len(t, order.Items, 2)
	require.True(t, order.Items[0].Deducted)
	require.True(t, order.Items[1].Deducted)

	// and hears about it with the whole order attached, nothing to fetch
	select {
	case ev := <-events:
		require.Equal(t, "created", ev.Kind)
		require.Equal(t, order.ID, ev.Order.ID)
		require.Len(t, ev.Order.Items, 2)
	case <-time.After(2 * time.Second):
		t.Fatal("no event reached the subscriber")
	}

	// plain latte: 18 g × 1.05 = 18.9 g beans, 200 ml milk
	// oat latte + shot: 18.9 + 18.9 g beans, 0 milk, 200 ml oat milk
	require.Equal(t, "943.300", f.stock(t, f.beans), "1000 − 18.9 − 37.8")
	require.Equal(t, "9.800", f.stock(t, f.milk), "only the plain latte took milk")
	require.Equal(t, "4.800", f.stock(t, f.oatMilk))

	// each line is priced at what it took: 18.9×0.9 + 0.2×52 = 27.41; 37.8×0.9 + 0.2×95 = 53.02
	require.Equal(t, "27.41", order.Items[0].Cost.StringFixed(2))
	require.Equal(t, "53.02", order.Items[1].Cost.StringFixed(2))
	// and sold at menu price plus the options
	require.Equal(t, "55.00", order.Items[0].LineTotal().StringFixed(2))
	require.Equal(t, "85.00", order.Items[1].LineTotal().StringFixed(2))

	// the movements name the order line, so an ingredient report can point at the cup
	require.Equal(t, []string{"recipe -18.900", "recipe -0.200"}, f.movements(t, order.Items[0].ID))

	// the kitchen works the second cup through to served; stock does not move again
	for _, st := range []domain.ItemStatus{domain.ItemPreparing, domain.ItemReady, domain.ItemServed} {
		_, err = f.svc.SetItemStatus(ctx, f.store, actor, order.ID, order.Items[1].ID, st, false)
		require.NoError(t, err)
	}
	require.Equal(t, "943.300", f.stock(t, f.beans))

	// the first cup is voided before it was made: everything goes back on the shelf
	_, err = f.svc.SetItemStatus(ctx, f.store, actor, order.ID, order.Items[0].ID, domain.ItemVoid, false)
	require.NoError(t, err)
	require.Equal(t, "962.200", f.stock(t, f.beans), "943.3 + 18.9")
	require.Equal(t, "10.000", f.stock(t, f.milk))
	require.Equal(t, []string{"recipe -18.900", "recipe -0.200", "recipe 18.900", "recipe 0.200"}, f.movements(t, order.Items[0].ID))

	// a second order the same day is number 2
	again, err := f.svc.CreateOrder(ctx, f.store, actor, CreateOrderInput{Channel: domain.ChannelDineIn, TableCode: "5", Lines: []LineInput{{MenuItemID: f.latte, Qty: decimal.NewFromInt(2)}}})
	require.NoError(t, err)
	require.Equal(t, 2, again.OrderNo)
	require.Equal(t, "924.400", f.stock(t, f.beans), "962.2 − 2 × 18.9")

	// the kitchen's list shows both, oldest first
	open, err := f.svc.List(ctx, f.store, true, order.CreatedAt.Add(-1), 50)
	require.NoError(t, err)
	require.Len(t, open, 2)
	require.Equal(t, "5", open[1].TableCode)
}

func TestOrderRejectsWhatTheMenuDoesNotAllow(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	actor := Actor{Name: "test"}

	_, err := f.svc.CreateOrder(ctx, f.store, actor, CreateOrderInput{Channel: domain.ChannelCounter})
	require.ErrorIs(t, err, domain.ErrOrderEmpty)

	_, err = f.svc.CreateOrder(ctx, f.store, actor, CreateOrderInput{Channel: "phone", Lines: []LineInput{{MenuItemID: f.latte, Qty: decimal.NewFromInt(1)}}})
	require.ErrorIs(t, err, domain.ErrValidation)

	_, err = f.svc.CreateOrder(ctx, f.store, actor, CreateOrderInput{Channel: domain.ChannelCounter, Lines: []LineInput{{MenuItemID: uuid.New(), Qty: decimal.NewFromInt(1)}}})
	require.ErrorIs(t, err, domain.ErrMenuItemNotFound)

	// three options from a group that allows two
	_, err = f.svc.CreateOrder(ctx, f.store, actor, CreateOrderInput{Channel: domain.ChannelCounter, Lines: []LineInput{{MenuItemID: f.latte, Qty: decimal.NewFromInt(1), ModifierIDs: []uuid.UUID{f.oatOpt, f.shotOpt, f.shotOpt}}}})
	require.ErrorIs(t, err, domain.ErrModifierInvalid)

	// nothing moved
	require.Equal(t, "1000.000", f.stock(t, f.beans))
}
