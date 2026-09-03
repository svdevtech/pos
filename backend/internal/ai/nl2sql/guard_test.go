package nl2sql

import (
	"strings"
	"testing"
)

func TestGuardAcceptsSelect(t *testing.T) {
	sql, err := Guard("```sql\nSELECT p.name, sum(l.qty) AS qty FROM sale_lines l JOIN products p ON p.id=l.product_id GROUP BY 1 ORDER BY 2 DESC;\n```", 100)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(sql, "LIMIT 100") {
		t.Fatalf("limit not appended: %s", sql)
	}
	if _, err := Guard("WITH x AS (SELECT net FROM sales) SELECT sum(net) FROM x LIMIT 5", 100); err != nil {
		t.Fatal(err)
	}
}

func TestGuardRejects(t *testing.T) {
	bad := []string{
		"DELETE FROM sales",
		"SELECT * FROM sales; DROP TABLE sales",
		"SELECT * FROM users",
		"SELECT * FROM pg_catalog.pg_tables",
		"SELECT current_setting('app.current_store_id')",
		"SELECT * FROM sales -- comment",
		"UPDATE products SET sell_price=0",
		"SELECT 1",
		"SELECT * FROM sales WHERE id IN (SELECT id FROM audit_logs)",
		"SELECT set_config('app.bypass_rls','on',true) FROM sales",
	}
	for _, s := range bad {
		if _, err := Guard(s, 10); err == nil {
			t.Errorf("expected rejection: %s", s)
		}
	}
}

func TestClean(t *testing.T) {
	if got := Clean("Here is the query:\n```sql\nSELECT 1 FROM sales;\n```\nIt lists…"); got != "SELECT 1 FROM sales" {
		t.Fatalf("got %q", got)
	}
}
