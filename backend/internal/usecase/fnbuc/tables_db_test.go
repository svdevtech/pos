package fnbuc

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

func (f *fixture) table(t *testing.T, code string) {
	t.Helper()
	_, err := f.svc.SaveTable(context.Background(), f.store, domain.FloorTable{Code: code, Seats: 4, X: decimal.NewFromInt(1), Y: decimal.NewFromInt(1), Shape: "square", IsActive: true})
	require.NoError(t, err)
}

// A party moves from table 3 to table 7: their orders go with them, table 3 gets a fresh QR code.
// Moving onto an occupied table merges the two.
func TestMoveTableTakesTheOrdersAlongAndFreesTheOldOne(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	actor := Actor{Name: "test"}
	f.table(t, "3")
	f.table(t, "7")
	line := []LineInput{{MenuItemID: f.latte, Qty: decimal.NewFromInt(1)}}

	o3, err := f.svc.CreateOrder(ctx, f.store, actor, CreateOrderInput{Channel: domain.ChannelDineIn, TableCode: "3", Lines: line})
	require.NoError(t, err)
	o7, err := f.svc.CreateOrder(ctx, f.store, actor, CreateOrderInput{Channel: domain.ChannelDineIn, TableCode: "7", Lines: line})
	require.NoError(t, err)
	toks, err := f.svc.TableTokens(ctx, f.store, nil)
	require.NoError(t, err)
	before := map[string]string{}
	for _, tk := range toks {
		before[tk.TableCode] = tk.Token
	}

	_, err = f.svc.MoveTable(ctx, f.store, actor, "3", "99")
	require.ErrorIs(t, err, domain.ErrTableNotFound)

	moved, err := f.svc.MoveTable(ctx, f.store, actor, "3", "7")
	require.NoError(t, err)
	require.Len(t, moved, 1)
	require.Equal(t, "7", moved[0].TableCode)

	cur, err := f.svc.Get(ctx, f.store, o3.ID)
	require.NoError(t, err)
	require.Equal(t, "7", cur.TableCode)
	q, err := f.svc.Quote(ctx, f.store, []uuid.UUID{o3.ID, o7.ID})
	require.NoError(t, err)
	require.Equal(t, "110.00", q.Net.StringFixed(2), "both orders now sit on table 7")

	toks, err = f.svc.TableTokens(ctx, f.store, nil)
	require.NoError(t, err)
	for _, tk := range toks {
		switch tk.TableCode {
		case "3":
			require.NotEqual(t, before["3"], tk.Token, "the freed table gets a new code")
		case "7":
			require.Equal(t, before["7"], tk.Token, "the target table keeps its code")
		}
	}
	_, err = f.svc.MoveTable(ctx, f.store, actor, "3", "7")
	require.ErrorIs(t, err, domain.ErrTableEmpty)
}

// Splitting a bill moves whole lines to a new order on the same table; each pays on its own.
func TestSplitOrderMovesLinesToANewOrder(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	actor := Actor{Name: "test"}
	f.table(t, "5")

	o, err := f.svc.CreateOrder(ctx, f.store, actor, CreateOrderInput{Channel: domain.ChannelDineIn, TableCode: "5", Lines: []LineInput{
		{MenuItemID: f.latte, Qty: decimal.NewFromInt(1)},
		{MenuItemID: f.latte, Qty: decimal.NewFromInt(1), ModifierIDs: []uuid.UUID{f.shotOpt}},
		{MenuItemID: f.latte, Qty: decimal.NewFromInt(2)},
	}})
	require.NoError(t, err)
	require.Len(t, o.Items, 3)

	_, err = f.svc.SplitOrder(ctx, f.store, actor, o.ID, []SplitLine{{ItemID: o.Items[0].ID}, {ItemID: o.Items[1].ID}, {ItemID: o.Items[2].ID}})
	require.ErrorIs(t, err, domain.ErrValidation, "cannot take every line")
	_, err = f.svc.SplitOrder(ctx, f.store, actor, o.ID, []SplitLine{{ItemID: uuid.New()}})
	require.ErrorIs(t, err, domain.ErrOrderNotFound)

	part, err := f.svc.SplitOrder(ctx, f.store, actor, o.ID, []SplitLine{{ItemID: o.Items[1].ID}})
	require.NoError(t, err)
	require.Equal(t, "5", part.TableCode)
	require.Len(t, part.Items, 1)
	require.Equal(t, o.Items[1].ID, part.Items[0].ID, "the line itself moved, with its stock movements")
	require.True(t, part.Items[0].Deducted)

	rest, err := f.svc.Get(ctx, f.store, o.ID)
	require.NoError(t, err)
	require.Len(t, rest.Items, 2)

	q, err := f.svc.Quote(ctx, f.store, []uuid.UUID{part.ID})
	require.NoError(t, err)
	require.Equal(t, "70.00", q.Net.StringFixed(2))
	q, err = f.svc.Quote(ctx, f.store, []uuid.UUID{o.ID})
	require.NoError(t, err)
	require.Equal(t, "165.00", q.Net.StringFixed(2))
}

// With the setting on, a QR order needs a table staff opened; opening it is an order with no
// lines, and closing that later frees the table like any other.
func TestQrOrdersCanRequireAnOpenedTable(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	actor := Actor{Name: "test"}
	f.table(t, "4")
	require.NoError(t, f.db.WithTx(ctx, postgres.Scope{StoreID: f.store}, func(ctx context.Context, tx pgx.Tx) error {
		if err := (postgres.StoreRepo{}).PutSettings(ctx, f.store, domain.StoreSettings{"fnb": map[string]any{"qr_requires_open_table": true}}); err != nil {
			return err
		}
		// the latte may be ordered from the phone
		item := domain.MenuItem{ID: f.latte, StoreID: f.store, Name: "ลาเต้", Price: decimal.NewFromInt(55), IsActive: true, Channels: []string{"counter", "dine_in", "self_order"}}
		return (postgres.FnbRepo{}).UpsertMenuItem(ctx, &item)
	}))
	toks, err := f.svc.TableTokens(ctx, f.store, nil)
	require.NoError(t, err)
	var token string
	for _, tk := range toks {
		if tk.TableCode == "4" {
			token = tk.Token
		}
	}
	require.NotEmpty(t, token)

	view, err := f.svc.TableByToken(ctx, token)
	require.NoError(t, err)
	require.True(t, view.RequiresOpen)
	require.False(t, view.Open)
	_, err = f.svc.TableCreateOrder(ctx, token, []LineInput{{MenuItemID: f.latte, Qty: decimal.NewFromInt(1)}}, "")
	require.ErrorIs(t, err, domain.ErrTableNotOpen)

	// an order with no lines is refused unless it is opening a table
	_, err = f.svc.CreateOrder(ctx, f.store, actor, CreateOrderInput{Channel: domain.ChannelDineIn, TableCode: "4"})
	require.ErrorIs(t, err, domain.ErrOrderEmpty)
	seat, err := f.svc.CreateOrder(ctx, f.store, actor, CreateOrderInput{Channel: domain.ChannelDineIn, TableCode: "4", Guests: 2, OpenTable: true})
	require.NoError(t, err)
	require.Empty(t, seat.Items)

	view, err = f.svc.TableByToken(ctx, token)
	require.NoError(t, err)
	require.True(t, view.Open)
	o, err := f.svc.TableCreateOrder(ctx, token, []LineInput{{MenuItemID: f.latte, Qty: decimal.NewFromInt(1)}}, "")
	require.NoError(t, err)
	require.Equal(t, "4", o.TableCode)
}
