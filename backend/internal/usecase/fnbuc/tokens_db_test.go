package fnbuc

import (
	"context"
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"

	"github.com/svdev/pos/internal/domain"
)

// A table's customer code is replaced the moment its last bill closes, so a photo of the QR
// taken during one meal cannot order at the next; the tablet's own address never changes and
// is told the new code, while a customer's phone only hears that its session is over.
func TestClosingATableRotatesItsCustomerCode(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	actor := Actor{Name: "test"}

	toks, err := f.svc.TableTokens(ctx, f.store, []string{"7"})
	require.NoError(t, err)
	require.Len(t, toks, 1)
	before := toks[0]
	require.NotEmpty(t, before.Token)
	require.NotEmpty(t, before.KioskToken)
	require.NotEqual(t, before.Token, before.KioskToken)

	// the tablet on the table and a customer's phone are both listening
	sctx, cancel := context.WithCancel(ctx)
	defer cancel()
	kioskEv, err := f.svc.SubscribeTable(sctx, before.KioskToken)
	require.NoError(t, err)
	phoneEv, err := f.svc.SubscribeTable(sctx, before.Token)
	require.NoError(t, err)

	line := []LineInput{{MenuItemID: f.latte, Qty: decimal.NewFromInt(1)}}
	o1, err := f.svc.CreateOrder(ctx, f.store, actor, CreateOrderInput{Channel: domain.ChannelDineIn, TableCode: "7", Lines: line})
	require.NoError(t, err)
	o2, err := f.svc.CreateOrder(ctx, f.store, actor, CreateOrderInput{Channel: domain.ChannelDineIn, TableCode: "7", Lines: line})
	require.NoError(t, err)

	// closing one bill while another is still open leaves the code alone
	_, err = f.svc.SetStatus(ctx, f.store, actor, o1.ID, domain.OrderClosed)
	require.NoError(t, err)
	toks, err = f.svc.TableTokens(ctx, f.store, nil)
	require.NoError(t, err)
	require.Equal(t, before.Token, toks[0].Token)

	// closing the last one rotates it
	_, err = f.svc.SetStatus(ctx, f.store, actor, o2.ID, domain.OrderClosed)
	require.NoError(t, err)
	toks, err = f.svc.TableTokens(ctx, f.store, nil)
	require.NoError(t, err)
	after := toks[0]
	require.NotEqual(t, before.Token, after.Token)
	require.Equal(t, before.KioskToken, after.KioskToken)

	// the old code no longer opens the table; the tablet's still does and is handed the new one
	_, err = f.svc.TableByToken(ctx, before.Token)
	require.ErrorIs(t, err, domain.ErrNotFound)
	view, err := f.svc.TableByToken(ctx, before.KioskToken)
	require.NoError(t, err)
	require.True(t, view.Kiosk)
	require.Equal(t, after.Token, view.GuestToken)
	require.Empty(t, view.Orders)

	// over the streams: the tablet hears the new code, the phone only that the session ended
	require.Equal(t, after.Token, waitTable(t, kioskEv).Token)
	require.Empty(t, waitTable(t, phoneEv).Token)

	// the new code orders like the old one did
	view, err = f.svc.TableByToken(ctx, after.Token)
	require.NoError(t, err)
	require.False(t, view.Kiosk)
	require.Empty(t, view.GuestToken)
}

// waitTable drains a table's stream until a "table" event arrives (order events come first).
func waitTable(t *testing.T, ch <-chan Event) *TableToken {
	t.Helper()
	deadline := time.After(3 * time.Second)
	for {
		select {
		case ev, ok := <-ch:
			require.True(t, ok, "stream closed before the table event")
			if ev.Kind == "table" {
				require.NotNil(t, ev.Table)
				require.Equal(t, "7", ev.Table.TableCode)
				return ev.Table
			}
		case <-deadline:
			t.Fatal("no table event within 3s")
		}
	}
}
