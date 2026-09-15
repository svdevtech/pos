package fnbuc

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
	"github.com/svdev/pos/internal/usecase/salesuc"
)

// A running promotion prices the menu and the lines placed while it runs; the list price and
// the promotion's name travel with the line onto the bill.
func TestHappyHourPricesTheMenuAndTheOrder(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	actor := Actor{Name: "test"}

	// a promotion that runs right now, every day, on the latte's category
	menu, err := f.svc.Menu(ctx, f.store, true)
	require.NoError(t, err)
	var latte domain.MenuItem
	for _, it := range menu.Items {
		if it.ID == f.latte {
			latte = it
		}
	}
	require.NotNil(t, latte.CategoryID)
	require.Nil(t, latte.PromoPrice)

	now := time.Now().In(postgres.Bangkok())
	promo, err := f.svc.SavePromo(ctx, f.store, domain.MenuPromo{Name: "Happy hour", Kind: domain.PromoPercent, Value: decimal.NewFromInt(20), CategoryID: latte.CategoryID,
		StartTime: now.Add(-time.Hour).Format("15:04"), EndTime: now.Add(time.Hour).Format("15:04"), IsActive: true})
	require.NoError(t, err)
	// and one that is over for the day: it must not win
	_, err = f.svc.SavePromo(ctx, f.store, domain.MenuPromo{Name: "Breakfast", Kind: domain.PromoPrice, Value: decimal.NewFromInt(10), MenuItemID: &f.latte, StartTime: "00:00", EndTime: "00:01", IsActive: true})
	require.NoError(t, err)

	menu, err = f.svc.Menu(ctx, f.store, true)
	require.NoError(t, err)
	for _, it := range menu.Items {
		if it.ID == f.latte {
			require.NotNil(t, it.PromoPrice)
			require.Equal(t, "44.00", it.PromoPrice.StringFixed(2)) // 55 − 20 %
			require.Equal(t, "Happy hour", it.PromoName)
		}
	}

	o, err := f.svc.CreateOrder(ctx, f.store, actor, CreateOrderInput{Channel: domain.ChannelCounter, Lines: []LineInput{{MenuItemID: f.latte, Qty: decimal.NewFromInt(2)}}})
	require.NoError(t, err)
	require.Equal(t, "44.00", o.Items[0].UnitPrice.StringFixed(2))
	require.Equal(t, "55.00", o.Items[0].ListPrice.StringFixed(2))
	require.Equal(t, promo.ID, *o.Items[0].PromoID)
	q, err := f.svc.Quote(ctx, f.store, []uuid.UUID{o.ID})
	require.NoError(t, err)
	require.Equal(t, "88.00", q.Net.StringFixed(2))

	// invalid promotions are refused
	_, err = f.svc.SavePromo(ctx, f.store, domain.MenuPromo{Name: "x", Kind: domain.PromoPercent, Value: decimal.NewFromInt(120), MenuItemID: &f.latte})
	require.ErrorIs(t, err, domain.ErrValidation)
	_, err = f.svc.SavePromo(ctx, f.store, domain.MenuPromo{Name: "x", Kind: domain.PromoAmount, Value: decimal.NewFromInt(5)})
	require.ErrorIs(t, err, domain.ErrValidation, "needs an item or a category")
}

// Part of a line's quantity can be split off: 1 of 3 lattes becomes its own line on the new
// order, the cost goes pro rata, the original keeps 2.
func TestSplitOrderCanTakePartOfALine(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	actor := Actor{Name: "test"}
	f.table(t, "2")

	o, err := f.svc.CreateOrder(ctx, f.store, actor, CreateOrderInput{Channel: domain.ChannelDineIn, TableCode: "2", Lines: []LineInput{{MenuItemID: f.latte, Qty: decimal.NewFromInt(3), ModifierIDs: []uuid.UUID{f.shotOpt}}}})
	require.NoError(t, err)
	line := o.Items[0]
	cost := line.Cost

	part, err := f.svc.SplitOrder(ctx, f.store, actor, o.ID, []SplitLine{{ItemID: line.ID, Qty: decimal.NewFromInt(1)}})
	require.NoError(t, err)
	require.Len(t, part.Items, 1)
	require.Equal(t, "1.000", part.Items[0].Qty.StringFixed(3))
	require.Len(t, part.Items[0].Modifiers, 1, "the options come along")
	require.Equal(t, cost.Div(decimal.NewFromInt(3)).Round(2).StringFixed(2), part.Items[0].Cost.StringFixed(2))
	require.True(t, part.Items[0].Deducted)

	rest, err := f.svc.Get(ctx, f.store, o.ID)
	require.NoError(t, err)
	require.Equal(t, "2.000", rest.Items[0].Qty.StringFixed(3))
	require.Equal(t, cost.Sub(part.Items[0].Cost).StringFixed(2), rest.Items[0].Cost.StringFixed(2))

	q, err := f.svc.Quote(ctx, f.store, []uuid.UUID{part.ID})
	require.NoError(t, err)
	require.Equal(t, "70.00", q.Net.StringFixed(2))
}

// A booking is seated on a table: the reservation says so and the table is opened for the party.
func TestSeatingAReservationOpensTheTable(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	actor := Actor{Name: "test"}
	f.table(t, "12")

	r, err := f.svc.SaveReservation(ctx, f.store, actor, domain.Reservation{Kind: domain.ReservationBooked, Name: "คุณสมชาย", Phone: "0812345678", PartySize: 4, At: time.Now().Add(2 * time.Hour)})
	require.NoError(t, err)
	require.Equal(t, "booked", r.Status)
	w, err := f.svc.SaveReservation(ctx, f.store, actor, domain.Reservation{Kind: domain.ReservationWaitlist, Name: "walk-in", PartySize: 2})
	require.NoError(t, err)
	require.Equal(t, "waiting", w.Status)

	list, err := f.svc.Reservations(ctx, f.store, time.Now())
	require.NoError(t, err)
	require.Len(t, list, 2)

	seated, err := f.svc.SetReservationStatus(ctx, f.store, actor, r.ID, "seated", "12")
	require.NoError(t, err)
	require.Equal(t, "seated", seated.Status)
	require.Equal(t, "12", seated.TableCode)
	n, err := f.svc.liveOrders(ctx, f.store, "12")
	require.NoError(t, err)
	require.Equal(t, 1, n, "the table was opened for the party")

	_, err = f.svc.SetReservationStatus(ctx, f.store, actor, w.ID, "gone", "")
	require.ErrorIs(t, err, domain.ErrValidation)
}

// The menu report classifies dishes and the ingredient report shows what the kitchen used.
func TestMenuAndIngredientReports(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	actor := Actor{Name: "test"}

	o, err := f.svc.CreateOrder(ctx, f.store, actor, CreateOrderInput{Channel: domain.ChannelCounter, Lines: []LineInput{{MenuItemID: f.latte, Qty: decimal.NewFromInt(2)}}})
	require.NoError(t, err)
	_, err = f.svc.Checkout(ctx, f.store, actor, CheckoutInput{OrderIDs: []uuid.UUID{o.ID}, Payments: []salesuc.Tender{{Method: domain.PayCash, Amount: decimal.NewFromInt(110)}}})
	require.NoError(t, err)

	from := time.Now().Add(-time.Hour)
	to := time.Now().Add(time.Hour)
	mr, err := f.svc.MenuReport(ctx, f.store, from, to)
	require.NoError(t, err)
	require.Len(t, mr.Lines, 1)
	require.Equal(t, "2", mr.Lines[0].Qty.String())
	require.Equal(t, "110.00", mr.Lines[0].Revenue.StringFixed(2))
	require.True(t, mr.Lines[0].Cost.IsPositive())
	require.Equal(t, "star", mr.Lines[0].Class)

	ir, err := f.svc.IngredientReport(ctx, f.store, from, to)
	require.NoError(t, err)
	var beans *IngredientLine
	for i := range ir.Lines {
		if ir.Lines[i].ProductID == f.beans {
			beans = &ir.Lines[i]
		}
	}
	require.NotNil(t, beans)
	require.Equal(t, "37.800", beans.Used.StringFixed(3)) // 2 × 18.9 g
	require.Equal(t, "34.02", beans.UsedCost.StringFixed(2))

	hr, err := f.svc.HoursReport(ctx, f.store, from, to)
	require.NoError(t, err)
	require.Len(t, hr.Lines, 1)
	require.Equal(t, 1, hr.Lines[0].Orders)
}
