package legacy

import (
	"context"
	"fmt"
	"sort"

	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/repository/postgres"
)

// Reconcile compares what the dump contains with what the database holds for the store.
type Reconcile struct {
	OK     bool             `json:"ok"`
	Checks []ReconcileCheck `json:"checks"`
}

type ReconcileCheck struct {
	Name     string `json:"name"`
	Expected string `json:"expected"`
	Actual   string `json:"actual"`
	OK       bool   `json:"ok"`
	Note     string `json:"note,omitempty"`
}

func (im *Importer) stageReconcile(ctx context.Context, sr *StageReport) error {
	q := postgres.Q(ctx)
	rc := &Reconcile{OK: true}
	add := func(name, expected, actual, note string) {
		ok := expected == actual
		if !ok {
			rc.OK = false
		}
		rc.Checks = append(rc.Checks, ReconcileCheck{Name: name, Expected: expected, Actual: actual, OK: ok, Note: note})
	}
	count := func(sql string, args ...any) string {
		var n int64
		if err := q.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
			return "ERR " + err.Error()
		}
		return fmt.Sprint(n)
	}
	sum := func(sql string, args ...any) string {
		var s string
		if err := q.QueryRow(ctx, sql, args...).Scan(&s); err != nil {
			return "ERR " + err.Error()
		}
		return dec2(s)
	}

	// ---- expected values computed from the dump -----------------------------------
	type yr struct {
		bills int
		net   decimal.Decimal
	}
	years := map[int]*yr{}
	headers, exactDup := 0, 0
	seen := map[string]bool{}
	fps := map[string]bool{}
	cancelled := 0
	_ = EachRow(im.m.Path("buymain"), func(_ int, r Row) error {
		headers++
		fp := fmt.Sprint(r)
		if fps[fp] {
			exactDup++
			return nil
		}
		fps[fp] = true
		seen[r.Str("buy_id")] = true
		if r.Str("buy_status") == "3" {
			cancelled++
		}
		if d, ok := r.Date("buy_date"); ok && r.Str("buy_status") == "1" {
			y := years[d.Year()]
			if y == nil {
				y = &yr{}
				years[d.Year()] = y
			}
			y.bills++
			y.net = y.net.Add(r.Dec("buy_buytotal"))
		}
		return nil
	})
	lines := 0
	_ = EachRow(im.m.Path("buydetails"), func(_ int, r Row) error {
		if seen[r.Str("buy_id")] {
			lines++
		}
		return nil
	})
	t := func(name string) int {
		if tb, ok := im.m.Table(name); ok {
			return tb.Rows
		}
		return -1
	}

	add("sales headers (dump − exact duplicates)", fmt.Sprint(headers-exactDup), count(`SELECT count(*) FROM sales WHERE store_id=$1 AND legacy_id IS NOT NULL`, im.storeID), fmt.Sprintf("dump rows %d, exact duplicates %d", headers, exactDup))
	add("sales cancelled", fmt.Sprint(cancelled), count(`SELECT count(*) FROM sales WHERE store_id=$1 AND legacy_id IS NOT NULL AND status='cancelled'`, im.storeID), "")
	add("sale lines (with header)", fmt.Sprint(lines), count(`SELECT count(*) FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.store_id=$1 AND s.legacy_id IS NOT NULL`, im.storeID), "orphan lines are in legacy_orphans")
	ys := make([]int, 0, len(years))
	for y := range years {
		ys = append(ys, y)
	}
	sort.Ints(ys)
	for _, y := range ys {
		exp := years[y]
		add(fmt.Sprintf("%d completed bills", y), fmt.Sprint(exp.bills),
			count(`SELECT count(*) FROM sales WHERE store_id=$1 AND legacy_id IS NOT NULL AND status='completed' AND EXTRACT(YEAR FROM sold_at AT TIME ZONE 'Asia/Bangkok')=$2`, im.storeID, y), "")
		add(fmt.Sprintf("%d completed net", y), dec2(exp.net.String()),
			sum(`SELECT COALESCE(sum(net),0)::text FROM sales WHERE store_id=$1 AND legacy_id IS NOT NULL AND status='completed' AND EXTRACT(YEAR FROM sold_at AT TIME ZONE 'Asia/Bangkok')=$2`, im.storeID, y), "")
	}
	prodIDs := map[string]bool{}
	_ = EachRow(im.m.Path("product"), func(_ int, r Row) error { prodIDs[r.Str("pro_id")] = true; return nil })
	_ = EachRow(im.m.Path("delproducts"), func(_ int, r Row) error { prodIDs[r.Str("pro_id")] = true; return nil })
	delete(prodIDs, "")
	add("products (distinct ids in product ∪ delproducts)", fmt.Sprint(len(prodIDs)),
		count(`SELECT count(*) FROM products WHERE store_id=$1 AND legacy_id IS NOT NULL AND COALESCE(archived_reason,'') <> 'placeholder_orphan'`, im.storeID),
		fmt.Sprintf("dump rows %d + %d; deleted ids colliding with an active id are skipped", t("product"), t("delproducts")))
	add("members", fmt.Sprint(t("customer")), count(`SELECT count(*) FROM members WHERE store_id=$1 AND legacy_id IS NOT NULL AND status <> 'inactive'`, im.storeID), "placeholder members excluded")
	shareSum := decimal.Zero
	_ = EachRow(im.m.Path("customer"), func(_ int, r Row) error { shareSum = shareSum.Add(r.Dec("cust_hunmoney")); return nil })
	add("share capital Σ", dec2(shareSum.String()), sum(`SELECT COALESCE(sum(share_capital),0)::text FROM members WHERE store_id=$1 AND legacy_id IS NOT NULL`, im.storeID), "")
	add("ar payments", fmt.Sprint(t("payments")), count(`SELECT count(*) FROM ar_payments WHERE store_id=$1 AND legacy_id IS NOT NULL`, im.storeID), "")
	paySum := decimal.Zero
	_ = EachRow(im.m.Path("payments"), func(_ int, r Row) error { paySum = paySum.Add(r.Dec("payment_pay")); return nil })
	add("ar payments Σ", dec2(paySum.String()), sum(`SELECT COALESCE(sum(amount),0)::text FROM ar_payments WHERE store_id=$1 AND legacy_id IS NOT NULL`, im.storeID), "")
	add("receipts", fmt.Sprint(t("ordermain")), count(`SELECT count(*) FROM purchase_receipts WHERE store_id=$1 AND legacy_id IS NOT NULL`, im.storeID), "")
	add("receipt lines", fmt.Sprint(t("orderdetails")), count(`SELECT count(*) FROM purchase_receipt_lines l JOIN purchase_receipts r ON r.id=l.receipt_id WHERE r.store_id=$1 AND r.legacy_id IS NOT NULL`, im.storeID), "")
	add("expenses", fmt.Sprint(t("expenses")), count(`SELECT count(*) FROM expenses WHERE store_id=$1 AND legacy_id IS NOT NULL`, im.storeID), "")
	add("drawer logs", fmt.Sprint(t("logopencashdrawer")), count(`SELECT count(*) FROM cash_drawer_logs WHERE store_id=$1 AND legacy_id IS NOT NULL`, im.storeID), "")
	add("dividend criteria", fmt.Sprint(t("criteriondividend")), count(`SELECT count(*) FROM dividend_criteria WHERE store_id=$1 AND legacy_id IS NOT NULL`, im.storeID), "")
	add("dividend statements", fmt.Sprint(t("temps2")), count(`SELECT count(*) FROM dividend_member_statements s JOIN dividend_runs r ON r.id=s.run_id WHERE s.store_id=$1 AND r.source='legacy_import'`, im.storeID), "")
	add("users", fmt.Sprint(t("usersys")), count(`SELECT count(*) FROM users WHERE store_id=$1 AND legacy_id IS NOT NULL`, im.storeID), "")

	im.report.Reconcile = rc
	sr.Extra["ok"] = rc.OK
	failed := 0
	for _, c := range rc.Checks {
		if !c.OK {
			failed++
			im.warn("reconcile", fmt.Sprintf("%s: expected %s got %s", c.Name, c.Expected, c.Actual))
		}
	}
	sr.Extra["failed_checks"] = failed
	if !rc.OK {
		return fmt.Errorf("%d reconciliation check(s) failed", failed)
	}
	return nil
}

func dec2(s string) string {
	d, err := decimal.NewFromString(s)
	if err != nil {
		return s
	}
	return d.StringFixed(2)
}
