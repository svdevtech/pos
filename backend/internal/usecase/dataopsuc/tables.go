package dataopsuc

// tableSpec describes how one table takes part in a store backup.
//
// Order matters: parents first, so a restore can insert straight down the list and delete back up
// it. Tables carrying `store_id` are filtered on it; the four line tables that hang off a parent
// (and inherit its tenant through the FK) are filtered by a join instead.
type tableSpec struct {
	name string
	// where is the SQL predicate selecting the store's rows, with $1 = store id.
	where string
	// scoped tables get their store_id rewritten on restore.
	scoped bool
}

var backupTables = []tableSpec{
	{name: "store_settings", where: "t.store_id = $1", scoped: true},
	{name: "users", where: "t.store_id = $1", scoped: true},
	{name: "doc_sequences", where: "t.store_id = $1", scoped: true},
	{name: "product_categories", where: "t.store_id = $1", scoped: true},
	{name: "units", where: "t.store_id = $1", scoped: true},
	{name: "suppliers", where: "t.store_id = $1", scoped: true},
	{name: "products", where: "t.store_id = $1", scoped: true},
	{name: "product_barcodes", where: "t.store_id = $1", scoped: true},
	{name: "price_tiers", where: "EXISTS (SELECT 1 FROM products p WHERE p.id = t.product_id AND p.store_id = $1)"},
	{name: "barcode_label_templates", where: "t.store_id = $1", scoped: true},
	{name: "members", where: "t.store_id = $1", scoped: true},
	{name: "member_share_transactions", where: "t.store_id = $1", scoped: true},
	{name: "member_link_codes", where: "t.store_id = $1", scoped: true},
	{name: "promotions", where: "t.store_id = $1", scoped: true},
	{name: "expense_types", where: "t.store_id = $1", scoped: true},
	{name: "shifts", where: "t.store_id = $1", scoped: true},
	{name: "cash_drawer_logs", where: "t.store_id = $1", scoped: true},
	{name: "held_bills", where: "t.store_id = $1", scoped: true},
	{name: "sales", where: "t.store_id = $1", scoped: true},
	{name: "sale_lines", where: "t.store_id = $1", scoped: true},
	{name: "sale_payments", where: "t.store_id = $1", scoped: true},
	{name: "sale_returns", where: "t.store_id = $1", scoped: true},
	{name: "sale_return_lines", where: "EXISTS (SELECT 1 FROM sale_returns r WHERE r.id = t.return_id AND r.store_id = $1)"},
	{name: "ar_payments", where: "t.store_id = $1", scoped: true},
	{name: "purchase_receipts", where: "t.store_id = $1", scoped: true},
	{name: "purchase_receipt_lines", where: "t.store_id = $1", scoped: true},
	{name: "stock_adjustments", where: "t.store_id = $1", scoped: true},
	{name: "stock_adjustment_lines", where: "EXISTS (SELECT 1 FROM stock_adjustments a WHERE a.id = t.adjustment_id AND a.store_id = $1)"},
	{name: "stock_takes", where: "t.store_id = $1", scoped: true},
	{name: "stock_take_lines", where: "EXISTS (SELECT 1 FROM stock_takes s WHERE s.id = t.stock_take_id AND s.store_id = $1)"},
	{name: "stock_movements", where: "t.store_id = $1", scoped: true},
	{name: "expenses", where: "t.store_id = $1", scoped: true},
	{name: "dividend_periods", where: "t.store_id = $1", scoped: true},
	{name: "dividend_criteria", where: "t.store_id = $1", scoped: true},
	{name: "dividend_runs", where: "t.store_id = $1", scoped: true},
	{name: "dividend_member_statements", where: "t.store_id = $1", scoped: true},
	{name: "dividend_payouts", where: "t.store_id = $1", scoped: true},
}

// Deliberately not backed up: refresh_tokens (sessions), audit_logs and ai_query_logs (history of
// this deployment, not store data), legacy_import_runs/legacy_orphans (import bookkeeping).
