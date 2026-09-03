package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Document number prefixes (legacy-compatible where a legacy equivalent exists).
const (
	DocSale       = "sale"       // N6602-05115
	DocReceipt    = "receipt"    // OD6602-00005
	DocReturn     = "return"     // RT6602-00001
	DocAdjustment = "adjustment" // ADJ6602-00001
	DocStockTake  = "stocktake"  // ST6602-00001
	DocARPayment  = "arpay"      // RC6602-00001
	DocExpense    = "expense"    // EX6602-00001
)

var docPrefix = map[string]string{
	DocSale: "N", DocReceipt: "OD", DocReturn: "RT", DocAdjustment: "ADJ", DocStockTake: "ST", DocARPayment: "RC", DocExpense: "EX",
}

var bangkok = mustLoadTZ("Asia/Bangkok")

// Bangkok returns the store wall-clock zone used for business dates.
func Bangkok() *time.Location { return bangkok }

func mustLoadTZ(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		return time.FixedZone("ICT", 7*3600)
	}
	return loc
}

// Period returns the legacy period key: Buddhist-era 2-digit year + 2-digit month, e.g. 2023-02 → "6602".
func Period(at time.Time) string {
	t := at.In(bangkok)
	be := t.Year() + 543
	return fmt.Sprintf("%02d%02d", be%100, int(t.Month()))
}

// NextDocNo allocates the next document number for the store/type in the period of `at`.
// Must be called inside a transaction (uses Q(ctx)); the row lock serialises concurrent callers.
func NextDocNo(ctx context.Context, storeID uuid.UUID, docType string, at time.Time) (string, error) {
	prefix, okp := docPrefix[docType]
	if !okp {
		return "", fmt.Errorf("unknown doc type %q", docType)
	}
	period := Period(at)
	var seq int
	if err := Q(ctx).QueryRow(ctx, `SELECT next_doc_seq($1,$2,$3)`, storeID, docType, period).Scan(&seq); err != nil {
		return "", fmt.Errorf("next_doc_seq: %w", err)
	}
	return fmt.Sprintf("%s%s-%05d", prefix, period, seq), nil
}

// BumpDocSeq makes sure the sequence for (type, period) is at least `seq` (used by the legacy importer
// so new documents continue after the last imported number).
func BumpDocSeq(ctx context.Context, storeID uuid.UUID, docType, period string, seq int) error {
	_, err := Q(ctx).Exec(ctx, `INSERT INTO doc_sequences (store_id, doc_type, period, last_seq) VALUES ($1,$2,$3,$4)
		ON CONFLICT (store_id, doc_type, period) DO UPDATE SET last_seq = GREATEST(doc_sequences.last_seq, EXCLUDED.last_seq)`, storeID, docType, period, seq)
	return err
}
