package reportuc

import (
	"strings"
	"testing"
	"time"

	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/repository/postgres"
)

var testNow = time.Date(2026, 9, 2, 15, 30, 0, 0, time.UTC) // 22:30 Bangkok, 2026-09-02

func TestParseRange(t *testing.T) {
	cases := []struct {
		name, from, to, group string
		wantFrom, wantTo      string
		wantGroup             string
		wantDays              int
		wantErr               bool
	}{
		{name: "default today", wantFrom: "2026-09-02", wantTo: "2026-09-02", wantGroup: "day", wantDays: 1},
		{name: "from only", from: "2026-08-01", wantFrom: "2026-08-01", wantTo: "2026-08-01", wantGroup: "day", wantDays: 1},
		{name: "to only", to: "2026-08-10", wantFrom: "2026-08-10", wantTo: "2026-08-10", wantGroup: "day", wantDays: 1},
		{name: "range month", from: "2026-08-01", to: "2026-08-31", group: "month", wantFrom: "2026-08-01", wantTo: "2026-08-31", wantGroup: "month", wantDays: 31},
		{name: "reversed", from: "2026-08-31", to: "2026-08-01", wantErr: true},
		{name: "bad date", from: "2026-13-01", wantErr: true},
		{name: "bad group", group: "week", wantErr: true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rg, err := ParseRange(c.from, c.to, c.group, testNow)
			if c.wantErr {
				if err == nil {
					t.Fatalf("expected error, got %+v", rg)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if rg.From != c.wantFrom || rg.To != c.wantTo || rg.Group != c.wantGroup {
				t.Fatalf("got %s..%s %s, want %s..%s %s", rg.From, rg.To, rg.Group, c.wantFrom, c.wantTo, c.wantGroup)
			}
			if rg.Days() != c.wantDays {
				t.Fatalf("days = %d, want %d", rg.Days(), c.wantDays)
			}
			if h, m, s := rg.Start.In(Location).Clock(); h != 0 || m != 0 || s != 0 {
				t.Fatalf("start not at Bangkok midnight: %v", rg.Start)
			}
			if !rg.End.After(rg.Start) {
				t.Fatalf("end %v not after start %v", rg.End, rg.Start)
			}
		})
	}
}

func TestParseYear(t *testing.T) {
	cases := []struct {
		in      string
		want    int
		wantErr bool
	}{
		{"", 2026, false},
		{"2025", 2025, false},
		{"2569", 2026, false}, // BE -> CE
		{" 2568 ", 2025, false},
		{"abc", 0, true},
		{"1800", 0, true},
	}
	for _, c := range cases {
		got, err := ParseYear(c.in, testNow)
		if (err != nil) != c.wantErr {
			t.Fatalf("%q: err=%v wantErr=%v", c.in, err, c.wantErr)
		}
		if got != c.want {
			t.Fatalf("%q: got %d want %d", c.in, got, c.want)
		}
	}
}

func TestParseDate(t *testing.T) {
	s, d, err := ParseDate("", "as_of", testNow)
	if err != nil || s != "2026-09-02" || d.In(Location).Hour() != 0 {
		t.Fatalf("default: %s %v %v", s, d, err)
	}
	if _, _, err := ParseDate("nope", "as_of", testNow); err == nil {
		t.Fatal("expected error")
	}
}

func TestEncodeCSV(t *testing.T) {
	bom := string([]byte{0xEF, 0xBB, 0xBF})
	b := EncodeCSV([]string{"a", "b"}, [][]string{{"1", "x,y"}, {"2", "ก"}})
	s := string(b)
	if !strings.HasPrefix(s, bom) {
		t.Fatalf("missing BOM, got % x", b[:3])
	}
	want := bom + "a,b\r\n1,\"x,y\"\r\n2,ก\r\n"
	if s != want {
		t.Fatalf("got %q want %q", s, want)
	}
}

func TestDailySalesCSV(t *testing.T) {
	d := &DailySales{Range: Range{From: "2026-09-01", To: "2026-09-02"}}
	d.Rows = []postgres.PeriodSalesRow{{Period: "2026-09-01", Bills: 2, Net: decimal.RequireFromString("100"), Cost: decimal.RequireFromString("60.5")}}
	d.Total = postgres.PeriodSalesRow{Period: "total", Bills: 2, Net: decimal.RequireFromString("100"), Cost: decimal.RequireFromString("60.5"), Margin: decimal.RequireFromString("39.5"), MarginPct: decimal.RequireFromString("39.5")}
	h, rows := d.CSVTable()
	if len(h) != 15 || len(rows) != 2 {
		t.Fatalf("header %d rows %d", len(h), len(rows))
	}
	if rows[1][0] != "total" || rows[1][4] != "100.00" || rows[1][12] != "60.50" || rows[1][14] != "39.50" {
		t.Fatalf("unexpected total row %v", rows[1])
	}
}

func TestPctAvgFill(t *testing.T) {
	if got := pct(decimal.NewFromInt(1), decimal.NewFromInt(3)); got.String() != "33.33" {
		t.Fatalf("pct = %s", got)
	}
	if !pct(decimal.NewFromInt(1), decimal.Zero).IsZero() {
		t.Fatal("pct by zero should be 0")
	}
	if got := avg(decimal.NewFromInt(10), 4); got.String() != "2.5" {
		t.Fatalf("avg = %s", got)
	}
	if !avg(decimal.NewFromInt(10), 0).IsZero() {
		t.Fatal("avg by zero should be 0")
	}
	hours := fillHours([]postgres.HourSalesRow{{Hour: 9, Bills: 3, Net: decimal.NewFromInt(30)}, {Hour: 25}})
	if len(hours) != 24 || hours[9].Bills != 3 || hours[0].Hour != 0 || hours[23].Hour != 23 {
		t.Fatalf("fillHours = %+v", hours)
	}
	months := fillMonths([]postgres.MonthRow{{Month: 12, Bills: 1, Net: decimal.NewFromInt(5)}})
	if len(months) != 12 || months[11].Bills != 1 || months[0].MonthNameTH != "มกราคม" || months[11].MonthNameEN != "December" {
		t.Fatalf("fillMonths = %+v", months)
	}
}
