package i18n

import "testing"

func TestCatalogueParity(t *testing.T) {
	missingEN, missingTH := MissingIn()
	if len(missingEN) > 0 {
		t.Errorf("codes missing English message: %v", missingEN)
	}
	if len(missingTH) > 0 {
		t.Errorf("codes missing Thai message: %v", missingTH)
	}
}

func TestMessageParams(t *testing.T) {
	got := Message(EN, "SALE_PAYMENT_SHORT", map[string]any{"short": "12.50"})
	if got != "Payment is short by 12.50" {
		t.Fatalf("unexpected: %q", got)
	}
	if Message(TH, "NOPE", nil) == "" {
		t.Fatal("unknown code should fall back")
	}
}

func TestFromAcceptLanguage(t *testing.T) {
	if FromAcceptLanguage("en-US,en;q=0.9,th;q=0.8", TH) != EN {
		t.Fatal("expected en")
	}
	if FromAcceptLanguage("", TH) != TH {
		t.Fatal("expected default th")
	}
	if FromAcceptLanguage("th-TH", EN) != TH {
		t.Fatal("expected th")
	}
}
