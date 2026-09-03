package legacy

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/repository/postgres"
)

// legacyHeader is one buymain row.
type legacyHeader struct {
	DocNo      string
	SoldAt     time.Time
	Gross      decimal.Decimal // buy_pricetotal
	Discount   decimal.Decimal // buy_pricediscount
	Net        decimal.Decimal // buy_buytotal
	Tender     int             // buy_type
	DebtStatus string
	DebtTotal  decimal.Decimal
	DebtPaid   decimal.Decimal
	DebtPay    decimal.Decimal
	User       string
	Status     string // 1 normal, 3 cancelled
	CustID     string
	CancelUser string
	CancelTime string
	MoneyIn    decimal.Decimal
	MoneyRet   decimal.Decimal
	Comment    string
	fp         string // full-row fingerprint for exact-duplicate detection
	dupSeq     int
	lineNo     int
}

type legacyLine struct {
	ID       int64
	DocNo    string
	ProID    string
	Cost     decimal.Decimal
	CostAvg  decimal.Decimal
	Price    decimal.Decimal
	Qty      decimal.Decimal
	Sum      decimal.Decimal
	RowNo    int
	Free     bool
	Serial   string
	Discount decimal.Decimal
}

// maxSaneMoney: legacy tendered/change above this are barcode scans typed into the cash box, not money.
var maxSaneMoney = decimal.NewFromInt(10_000_000)

func tenderMethod(t int) string {
	switch t {
	case 2:
		return "credit"
	case 3:
		return "transfer"
	case 4:
		return "card"
	default:
		return "cash"
	}
}

// stageSales imports buymain/buydetails. Duplicate legacy bill numbers (N6512-*) are split into
// separate sales by segmenting the detail rows where buy_rownumber restarts at 1 (autonumber order).
func (im *Importer) stageSales(ctx context.Context, sr *StageReport) error {
	if err := im.loadCaches(ctx); err != nil {
		return err
	}
	q := postgres.Q(ctx)

	// ---- headers -------------------------------------------------------------
	headers := map[string][]*legacyHeader{}
	order := []string{}
	exactDup := 0
	if err := EachRow(im.m.Path("buymain"), func(n int, r Row) error {
		sr.RowsIn++
		h := &legacyHeader{DocNo: r.Str("buy_id"), Gross: r.Dec("buy_pricetotal"), Discount: r.Dec("buy_pricediscount"), Net: r.Dec("buy_buytotal"),
			Tender: r.Int("buy_type"), DebtStatus: r.Str("buy_debtorstatus"), DebtTotal: r.Dec("buy_debtortotal"), DebtPaid: r.Dec("buy_debtorpaid"), DebtPay: r.Dec("buy_debtorpayable"),
			User: r.Str("user_user"), Status: r.Str("buy_status"), CustID: r.Str("cust_id"), CancelUser: r.Str("buy_cancel_user"), CancelTime: r.Str("buy_cancel_time"),
			MoneyIn: r.Dec("buy_moneyinput"), MoneyRet: r.Dec("buy_moneyreturn"), Comment: r.Str("buy_comment"), lineNo: n}
		if h.DocNo == "" {
			sr.Skipped++
			im.warn("sales", fmt.Sprintf("buymain line %d: empty buy_id skipped", n))
			return nil
		}
		d, ok := r.Date("buy_date")
		if !ok {
			d = time.Date(2000, 1, 1, 0, 0, 0, 0, Bangkok)
			im.warn("sales", h.DocNo+": missing buy_date")
		}
		h.SoldAt = CombineDateTime(d, r.Str("buy_timesale"))
		b, _ := json.Marshal(r)
		h.fp = string(b)
		if prev, ok := headers[h.DocNo]; ok {
			for _, p := range prev {
				if p.fp == h.fp {
					exactDup++
					sr.Skipped++
					return nil
				}
			}
		} else {
			order = append(order, h.DocNo)
		}
		headers[h.DocNo] = append(headers[h.DocNo], h)
		return nil
	}); err != nil {
		return err
	}
	dupDocs := 0
	for _, doc := range order {
		hs := headers[doc]
		if len(hs) > 1 {
			dupDocs++
			sort.SliceStable(hs, func(i, j int) bool { return hs[i].SoldAt.Before(hs[j].SoldAt) })
			for i := range hs {
				hs[i].dupSeq = i
			}
		}
	}
	sr.Extra["exact_duplicate_headers"] = exactDup
	sr.Extra["duplicated_doc_nos"] = dupDocs

	// ---- lines: group by doc, segment on rownumber reset ----------------------
	lines := map[string][][]legacyLine{} // doc → segments
	orphanLines := 0
	lineCount := 0
	if err := EachRow(im.m.Path("buydetails"), func(_ int, r Row) error {
		lineCount++
		l := legacyLine{ID: int64(r.Dec("ID").IntPart()), DocNo: r.Str("buy_id"), ProID: r.Str("pro_id"), Cost: r.Dec("buy_costprice"), CostAvg: r.Dec("buy_costpriceavg"),
			Price: r.Dec("buy_buyprice"), Qty: r.Dec("buy_number"), Sum: r.Dec("buy_sumprice"), RowNo: r.Int("buy_rownumber"), Free: r.Str("buy_freestatus") == "1",
			Serial: r.Str("buy_serialnumber"), Discount: r.Dec("buy_discount")}
		if _, ok := headers[l.DocNo]; !ok {
			orphanLines++
			payload, _ := json.Marshal(r)
			_, err := q.Exec(ctx, `INSERT INTO legacy_orphans (store_id, source, reason, legacy_key, payload) SELECT $1,'buydetails','no header',$2,$3
				WHERE NOT EXISTS (SELECT 1 FROM legacy_orphans WHERE store_id=$1 AND source='buydetails' AND legacy_key=$2)`, im.storeID, fmt.Sprintf("%s#%d", l.DocNo, l.ID), payload)
			return err
		}
		segs := lines[l.DocNo]
		if len(segs) == 0 || (len(headers[l.DocNo]) > 1 && len(segs[len(segs)-1]) > 0 && l.RowNo <= segs[len(segs)-1][len(segs[len(segs)-1])-1].RowNo) {
			segs = append(segs, nil)
		}
		segs[len(segs)-1] = append(segs[len(segs)-1], l)
		lines[l.DocNo] = segs
		return nil
	}); err != nil {
		return err
	}
	sr.Extra["lines_in"] = lineCount
	sr.Extra["orphan_lines"] = orphanLines

	// ---- insert ------------------------------------------------------------------
	inserted, skipped, placeholders, unknownMembers := 0, 0, 0, 0
	maxSeq := map[string]int{}
	batch := &pgx.Batch{}
	flush := func() error {
		if batch.Len() == 0 {
			return nil
		}
		br := q.SendBatch(ctx, batch)
		for i := 0; i < batch.Len(); i++ {
			if _, err := br.Exec(); err != nil {
				br.Close()
				return err
			}
		}
		batch = &pgx.Batch{}
		return br.Close()
	}
	for _, doc := range order {
		hs := headers[doc]
		segs := lines[doc]
		if len(hs) > 1 && len(segs) != len(hs) {
			im.warn("sales", fmt.Sprintf("%s: %d headers but %d line segments; extra segments attached to last header", doc, len(hs), len(segs)))
		}
		if p, n, ok := PeriodFromDocNo(doc); ok && n > maxSeq[p] {
			maxSeq[p] = n
		}
		for hi, h := range hs {
			var seg []legacyLine
			if hi < len(segs) {
				seg = segs[hi]
			}
			if hi == len(hs)-1 && len(segs) > len(hs) {
				for _, extra := range segs[len(hs):] {
					seg = append(seg, extra...)
				}
			}
			// member
			var memberID *uuid.UUID
			cust := h.CustID
			if cust == "" {
				cust = "0"
			}
			mid, ok := im.members[cust]
			if !ok {
				id, err := im.placeholderMember(ctx, cust)
				if err != nil {
					return err
				}
				mid = id
				unknownMembers++
			}
			memberID = &mid
			var cashierID *uuid.UUID
			if uid, ok := im.users[h.User]; ok {
				cashierID = &uid
			}
			status := "completed"
			var cancelledAt *time.Time
			if h.Status == "3" {
				status = "cancelled"
				if t, ok := ParseBEDateTime(h.CancelTime); ok {
					cancelledAt = &t
				} else {
					t := h.SoldAt
					cancelledAt = &t
				}
			}
			arStatus, arTotal, arPaid, arBal := "none", decimal.Zero, decimal.Zero, decimal.Zero
			if h.Tender == 2 && status == "completed" {
				arTotal = h.DebtTotal
				if arTotal.IsZero() {
					arTotal = h.Net
				}
				arPaid, arBal = h.DebtPaid, h.DebtPay
				switch {
				case h.DebtStatus == "2" || arBal.IsZero():
					arStatus, arBal = "paid", decimal.Zero
				case arPaid.IsPositive():
					arStatus = "partial"
				default:
					arStatus = "unpaid"
				}
			}
			tendered, change := h.MoneyIn, h.MoneyRet
			if h.Tender != 1 {
				tendered, change = h.Net, decimal.Zero
			}
			// cashier scanned a barcode into the "tendered" box (values like 8851123212021): keep the bill, fix the tender
			if tendered.GreaterThan(maxSaneMoney) || change.GreaterThan(maxSaneMoney) || tendered.IsNegative() || change.IsNegative() {
				im.warn("sales", fmt.Sprintf("%s: implausible tendered %s / change %s → set to net", doc, tendered, change))
				tendered, change = h.Net, decimal.Zero
				sr.Extra["tender_fixed"] = asInt(sr.Extra["tender_fixed"]) + 1
			}
			saleID := uuid.New()
			var gotID uuid.UUID
			err := q.QueryRow(ctx, `INSERT INTO sales (id, store_id, doc_no, legacy_dup_seq, sold_at, cashier_id, cashier_name, member_id, gross, discount, bill_discount, vat, net, tendered, change_amount,
				status, cancelled_by_name, cancelled_at, ar_status, ar_total, ar_paid, ar_balance, note, legacy_tender, legacy_id)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,0,$11,$12,$13,$14::sale_status,NULLIF($15,''),$16,$17::ar_status,$18,$19,$20,NULLIF($21,''),$22,$3)
				ON CONFLICT (store_id, doc_no, legacy_dup_seq) DO NOTHING RETURNING id`,
				saleID, im.storeID, doc, h.dupSeq, h.SoldAt, cashierID, h.User, memberID, h.Gross, h.Discount, h.Net, tendered, change,
				status, h.CancelUser, cancelledAt, arStatus, arTotal, arPaid, arBal, h.Comment, h.Tender).Scan(&gotID)
			if err == pgx.ErrNoRows {
				skipped++
				continue
			}
			if err != nil {
				return fmt.Errorf("sale %s: %w", doc, err)
			}
			inserted++
			if h.dupSeq == 0 {
				im.sales[doc] = gotID
			}
			// lines
			for i, l := range seg {
				pid, ok := im.products[l.ProID]
				if !ok {
					id, err := im.placeholderProduct(ctx, l.ProID)
					if err != nil {
						return err
					}
					pid = id
					placeholders++
				}
				name := im.prodInfo[l.ProID].Name
				lineTotal := l.Sum.Sub(l.Discount)
				if lineTotal.IsNegative() {
					lineTotal = decimal.Zero
				}
				if l.Free {
					lineTotal = decimal.Zero
				}
				batch.Queue(`INSERT INTO sale_lines (store_id, sale_id, line_no, product_id, sku, description, qty, unit_price, discount, line_total, cost_last, cost_avg, is_free, serial_no, legacy_id)
					VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULLIF($14,''),$15) ON CONFLICT (sale_id, line_no) DO NOTHING`,
					im.storeID, gotID, i+1, pid, l.ProID, name, l.Qty, l.Price, l.Discount, lineTotal, l.Cost, l.CostAvg, l.Free, l.Serial, fmt.Sprint(l.ID))
			}
			// tender
			amt := h.Net
			if status == "cancelled" {
				amt = h.Net
			}
			if amt.IsPositive() || h.Tender == 1 {
				batch.Queue(`INSERT INTO sale_payments (store_id, sale_id, method, amount) VALUES ($1,$2,$3::payment_method,$4)`, im.storeID, gotID, tenderMethod(h.Tender), amt)
			}
			if batch.Len() >= 2000 {
				if err := flush(); err != nil {
					return err
				}
			}
		}
	}
	if err := flush(); err != nil {
		return err
	}
	// continue numbering after the last legacy bill per period
	for p, n := range maxSeq {
		if err := postgres.BumpDocSeq(ctx, im.storeID, postgres.DocSale, p, n); err != nil {
			return err
		}
	}
	sr.RowsOut = inserted
	sr.Skipped += skipped
	sr.Extra["placeholder_product_refs"] = placeholders
	sr.Extra["placeholder_members"] = unknownMembers
	sr.Extra["headers_unique"] = len(order)
	_ = strings.TrimSpace
	return nil
}
