package memberuc

import (
	"bytes"
	"crypto/rand"
	"strings"
	"testing"

	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

func TestGenerateLinkCode(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 200; i++ {
		code, err := GenerateLinkCode(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != linkCodeLen {
			t.Fatalf("code %q has length %d", code, len(code))
		}
		if !ValidLinkCode(code) {
			t.Fatalf("generated code %q is not valid", code)
		}
		if strings.ToUpper(code) != code {
			t.Fatalf("code %q is not upper-case", code)
		}
		if strings.ContainsAny(code, "01OI") {
			t.Fatalf("code %q contains an ambiguous glyph", code)
		}
		seen[code] = true
	}
	if len(seen) < 190 {
		t.Fatalf("expected mostly unique codes, got %d distinct of 200", len(seen))
	}
}

func TestGenerateLinkCodeDeterministic(t *testing.T) {
	// byte i → alphabet[i % 32]
	src := bytes.NewReader([]byte{0, 1, 31, 32, 33, 255})
	code, err := GenerateLinkCode(src)
	if err != nil {
		t.Fatal(err)
	}
	if code != "AB9AB9" {
		t.Fatalf("got %q", code)
	}
	if _, err := GenerateLinkCode(bytes.NewReader([]byte{1, 2})); err == nil {
		t.Fatal("expected error on short random source")
	}
}

func TestNormalizeAndValidateLinkCode(t *testing.T) {
	cases := []struct {
		in    string
		norm  string
		valid bool
	}{
		{"abc234", "ABC234", true},
		{" ab-c 23_4 ", "ABC234", true},
		{"ABCDEF", "ABCDEF", true},
		{"ABC23", "ABC23", false},     // too short
		{"ABC2345", "ABC2345", false}, // too long
		{"ABC0DE", "ABC0DE", false},   // 0 not in alphabet
		{"ABCIDE", "ABCIDE", false},   // I not in alphabet
		{"abc1de", "ABC1DE", false},   // 1 not in alphabet
		{"", "", false},
		{"ABC2D!", "ABC2D!", false},
	}
	for _, c := range cases {
		n := NormalizeLinkCode(c.in)
		if n != c.norm {
			t.Errorf("NormalizeLinkCode(%q) = %q want %q", c.in, n, c.norm)
		}
		if got := ValidLinkCode(n); got != c.valid {
			t.Errorf("ValidLinkCode(%q) = %v want %v", n, got, c.valid)
		}
	}
}

func d(s string) decimal.Decimal { return decimal.RequireFromString(s) }

func TestApplyShare(t *testing.T) {
	cases := []struct {
		name    string
		balance string
		typ     domain.ShareTxType
		amount  string
		signed  string
		after   string
		err     error
	}{
		{"deposit", "100", domain.ShareDeposit, "50.005", "50.01", "150.01", nil},
		{"withdraw ok", "100", domain.ShareWithdraw, "40", "-40", "60", nil},
		{"withdraw all", "100", domain.ShareWithdraw, "100", "-100", "0", nil},
		{"withdraw too much", "100", domain.ShareWithdraw, "100.01", "", "", domain.ErrShareInsufficient},
		{"adjust up", "100", domain.ShareAdjust, "5", "5", "105", nil},
		{"adjust down", "100", domain.ShareAdjust, "-30", "-30", "70", nil},
		{"adjust below zero", "100", domain.ShareAdjust, "-130", "", "", domain.ErrShareInsufficient},
		{"adjust zero", "100", domain.ShareAdjust, "0", "", "", domain.ErrValidation},
		{"deposit negative", "100", domain.ShareDeposit, "-1", "", "", domain.ErrValidation},
		{"withdraw zero", "100", domain.ShareWithdraw, "0", "", "", domain.ErrValidation},
		{"opening not manual", "100", domain.ShareOpening, "1", "", "", domain.ErrValidation},
	}
	for _, c := range cases {
		signed, after, err := applyShare(d(c.balance), c.typ, d(c.amount))
		if c.err != nil {
			// domain errors carry params via copies, so compare by code rather than identity.
			if err == nil || domain.AsError(err).Code != domain.AsError(c.err).Code {
				t.Errorf("%s: err = %v want %v", c.name, err, c.err)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s: unexpected error %v", c.name, err)
			continue
		}
		if !signed.Equal(d(c.signed)) || !after.Equal(d(c.after)) {
			t.Errorf("%s: got (%s,%s) want (%s,%s)", c.name, signed, after, c.signed, c.after)
		}
	}
}

func TestEstimateDividend(t *testing.T) {
	rate := d("0.5")
	rebate := d("0.02")
	// no statement: 1 share per baht
	est := estimateDividend(postgres.DividendRates{BEYear: 2568, RatePerShare: &rate, RebateRate: &rebate}, d("1000"), d("25000"), nil)
	if !est.Shares.Equal(d("1000")) || est.ShareDividend == nil || !est.ShareDividend.Equal(d("500")) || est.Rebate == nil || !est.Rebate.Equal(d("500")) || est.Total == nil || !est.Total.Equal(d("1000")) {
		t.Fatalf("unexpected estimate %+v", est)
	}
	// statement ratio: 100 shares for ฿1000 → 0.1 share per baht
	last := &postgres.DividendHistoryRow{ShareCapital: d("1000"), Shares: d("100")}
	est = estimateDividend(postgres.DividendRates{BEYear: 2568, RatePerShare: &rate}, d("2000"), d("25000"), last)
	if !est.Shares.Equal(d("200")) || est.ShareDividend == nil || !est.ShareDividend.Equal(d("100")) || est.Rebate != nil || est.Total == nil || !est.Total.Equal(d("100")) {
		t.Fatalf("unexpected estimate %+v", est)
	}
	// no rates at all → no totals
	est = estimateDividend(postgres.DividendRates{BEYear: 2567}, d("2000"), d("25000"), nil)
	if est.ShareDividend != nil || est.Rebate != nil || est.Total != nil || est.BasedOnYear != 2567 {
		t.Fatalf("unexpected estimate %+v", est)
	}
}
