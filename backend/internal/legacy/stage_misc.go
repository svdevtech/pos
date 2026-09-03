package legacy

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/svdev/pos/internal/repository/postgres"
)

// stageExpenses imports expenses (types were created in lookups).
func (im *Importer) stageExpenses(ctx context.Context, sr *StageReport) error {
	if err := im.loadCaches(ctx); err != nil {
		return err
	}
	q := postgres.Q(ctx)
	return EachRow(im.m.Path("expenses"), func(_ int, r Row) error {
		sr.RowsIn++
		legacyID := r.Str("expen_id")
		var typeID *uuid.UUID
		if id, ok := im.expTypes[r.Str("type_id")]; ok {
			typeID = &id
		}
		d, ok := r.Date("expen_date")
		if !ok {
			d = time.Date(2000, 1, 1, 0, 0, 0, 0, Bangkok)
		}
		user := r.Str("user_user")
		var by *uuid.UUID
		if id, ok := im.users[user]; ok {
			by = &id
		}
		tag, err := q.Exec(ctx, `INSERT INTO expenses (store_id, type_id, expensed_at, amount, note, paid_from, created_by, created_by_name, legacy_id)
			VALUES ($1,$2,$3,$4,NULLIF($5,''),'cash',$6,NULLIF($7,''),$8) ON CONFLICT (store_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING`,
			im.storeID, typeID, d.Format("2006-01-02"), r.Dec("expen_total"), r.Str("expen_detail"), by, user, legacyID)
		if err != nil {
			return fmt.Errorf("expense %s: %w", legacyID, err)
		}
		if tag.RowsAffected() == 0 {
			sr.Skipped++
		} else {
			sr.RowsOut++
		}
		return nil
	})
}

// stageMisc imports cash-drawer logs and barcode label templates.
func (im *Importer) stageMisc(ctx context.Context, sr *StageReport) error {
	if err := im.loadCaches(ctx); err != nil {
		return err
	}
	q := postgres.Q(ctx)
	// drawer logs: skip entirely if already imported (no unique index on legacy_id)
	var existing int
	if err := q.QueryRow(ctx, `SELECT count(*) FROM cash_drawer_logs WHERE store_id=$1 AND legacy_id IS NOT NULL`, im.storeID).Scan(&existing); err != nil {
		return err
	}
	if existing == 0 {
		if err := EachRow(im.m.Path("logopencashdrawer"), func(_ int, r Row) error {
			sr.RowsIn++
			d, ok := r.Date("log_date")
			if !ok {
				sr.Skipped++
				return nil
			}
			at := CombineDateTime(d, r.Str("log_time"))
			user := r.Str("log_user")
			var uid *uuid.UUID
			if id, ok := im.users[user]; ok {
				uid = &id
			}
			if _, err := q.Exec(ctx, `INSERT INTO cash_drawer_logs (store_id, user_id, user_name, reason, amount, note, occurred_at, legacy_id) VALUES ($1,$2,$3,'no_sale',0,$4,$5,$6)`,
				im.storeID, uid, orDefault(r.Str("log_name"), user), "legacy: "+user, at, r.Str("log_id")); err != nil {
				return fmt.Errorf("drawer log %s: %w", r.Str("log_id"), err)
			}
			sr.RowsOut++
			return nil
		}); err != nil {
			return err
		}
	} else {
		sr.Extra["drawer_logs_already_imported"] = existing
	}

	// label templates
	if err := EachRow(im.m.Path("barcodeforms"), func(_ int, r Row) error {
		sr.RowsIn++
		// legacy dims are twips (1/1440 inch) → mm
		twip := func(k string) float64 { f, _ := r.Dec(k).Float64(); return f / 1440 * 25.4 }
		dims := map[string]any{
			"page_left_mm": twip("barcodeform_pageleft"), "page_top_mm": twip("barcodeform_pagetop"), "page_width_mm": twip("barcodeform_pagewidth"),
			"bar_width_mm": twip("barcodeform_barwidth"), "bar_height_mm": twip("barcodeform_barheight"),
			"margin_top_mm": twip("barcodeform_margintop"), "margin_bottom_mm": twip("barcodeform_marginbuttom"), "margin_left_mm": twip("barcodeform_marginleft"), "margin_right_mm": twip("barcodeform_marginright"),
		}
		fonts := map[string]any{"barcode": r.Str("barcodeform_fontname_barcode"), "text": r.Str("barcodeform_fontname_text"),
			"size_barcode": r.Str("barcodeform_fontsize_barcode"), "size_sku": r.Str("barcodeform_fontsize_proid"), "size_name": r.Str("barcodeform_fontsize_proname"), "size_price": r.Str("barcodeform_fontsize_proprice")}
		visible := map[string]any{"barcode": r.Str("barcodeform_visable_barcode") == "True", "sku": r.Str("barcodeform_visable_proid") == "True",
			"name": r.Str("barcodeform_visable_proname") == "True", "price": r.Str("barcodeform_visable_proprice") == "True"}
		db, _ := json.Marshal(dims)
		fb, _ := json.Marshal(fonts)
		vb, _ := json.Marshal(visible)
		paper := "A4"
		if code := r.Str("barcodeform_id"); len(code) >= 2 && code[0] == 'A' && code != "A4-Blank" {
			paper = code
		}
		if _, err := q.Exec(ctx, `INSERT INTO barcode_label_templates (store_id, code, name, paper, columns_n, rows_n, dims, fonts, visible, legacy_id)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$2) ON CONFLICT (store_id, code) DO UPDATE SET name=EXCLUDED.name, dims=EXCLUDED.dims, fonts=EXCLUDED.fonts, visible=EXCLUDED.visible`,
			im.storeID, r.Str("barcodeform_id"), r.Str("barcodeform_name"), paper, r.Int("barcodeform_columns"), r.Int("barcodeform_rows"), db, fb, vb); err != nil {
			return fmt.Errorf("label template %s: %w", r.Str("barcodeform_id"), err)
		}
		sr.RowsOut++
		return nil
	}); err != nil {
		return err
	}
	return nil
}
