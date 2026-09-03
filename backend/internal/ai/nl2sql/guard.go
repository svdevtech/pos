// Package nl2sql turns a natural-language question into a guarded, read-only, tenant-scoped SQL query.
package nl2sql

import (
	"errors"
	"regexp"
	"strings"
)

var (
	ErrNotSelect = errors.New("only a single SELECT/WITH statement is allowed")
	ErrForbidden = errors.New("query references a forbidden keyword or object")
	ErrNoTable   = errors.New("query does not reference a known table")
	ErrTooLong   = errors.New("query too long")
)

// AllowedTables is the whitelist the model may query (all carry store_id and are RLS-protected).
var AllowedTables = []string{
	"sales", "sale_lines", "sale_payments", "sale_returns", "sale_return_lines", "ar_payments",
	"products", "product_categories", "units", "product_barcodes", "price_tiers", "suppliers",
	"members", "member_share_transactions", "purchase_receipts", "purchase_receipt_lines",
	"stock_movements", "stock_adjustments", "stock_adjustment_lines", "stock_takes", "stock_take_lines",
	"expenses", "expense_types", "shifts", "cash_drawer_logs", "promotions",
	"dividend_periods", "dividend_criteria", "dividend_runs", "dividend_member_statements", "dividend_payouts",
}

var forbiddenRx = regexp.MustCompile(`(?i)\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|analyze|refresh|reindex|cluster|lock|listen|notify|do|call|execute|prepare|deallocate|set|reset|show|begin|commit|rollback|savepoint|into|pg_sleep|pg_read_file|pg_ls_dir|dblink|lo_import|lo_export|current_setting|set_config)\b`)
var systemRx = regexp.MustCompile(`(?i)\b(pg_catalog|information_schema|pg_[a-z_]+|users|refresh_tokens|stores|store_settings|audit_logs|ai_query_logs|legacy_[a-z_]+|doc_sequences|held_bills)\b`)
var limitRx = regexp.MustCompile(`(?i)\blimit\s+\d+`)
var fenceRx = regexp.MustCompile("(?s)```(?:sql)?\\s*(.*?)```")

const maxLen = 6000

// Clean extracts SQL from a model answer (strips code fences, trailing semicolons, explanations after the statement).
func Clean(answer string) string {
	s := strings.TrimSpace(answer)
	if m := fenceRx.FindStringSubmatch(s); m != nil {
		s = strings.TrimSpace(m[1])
	}
	// keep from the first SELECT/WITH
	up := strings.ToUpper(s)
	i := strings.Index(up, "SELECT")
	if j := strings.Index(up, "WITH"); j >= 0 && (i < 0 || j < i) {
		i = j
	}
	if i > 0 {
		s = s[i:]
	}
	s = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(s), ";"))
	return s
}

// Guard validates the statement and returns it with an enforced LIMIT.
func Guard(sql string, maxRows int) (string, error) {
	sql = Clean(sql)
	if len(sql) > maxLen {
		return "", ErrTooLong
	}
	if sql == "" {
		return "", ErrNotSelect
	}
	up := strings.ToUpper(sql)
	if !(strings.HasPrefix(up, "SELECT") || strings.HasPrefix(up, "WITH")) {
		return "", ErrNotSelect
	}
	if strings.Contains(sql, ";") {
		return "", ErrNotSelect
	}
	if strings.Contains(sql, "--") || strings.Contains(sql, "/*") {
		return "", ErrForbidden
	}
	if forbiddenRx.MatchString(sql) {
		return "", ErrForbidden
	}
	if systemRx.MatchString(sql) {
		return "", ErrForbidden
	}
	found := false
	for _, t := range AllowedTables {
		if regexp.MustCompile(`(?i)\b` + t + `\b`).MatchString(sql) {
			found = true
			break
		}
	}
	if !found {
		return "", ErrNoTable
	}
	if maxRows <= 0 {
		maxRows = 200
	}
	if !limitRx.MatchString(sql) {
		sql = sql + " LIMIT " + itoa(maxRows)
	}
	return sql, nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
