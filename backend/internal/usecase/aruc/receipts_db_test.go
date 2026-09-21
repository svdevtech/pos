package aruc

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
	"github.com/svdev/pos/internal/usecase/salesuc"
)

// A member pays off a tab by bank transfer. The money must show up where the shop reconciles its
// bank account — today's transfers on the dashboard, the daily report, the shift that took it —
// without the bill being counted as a sale a second time. Runs against TEST_DATABASE_URL (a
// migrated database) and skips without it.
func TestRepaymentsShowWhereTheMoneyLands(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	db, err := postgres.Open(ctx, url)
	require.NoError(t, err)
	t.Cleanup(db.Close)
	sales := salesuc.New(db, postgres.StockRepo{})
	ar := New(db)

	var store, member, product, userA, userB uuid.UUID
	code := "T" + uuid.NewString()[:6]
	require.NoError(t, db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO stores (code, name) VALUES ($1, $2) RETURNING id`, code, "test shop "+code).Scan(&store); err != nil {
			return err
		}
		for _, u := range []struct {
			name string
			id   *uuid.UUID
		}{{"cashier-a", &userA}, {"cashier-b", &userB}} {
			if err := tx.QueryRow(ctx, `INSERT INTO users (store_id, username, password_hash, display_name, role) VALUES ($1,$2,'x',$2,'cashier') RETURNING id`, store, u.name).Scan(u.id); err != nil {
				return err
			}
		}
		return nil
	}))
	t.Cleanup(func() {
		_ = db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `DELETE FROM stores WHERE id=$1`, store)
			return err
		})
	})
	require.NoError(t, db.WithTx(ctx, postgres.Scope{StoreID: store}, func(ctx context.Context, tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO members (store_id, member_code, name) VALUES ($1,'M1','ลูกหนี้ทดสอบ') RETURNING id`, store).Scan(&member); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `INSERT INTO products (store_id, sku, name, stock_on_hand, cost_avg, cost_last, sell_price) VALUES ($1,'P1','ข้าวสาร',100,40,40,500) RETURNING id`, store).Scan(&product)
	}))

	a := salesuc.Actor{UserID: userA, Name: "cashier-a"}
	shift, err := sales.OpenShift(ctx, store, a, "POS1", decimal.NewFromInt(1000), "")
	require.NoError(t, err)

	// yesterday: ฿1,000 on the member's account
	yesterday := time.Now().Add(-24 * time.Hour)
	_, err = sales.Create(ctx, store, a, salesuc.CreateSaleInput{
		MemberID: &member,
		Lines:    []salesuc.LineInput{{ProductID: product, Qty: decimal.NewFromInt(2)}},
		Payments: []salesuc.Tender{{Method: domain.PayCredit, Amount: decimal.NewFromInt(1000)}},
		SoldAt:   &yesterday,
	})
	require.NoError(t, err)

	// today: cashier A takes ฿540 by transfer and ฿100 in cash; cashier B takes ฿60 by transfer
	pay := func(who Actor, amount int64, method domain.PaymentMethod) {
		_, err := ar.Pay(ctx, store, who, PaymentInput{MemberID: member, Amount: decimal.NewFromInt(amount), Method: method})
		require.NoError(t, err)
	}
	pay(Actor{UserID: userA, Name: "cashier-a"}, 540, domain.PayTransfer)
	pay(Actor{UserID: userA, Name: "cashier-a"}, 100, domain.PayCash)
	pay(Actor{UserID: userB, Name: "cashier-b"}, 60, domain.PayTransfer)

	now := time.Now()
	loc, _ := time.LoadLocation("Asia/Bangkok")
	today := time.Date(now.In(loc).Year(), now.In(loc).Month(), now.In(loc).Day(), 0, 0, 0, 0, loc)
	tomorrow := today.AddDate(0, 0, 1)
	day := today.Format("2006-01-02")

	// the day's report: no sale today, so the row exists only for the repayments
	var rows []postgres.PeriodSalesRow
	require.NoError(t, db.WithTx(ctx, postgres.Scope{StoreID: store}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		rows, err = postgres.ReportRepo{}.PeriodSales(ctx, store, today.AddDate(0, 0, -1), tomorrow, "day")
		return err
	}))
	var todayRow *postgres.PeriodSalesRow
	for i := range rows {
		if rows[i].Period == day {
			todayRow = &rows[i]
		}
	}
	require.NotNil(t, todayRow, "a day with only repayments still gets a row")
	require.Equal(t, "600", todayRow.AR.Transfer.String(), "both cashiers' transfers")
	require.Equal(t, "100", todayRow.AR.Cash.String())
	require.Equal(t, "700", todayRow.AR.Total.String())
	require.True(t, todayRow.Net.IsZero(), "a repayment is not a sale: net must stay 0, got %s", todayRow.Net)
	require.True(t, todayRow.Transfer.IsZero(), "the sales transfer column is sales only, got %s", todayRow.Transfer)
	require.Zero(t, todayRow.Bills)

	// the shift: only what its own cashier took; the cash one is already in the drawer
	var sum *postgres.DailySummary
	require.NoError(t, db.WithTx(ctx, postgres.Scope{StoreID: store}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		sum, err = postgres.SaleRepo{}.Summary(ctx, store, shift.OpenedAt, time.Now().Add(time.Second), &shift.ID)
		return err
	}))
	require.Equal(t, "540", sum.ARByMethod["transfer"].String(), "cashier B's ฿60 belongs to no shift of A's")
	require.Equal(t, "100", sum.ARByMethod["cash"].String())
	report, err := sales.ShiftReport(ctx, store, shift.ID)
	require.NoError(t, err)
	require.Equal(t, "100", report.Shift.CashIn.String(), "the cash repayment went into A's drawer, as before")
}
