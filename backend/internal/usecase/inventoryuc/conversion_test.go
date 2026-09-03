package inventoryuc

import "testing"

func TestConversionCost(t *testing.T) {
	tests := []struct {
		name                    string
		fromQty, costAvg, toQty string
		total, unit             string
	}{
		{"2 crates of beer at 240 become 24 bottles", "2", "240", "24", "480", "20"},
		{"a single crate", "1", "255.50", "12", "255.5", "21.2917"},
		{"fractional pack", "0.5", "100", "6", "50", "8.3333"},
		{"zero cost keeps zero", "3", "0", "36", "0", "0"},
		{"guards against dividing by nothing", "1", "10", "0", "10", "0"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			total, unit := ConversionCost(d(tt.fromQty), d(tt.costAvg), d(tt.toQty))
			if !total.Equal(d(tt.total)) {
				t.Errorf("total = %s, want %s", total, tt.total)
			}
			if !unit.Equal(d(tt.unit)) {
				t.Errorf("unit = %s, want %s", unit, tt.unit)
			}
		})
	}
}

// The value of what leaves must equal the value of what arrives.
func TestConversionKeepsStockValue(t *testing.T) {
	fromQty, costAvg, toQty := d("5"), d("187.25"), d("60")
	total, unit := ConversionCost(fromQty, costAvg, toQty)
	if got := unit.Mul(toQty).Round(2); !got.Equal(total.Round(2)) {
		t.Fatalf("value drifted: %s produced vs %s consumed", got, total.Round(2))
	}
}
