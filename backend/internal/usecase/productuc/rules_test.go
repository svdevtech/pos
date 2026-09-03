package productuc

import (
	"strings"
	"testing"

	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
)

func d(s string) decimal.Decimal { return decimal.RequireFromString(s) }

func TestStockLevel(t *testing.T) {
	cases := []struct {
		name              string
		stock, min1, min2 string
		want              string
	}{
		{"above both", "10", "5", "2", domain.StockLevelOK},
		{"at warning", "5", "5", "2", domain.StockLevelWarning},
		{"between", "3", "5", "2", domain.StockLevelWarning},
		{"at critical", "2", "5", "2", domain.StockLevelCritical},
		{"negative stock", "-1", "5", "2", domain.StockLevelCritical},
		{"no thresholds", "0", "0", "0", domain.StockLevelOK},
		{"only min1", "0", "1", "0", domain.StockLevelWarning},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := StockLevel(d(c.stock), d(c.min1), d(c.min2)); got != c.want {
				t.Fatalf("got %s want %s", got, c.want)
			}
		})
	}
}

func TestResolveSKU(t *testing.T) {
	if got := ResolveSKU(" ABC ", []string{"885"}); got != "ABC" {
		t.Fatalf("explicit sku: %q", got)
	}
	if got := ResolveSKU("", []string{"", " 885 "}); got != "885" {
		t.Fatalf("barcode fallback: %q", got)
	}
	got := ResolveSKU("", nil)
	if !strings.HasPrefix(got, "SKU-") || len(got) != 12 {
		t.Fatalf("generated sku: %q", got)
	}
}

func TestNormalizeBarcodes(t *testing.T) {
	got := normalizeBarcodes([]string{" a ", "", "b", "a"})
	if len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Fatalf("got %v", got)
	}
}

func TestValidTiers(t *testing.T) {
	if !validTiers(domain.PriceTiers{1: d("1"), 4: d("0")}) {
		t.Fatal("expected valid")
	}
	if validTiers(domain.PriceTiers{5: d("1")}) || validTiers(domain.PriceTiers{1: d("-1")}) {
		t.Fatal("expected invalid")
	}
}
