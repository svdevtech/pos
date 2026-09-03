package legacy

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/svdev/pos/internal/repository/postgres"
)

// stagePayments imports payments → ar_payments. Bills purged before 2020 keep sale_id NULL + legacy_bill_no.
func (im *Importer) stagePayments(ctx context.Context, sr *StageReport) error {
	if err := im.loadCaches(ctx); err != nil {
		return err
	}
	q := postgres.Q(ctx)
	unlinked := 0
	return EachRow(im.m.Path("payments"), func(_ int, r Row) error {
		sr.RowsIn++
		legacyID := r.Str("payment_id")
		bill := r.Str("buy_id")
		var saleID *uuid.UUID
		if id, ok := im.sales[bill]; ok {
			saleID = &id
		} else {
			unlinked++
		}
		var memberID *uuid.UUID
		if id, ok := im.members[r.Str("cust_id")]; ok {
			memberID = &id
		} else if r.Str("cust_id") != "" {
			id, err := im.placeholderMember(ctx, r.Str("cust_id"))
			if err != nil {
				return err
			}
			memberID = &id
		}
		paidAt, ok := ParseBEDateTime(r.Str("payment_datetime"))
		if !ok {
			if d, ok2 := r.Date("payment_date"); ok2 {
				paidAt = d
			} else {
				paidAt = time.Date(2000, 1, 1, 0, 0, 0, 0, Bangkok)
			}
		}
		user := r.Str("user_user")
		var by *uuid.UUID
		if id, ok := im.users[user]; ok {
			by = &id
		}
		tag, err := q.Exec(ctx, `INSERT INTO ar_payments (store_id, member_id, sale_id, legacy_bill_no, bill_total, balance_before, amount, balance_after, method, paid_at, received_by, received_by_name, legacy_id)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'cash',$9,$10,NULLIF($11,''),$12)
			ON CONFLICT (store_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING`,
			im.storeID, memberID, saleID, bill, r.Dec("payment_debsum"), r.Dec("payment_debremain"), r.Dec("payment_pay"), r.Dec("payment_total"), paidAt, by, user, legacyID)
		if err != nil {
			return fmt.Errorf("payment %s: %w", legacyID, err)
		}
		if tag.RowsAffected() == 0 {
			sr.Skipped++
		} else {
			sr.RowsOut++
		}
		sr.Extra["unlinked_bills"] = unlinked
		return nil
	})
}

// stageReceipts imports ordermain/orderdetails → purchase_receipts(+lines). Stock is NOT re-applied
// (the legacy stock snapshot already includes these receipts); costs are not touched either.
func (im *Importer) stageReceipts(ctx context.Context, sr *StageReport) error {
	if err := im.loadCaches(ctx); err != nil {
		return err
	}
	q := postgres.Q(ctx)
	receipts := map[string]uuid.UUID{}
	maxSeq := map[string]int{}
	if err := EachRow(im.m.Path("ordermain"), func(_ int, r Row) error {
		sr.RowsIn++
		doc := r.Str("order_id")
		if doc == "" {
			sr.Skipped++
			return nil
		}
		var supplierID *uuid.UUID
		if id, ok := im.suppliers[r.Str("sup_id")]; ok && r.Str("sup_id") != "0" {
			supplierID = &id
		}
		at, ok := r.Date("order_date")
		if !ok {
			at = time.Date(2000, 1, 1, 0, 0, 0, 0, Bangkok)
		}
		user := r.Str("user_user")
		var by *uuid.UUID
		if id, ok := im.users[user]; ok {
			by = &id
		}
		var id uuid.UUID
		err := q.QueryRow(ctx, `INSERT INTO purchase_receipts (store_id, doc_no, supplier_id, received_at, received_by, received_by_name, subtotal, vat, total, status, legacy_id)
			VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),$7,$8,$9,'posted',$2)
			ON CONFLICT (store_id, doc_no) DO UPDATE SET doc_no=EXCLUDED.doc_no RETURNING id, (xmax = 0)`,
			im.storeID, doc, supplierID, at, by, user, r.Dec("order_pricesum"), r.Dec("order_pricevat"), r.Dec("order_pricetotal")).Scan(&id, new(bool))
		if err != nil {
			return fmt.Errorf("receipt %s: %w", doc, err)
		}
		receipts[doc] = id
		if p, n, ok := PeriodFromDocNo(doc); ok && n > maxSeq[p] {
			maxSeq[p] = n
		}
		sr.RowsOut++
		return nil
	}); err != nil {
		return err
	}
	// lines
	lineNo := map[string]int{}
	orphanProducts, orphanLines := 0, 0
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
	if err := EachRow(im.m.Path("orderdetails"), func(_ int, r Row) error {
		doc := r.Str("order_id")
		rid, ok := receipts[doc]
		if !ok {
			orphanLines++
			return nil
		}
		pro := r.Str("pro_id")
		pid, ok := im.products[pro]
		if !ok {
			id, err := im.placeholderProduct(ctx, pro)
			if err != nil {
				return err
			}
			pid = id
			orphanProducts++
		}
		lineNo[doc]++
		batch.Queue(`INSERT INTO purchase_receipt_lines (store_id, receipt_id, line_no, product_id, sku, description, qty, unit_cost, total, legacy_id)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (receipt_id, line_no) DO NOTHING`,
			im.storeID, rid, lineNo[doc], pid, pro, im.prodInfo[pro].Name, r.Dec("order_number"), r.Dec("order_costprice"), r.Dec("order_sumprice"), r.Str("id"))
		if batch.Len() >= 2000 {
			return flush()
		}
		return nil
	}); err != nil {
		return err
	}
	if err := flush(); err != nil {
		return err
	}
	for p, n := range maxSeq {
		if err := postgres.BumpDocSeq(ctx, im.storeID, postgres.DocReceipt, p, n); err != nil {
			return err
		}
	}
	sr.Extra["lines_with_placeholder_product"] = orphanProducts
	sr.Extra["orphan_lines"] = orphanLines
	return nil
}
