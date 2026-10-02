package salesuc

import (
	"context"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

// บ้านแก่นใต้, 2 Oct 2026: one till sent the same ฿495 cart twice, 17 ms apart, and got two bills.
// A cart now carries an id, and the same cart may only be written once however many times it is
// sent — including when both attempts are in flight at the same moment. Runs against
// TEST_DATABASE_URL (a migrated database) and skips without it.
func TestSameCartIsBilledOnce(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	db, err := postgres.Open(ctx, url)
	require.NoError(t, err)
	t.Cleanup(db.Close)
	svc := New(db, postgres.StockRepo{})

	var store, product, user uuid.UUID
	code := "T" + uuid.NewString()[:6]
	require.NoError(t, db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO stores (code, name) VALUES ($1,$2) RETURNING id`, code, "test shop "+code).Scan(&store); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `INSERT INTO users (store_id, username, password_hash, display_name, role) VALUES ($1,'cashier','x','cashier','cashier') RETURNING id`, store).Scan(&user)
	}))
	t.Cleanup(func() {
		_ = db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `DELETE FROM stores WHERE id=$1`, store)
			return err
		})
	})
	require.NoError(t, db.WithTx(ctx, postgres.Scope{StoreID: store}, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `INSERT INTO products (store_id, sku, name, stock_on_hand, cost_avg, cost_last, sell_price) VALUES ($1,'P1','ข้าวสาร',100,40,40,495) RETURNING id`, store).Scan(&product)
	}))

	actor := Actor{UserID: user, Name: "cashier"}
	cart := func(ref string) CreateSaleInput {
		return CreateSaleInput{
			ClientRef: ref,
			Lines:     []LineInput{{ProductID: product, Qty: decimal.NewFromInt(1)}},
			Payments:  []Tender{{Method: domain.PayCash, Amount: decimal.NewFromInt(495)}},
		}
	}
	stock := func() string {
		var v string
		require.NoError(t, db.WithTx(ctx, postgres.Scope{StoreID: store}, func(ctx context.Context, tx pgx.Tx) error {
			return tx.QueryRow(ctx, `SELECT stock_on_hand::text FROM products WHERE id=$1`, product).Scan(&v)
		}))
		return v
	}

	// one after the other: the second attempt is answered with the first bill
	ref := uuid.NewString()
	first, err := svc.Create(ctx, store, actor, cart(ref))
	require.NoError(t, err)
	again, err := svc.Create(ctx, store, actor, cart(ref))
	require.NoError(t, err)
	require.Equal(t, first.ID, again.ID, "the same cart must not produce a second bill")
	require.Equal(t, first.DocNo, again.DocNo)
	require.Equal(t, "99.000", stock(), "stock may only move once")

	// both at the same moment, which is what a bouncing switch does
	race := uuid.NewString()
	var wg sync.WaitGroup
	ids := make([]uuid.UUID, 2)
	errs := make([]error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sale, err := svc.Create(ctx, store, actor, cart(race))
			errs[i] = err
			if sale != nil {
				ids[i] = sale.ID
			}
		}(i)
	}
	wg.Wait()
	require.NoError(t, errs[0])
	require.NoError(t, errs[1])
	require.Equal(t, ids[0], ids[1], "two tills racing on one cart must end up with one bill")
	require.Equal(t, "98.000", stock(), "the losing attempt must leave no trace on stock")

	var bills int
	require.NoError(t, db.WithTx(ctx, postgres.Scope{StoreID: store}, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM sales WHERE store_id=$1`, store).Scan(&bills)
	}))
	require.Equal(t, 2, bills, "two carts, two bills — no more")

	// a cart without an id behaves as before: every attempt is its own bill
	_, err = svc.Create(ctx, store, actor, cart(""))
	require.NoError(t, err)
	_, err = svc.Create(ctx, store, actor, cart(""))
	require.NoError(t, err)
	require.NoError(t, db.WithTx(ctx, postgres.Scope{StoreID: store}, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM sales WHERE store_id=$1`, store).Scan(&bills)
	}))
	require.Equal(t, 4, bills)
}
