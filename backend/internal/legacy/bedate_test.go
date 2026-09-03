package legacy

import (
	"testing"
	"time"
)

func TestParseBEDateTime(t *testing.T) {
	got, ok := ParseBEDateTime("2/1/2563  14:42:36")
	if !ok {
		t.Fatal("expected ok")
	}
	if got.Year() != 2020 || got.Month() != 1 || got.Day() != 2 || got.Hour() != 14 || got.Minute() != 42 || got.Second() != 36 {
		t.Fatalf("got %v", got)
	}
	if _, ok := ParseBEDateTime(""); ok {
		t.Fatal("empty should fail")
	}
	got, ok = ParseBEDateTime("28/2/2566  6:54:35")
	if !ok || got.Year() != 2023 || got.Hour() != 6 {
		t.Fatalf("got %v %v", got, ok)
	}
	got, ok = ParseBEDateTime("11/11/2018")
	if !ok || got.Year() != 2018 {
		t.Fatalf("gregorian: %v %v", got, ok)
	}
}

func TestCombineDateTime(t *testing.T) {
	d := time.Date(2023, 2, 28, 0, 0, 0, 0, Bangkok)
	got := CombineDateTime(d, "9:02")
	if got.Hour() != 9 || got.Minute() != 2 {
		t.Fatalf("got %v", got)
	}
	got = CombineDateTime(d, "")
	if got.Hour() != 0 {
		t.Fatalf("got %v", got)
	}
}

func TestPeriodFromDocNo(t *testing.T) {
	p, n, ok := PeriodFromDocNo("N6602-05115")
	if !ok || p != "6602" || n != 5115 {
		t.Fatalf("%s %d %v", p, n, ok)
	}
	p, n, ok = PeriodFromDocNo("OD6602-00005")
	if !ok || p != "6602" || n != 5 {
		t.Fatalf("%s %d %v", p, n, ok)
	}
	if _, _, ok := PeriodFromDocNo("bad"); ok {
		t.Fatal("expected fail")
	}
}

func TestRowAccessors(t *testing.T) {
	r := Row{"a": "  x ", "b": 12.5, "c": nil, "d": "2023-02-28T00:00:00"}
	if r.Str("a") != "x" || r.Dec("b").String() != "12.5" || r.Str("c") != "" || !r.IsNull("c") {
		t.Fatal("accessors")
	}
	d, ok := r.Date("d")
	if !ok || d.Day() != 28 || d.Location() != Bangkok {
		t.Fatalf("date %v %v", d, ok)
	}
}
