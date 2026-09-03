package legacy

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/repository/postgres"
)

// stageMembers imports customer → members (+ walk-in row) and opening share-capital transactions.
func (im *Importer) stageMembers(ctx context.Context, sr *StageReport) error {
	if err := im.loadCaches(ctx); err != nil {
		return err
	}
	q := postgres.Q(ctx)
	upsertMember := func(legacyID, name, address, phone, fax, email string, tier int, share decimal.Decimal, joined any, walkin bool) (uuid.UUID, bool, error) {
		var id uuid.UUID
		var isNew bool
		err := q.QueryRow(ctx, `INSERT INTO members (store_id, member_code, name, address, phone, email, share_capital, joined_at, price_tier, is_walkin, status, note, legacy_id)
			VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),$7,$8,$9,$10,'active',NULLIF($11,''),$2)
			ON CONFLICT (store_id, legacy_id) WHERE legacy_id IS NOT NULL DO UPDATE SET name=EXCLUDED.name, address=EXCLUDED.address, phone=EXCLUDED.phone, joined_at=EXCLUDED.joined_at
			RETURNING id, (xmax = 0)`,
			im.storeID, legacyID, name, address, phone, email, share, joined, tier, walkin, fax).Scan(&id, &isNew)
		return id, isNew, err
	}
	if err := EachRow(im.m.Path("customer"), func(_ int, r Row) error {
		sr.RowsIn++
		legacyID := r.Str("cust_id")
		if legacyID == "" {
			sr.Skipped++
			return nil
		}
		walkin := legacyID == "0"
		name := r.Str("cust_name")
		if name == "" {
			name = "[NO NAME] " + legacyID
		}
		var joined any
		if d, ok := r.Date("cust_datestart"); ok {
			joined = d
		}
		share := r.Dec("cust_hunmoney")
		fax := r.Str("cust_fax")
		if fax != "" {
			fax = "fax: " + fax
		}
		id, isNew, err := upsertMember(legacyID, name, r.Str("cust_address"), r.Str("cust_phone"), fax, r.Str("cust_email"), r.Int("cust_pricelevel"), share, joined, walkin)
		if err != nil {
			return fmt.Errorf("member %s: %w", legacyID, err)
		}
		im.members[legacyID] = id
		if walkin {
			im.walkinID = id
		}
		if isNew && share.IsPositive() {
			if _, err := q.Exec(ctx, `INSERT INTO member_share_transactions (store_id, member_id, tx_type, amount, balance_after, note, ref_type, occurred_at)
				VALUES ($1,$2,'opening',$3,$3,'ยอดหุ้นยกมาจากระบบเดิม (legacy)','legacy', COALESCE($4::timestamptz, now()))`, im.storeID, id, share, joined); err != nil {
				return fmt.Errorf("share opening %s: %w", legacyID, err)
			}
			sr.Extra["share_openings"] = asInt(sr.Extra["share_openings"]) + 1
		}
		if !isNew {
			sr.Skipped++
		}
		sr.RowsOut++
		return nil
	}); err != nil {
		return err
	}
	// guarantee a walk-in member exists
	if im.walkinID == uuid.Nil {
		id, _, err := upsertMember("0", "ไม่ระบุ", "", "", "", "", 0, decimal.Zero, nil, true)
		if err != nil {
			return fmt.Errorf("walk-in member: %w", err)
		}
		im.walkinID = id
		im.members["0"] = id
	}
	return nil
}

// placeholderMember creates an inactive member for a customer id referenced by sales but missing from customer.
func (im *Importer) placeholderMember(ctx context.Context, legacyID string) (uuid.UUID, error) {
	if id, ok := im.members[legacyID]; ok {
		return id, nil
	}
	var id uuid.UUID
	err := postgres.Q(ctx).QueryRow(ctx, `INSERT INTO members (store_id, member_code, name, status, note, legacy_id) VALUES ($1,$2,$3,'inactive','placeholder: referenced by legacy sales but missing from customer table',$2)
		ON CONFLICT (store_id, legacy_id) WHERE legacy_id IS NOT NULL DO UPDATE SET name=members.name RETURNING id`, im.storeID, legacyID, "[UNKNOWN] "+strings.TrimSpace(legacyID)).Scan(&id)
	if err != nil {
		return uuid.Nil, fmt.Errorf("placeholder member %s: %w", legacyID, err)
	}
	im.members[legacyID] = id
	return id, nil
}
