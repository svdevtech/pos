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
	"github.com/svdev/pos/internal/usecase/salesuc"
)

// Paying for a table's orders cuts one bill in the sales module: every line at the price the
// order carried, the service charge the shop set, cash rounding and change as at the till — and
// the ingredients, already taken when the dishes were sent, do not move again.
func TestCheckoutPostsOneBillForTheTable(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	actor := Actor{Name: "test"}

	require.NoError(t, f.db.WithTx(ctx, postgres.Scope{StoreID: f.store}, func(ctx context.Context, _ pgx.Tx) error {
		return postgres.StoreRepo{}.PutSettings(ctx, f.store, domain.StoreSettings{"fnb": map[string]any{"service_charge_pct": 10.0, "vat_mode": "included", "vat_pct": 7.0}})
	}))

	line := []LineInput{{MenuItemID: f.latte, Qty: decimal.NewFromInt(1)}}
	o1, err := f.svc.CreateOrder(ctx, f.store, actor, CreateOrderInput{Channel: domain.ChannelDineIn, TableCode: "9", Lines: line})
	require.NoError(t, err)
	o2, err := f.svc.CreateOrder(ctx, f.store, actor, CreateOrderInput{Channel: domain.ChannelDineIn, TableCode: "9", Lines: []LineInput{{MenuItemID: f.latte, Qty: decimal.NewFromInt(2), ModifierIDs: []uuid.UUID{f.shotOpt}}}})
	require.NoError(t, err)
	require.Equal(t, "905.500", f.stock(t, f.beans)) // 3 lattes (18.9 g each) + 2 extra shots (18.9 g each), sent to the bar

	q, err := f.svc.Quote(ctx, f.store, []uuid.UUID{o1.ID, o2.ID})
	require.NoError(t, err)
	require.Equal(t, "195.00", q.Subtotal.StringFixed(2)) // 55 + 2 × (55 + 15)
	require.Equal(t, "19.50", q.ServiceCharge.StringFixed(2))
	require.Equal(t, "214.50", q.Net.StringFixed(2))
	require.Equal(t, "14.03", q.VAT.StringFixed(2)) // the tax inside 214.50 at 7 %

	sale, err := f.svc.Checkout(ctx, f.store, actor, CheckoutInput{
		OrderIDs: []uuid.UUID{o1.ID, o2.ID},
		Payments: []salesuc.Tender{{Method: domain.PayCash, Amount: decimal.NewFromInt(300)}},
	})
	require.NoError(t, err)
	require.Equal(t, "214.50", sale.Net.StringFixed(2))
	require.Equal(t, "85.50", sale.Change.StringFixed(2))
	require.Equal(t, "14.03", sale.VAT.StringFixed(2))
	require.Len(t, sale.Lines, 3) // latte, latte+shot, service charge
	require.Equal(t, "ลาเต้ (ช็อตเสริม)", sale.Lines[1].Description)
	require.Equal(t, "70.00", sale.Lines[1].UnitPrice.StringFixed(2))
	require.Nil(t, sale.Lines[0].ProductID)
	require.Contains(t, sale.Note, "table 9")
	require.Equal(t, "905.500", f.stock(t, f.beans), "the bill must not take the beans a second time")

	// both orders are paid and point at the bill; the table is still theirs until it is closed
	for _, id := range []uuid.UUID{o1.ID, o2.ID} {
		o, err := f.svc.Get(ctx, f.store, id)
		require.NoError(t, err)
		require.Equal(t, domain.OrderPaid, o.Status)
		require.NotNil(t, o.SaleID)
		require.Equal(t, sale.ID, *o.SaleID)
	}
	// and cannot be paid twice
	_, err = f.svc.Checkout(ctx, f.store, actor, CheckoutInput{OrderIDs: []uuid.UUID{o1.ID}, Payments: []salesuc.Tender{{Method: domain.PayCash, Amount: decimal.NewFromInt(300)}}})
	require.ErrorIs(t, err, domain.ErrOrderClosed)
}

// A café order paid at the counter closes itself once its last drink is handed over.
func TestPaidCounterOrderClosesWhenServed(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	actor := Actor{Name: "test"}

	o, err := f.svc.CreateOrder(ctx, f.store, actor, CreateOrderInput{Channel: domain.ChannelCounter, Lines: []LineInput{{MenuItemID: f.latte, Qty: decimal.NewFromInt(1)}}})
	require.NoError(t, err)
	sale, err := f.svc.Checkout(ctx, f.store, actor, CheckoutInput{OrderIDs: []uuid.UUID{o.ID}, Payments: []salesuc.Tender{{Method: domain.PayTransfer, Amount: decimal.NewFromInt(55)}}})
	require.NoError(t, err)
	require.Equal(t, "55.00", sale.Net.StringFixed(2))

	cur, err := f.svc.Get(ctx, f.store, o.ID)
	require.NoError(t, err)
	require.Equal(t, domain.OrderPaid, cur.Status)

	cur, err = f.svc.SetItemStatus(ctx, f.store, actor, o.ID, cur.Items[0].ID, domain.ItemServed, false)
	require.NoError(t, err)
	require.Equal(t, domain.OrderClosed, cur.Status)
}
