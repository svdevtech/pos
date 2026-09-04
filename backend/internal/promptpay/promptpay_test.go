package promptpay

import (
	"strings"
	"testing"

	"github.com/shopspring/decimal"
)

func TestParseTarget(t *testing.T) {
	cases := []struct{ in, tag, value, kind string }{
		{"081-234-5678", "01", "0066812345678", "phone"},
		{"0812345678", "01", "0066812345678", "phone"},
		{"66812345678", "01", "0066812345678", "phone"},
		{"1-2345-67890-12-3", "02", "1234567890123", "national_id"},
		{"004999123456789", "03", "004999123456789", "ewallet"},
	}
	for _, c := range cases {
		got, err := ParseTarget(c.in)
		if err != nil {
			t.Fatalf("%s: %v", c.in, err)
		}
		if got.Tag != c.tag || got.Value != c.value || got.Kind != c.kind {
			t.Fatalf("%s: got %+v", c.in, got)
		}
	}
	for _, bad := range []string{"", "12345", "abc", "08123456789012345678"} {
		if _, err := ParseTarget(bad); err == nil {
			t.Fatalf("%q should be rejected", bad)
		}
	}
}

// Reference payloads produced by the published PromptPay examples.
func TestPayload(t *testing.T) {
	tgt, _ := ParseTarget("0812345678")

	static, err := Payload(tgt, decimal.Zero, "")
	if err != nil {
		t.Fatal(err)
	}
	const wantStatic = "00020101021129370016A0000006770101110113006681234567853037645802TH6304823E"
	if static != wantStatic {
		t.Fatalf("static payload = %s", static)
	}
	if !checksumOK(static) {
		t.Fatalf("bad checksum: %s", static)
	}

	dyn, err := Payload(tgt, decimal.RequireFromString("101.50"), "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(dyn, "540610"+"1.50") {
		t.Fatalf("amount not encoded: %s", dyn)
	}
	if !strings.HasPrefix(dyn, "000201010212") {
		t.Fatalf("dynamic code should use point-of-initiation 12: %s", dyn)
	}
	if !checksumOK(dyn) {
		t.Fatalf("bad checksum: %s", dyn)
	}
}

func TestPayloadName(t *testing.T) {
	tgt, _ := ParseTarget("0812345678")
	out, err := Payload(tgt, decimal.NewFromInt(20), "ร้านค้าชุมชนบ้านแก่น Ban Kaen Shop Cooperative Store")
	if err != nil {
		t.Fatal(err)
	}
	// Thai characters cannot travel in tag 59; the ASCII part is kept and capped at 25.
	if !strings.Contains(out, "5925Ban Kaen Shop Cooperat") {
		t.Fatalf("name field wrong: %s", out)
	}
	if !checksumOK(out) {
		t.Fatalf("bad checksum: %s", out)
	}
}

// checksumOK re-computes the trailing CRC the way a banking app does.
func checksumOK(payload string) bool {
	if len(payload) < 8 {
		return false
	}
	body, sum := payload[:len(payload)-4], payload[len(payload)-4:]
	want := crc16(body)
	return strings.EqualFold(sum, strings.ToUpper(hex4(want)))
}

func hex4(v uint16) string {
	const digits = "0123456789ABCDEF"
	return string([]byte{digits[v>>12&0xF], digits[v>>8&0xF], digits[v>>4&0xF], digits[v&0xF]})
}
