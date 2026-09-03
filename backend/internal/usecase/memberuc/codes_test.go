package memberuc

import "testing"

func TestNumericMemberCode(t *testing.T) {
	cases := []struct {
		in   string
		want int64
		ok   bool
	}{
		{"123", 123, true},
		{" 0042 ", 42, true},
		{"M17", 17, true},
		{"m17", 17, true},
		{"0", 0, true},
		{"M", 0, false},
		{"", 0, false},
		{"A12", 0, false},
		{"12A", 0, false},
		{"MM12", 0, false},
		{"1234567890123456", 0, false}, // 16 digits: outside the 15-digit guard
	}
	for _, c := range cases {
		got, ok := NumericMemberCode(c.in)
		if ok != c.ok || got != c.want {
			t.Errorf("NumericMemberCode(%q) = (%d,%v) want (%d,%v)", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestNextMemberCode(t *testing.T) {
	cases := []struct {
		max  int64
		want string
	}{
		{0, "M1"},
		{-5, "M1"},
		{1234, "M1235"},
		{99999, "M100000"},
	}
	for _, c := range cases {
		if got := NextMemberCode(c.max); got != c.want {
			t.Errorf("NextMemberCode(%d) = %q want %q", c.max, got, c.want)
		}
	}
}

func TestMaxNumericCode(t *testing.T) {
	cases := []struct {
		codes []string
		want  int64
	}{
		{nil, 0},
		{[]string{"A1", "B2"}, 0},
		{[]string{"0", "12", "M15", "9", "X99"}, 15},
		{[]string{"M7", "m8", "8"}, 8},
	}
	for _, c := range cases {
		if got := MaxNumericCode(c.codes); got != c.want {
			t.Errorf("MaxNumericCode(%v) = %d want %d", c.codes, got, c.want)
		}
	}
	// generated codes feed back into the sequence
	max := MaxNumericCode([]string{"1234"})
	next := NextMemberCode(max)
	if got := MaxNumericCode([]string{"1234", next}); got != 1235 {
		t.Fatalf("expected generated code %q to advance the sequence, got max %d", next, got)
	}
}

func TestNormalizePhone(t *testing.T) {
	if got := NormalizePhone(" 081-234 5678 "); got != "0812345678" {
		t.Fatalf("got %q", got)
	}
	if got := NormalizePhone("(02) 123-4567"); got != "021234567" {
		t.Fatalf("got %q", got)
	}
}
