// Package productuc manages the catalogue: categories, units, suppliers, products, barcodes, prices and labels.
package productuc

import (
	"crypto/rand"
	"encoding/hex"
	"strings"

	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
)

// StockLevel classifies a stock position against the two reorder thresholds.
// critical: stock <= min_level2 (when min_level2 > 0); warning: stock <= min_level1 (when min_level1 > 0); else ok.
func StockLevel(stock, min1, min2 decimal.Decimal) string {
	if min2.Sign() > 0 && stock.LessThanOrEqual(min2) {
		return domain.StockLevelCritical
	}
	if min1.Sign() > 0 && stock.LessThanOrEqual(min1) {
		return domain.StockLevelWarning
	}
	return domain.StockLevelOK
}

// ResolveSKU picks the product sku: explicit sku, else the primary barcode, else a random SKU-XXXXXXXX.
func ResolveSKU(sku string, barcodes []string) string {
	if s := strings.TrimSpace(sku); s != "" {
		return s
	}
	for _, b := range barcodes {
		if b = strings.TrimSpace(b); b != "" {
			return b
		}
	}
	return "SKU-" + randomToken(4)
}

func randomToken(nBytes int) string {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		return "00000000"
	}
	return strings.ToUpper(hex.EncodeToString(b))
}

// normalizeBarcodes trims, de-duplicates and drops empty codes, keeping order.
func normalizeBarcodes(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, b := range in {
		b = strings.TrimSpace(b)
		if b == "" || seen[b] {
			continue
		}
		seen[b] = true
		out = append(out, b)
	}
	return out
}

// validTiers rejects tiers outside 1..4 and negative prices.
func validTiers(t domain.PriceTiers) bool {
	for tier, price := range t {
		if tier < 1 || tier > 4 || price.IsNegative() {
			return false
		}
	}
	return true
}
