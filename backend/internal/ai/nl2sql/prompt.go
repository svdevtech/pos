package nl2sql

import "strings"

// Schema is the condensed schema description handed to the model (only whitelisted tables).
const Schema = `Tables (PostgreSQL, all rows already filtered to the current store; NEVER filter by store_id yourself):
sales(id, doc_no, sold_at timestamptz, cashier_name, member_id, gross, discount, net, tendered, change_amount, status['completed','cancelled','refunded','partial_refund'], ar_status['none','unpaid','partial','paid'], ar_total, ar_paid, ar_balance)
sale_lines(id, sale_id, line_no, product_id, sku, description, qty, unit_price, discount, line_total, cost_avg, is_free)
sale_payments(id, sale_id, method['cash','credit','transfer','card','qr','other'], amount)
sale_returns(id, doc_no, sale_id, returned_at, refund_amount) ; sale_return_lines(return_id, sale_line_id, product_id, qty, amount)
ar_payments(id, member_id, sale_id, amount, paid_at, method)
products(id, sku, name, category_id, unit_id, cost_last, cost_avg, sell_price, stock_on_hand, min_level1, min_level2, is_active, is_archived)
product_categories(id, name) ; units(id, name) ; product_barcodes(product_id, barcode) ; suppliers(id, name, phone)
members(id, member_code, name, phone, share_capital, joined_at, is_walkin, status)
member_share_transactions(member_id, tx_type, amount, balance_after, occurred_at)
purchase_receipts(id, doc_no, supplier_id, received_at, total, status) ; purchase_receipt_lines(receipt_id, product_id, qty, unit_cost, total)
stock_movements(product_id, move_type, qty_delta, balance_after, occurred_at)
expenses(id, type_id, expensed_at date, amount, note) ; expense_types(id, name)
shifts(id, cashier_id, opened_at, closed_at, opening_float, cash_sales, counted_cash, variance, status)
promotions(id, name, scope, discount_type, discount_value, is_active)
dividend_periods(id, be_year, net_profit, status) ; dividend_member_statements(run_id, member_id, member_code, member_name, shares, purchases, share_dividend, rebate, total)
Notes: dates are stored in UTC; convert with (sold_at AT TIME ZONE 'Asia/Bangkok') for day/month grouping. Thai Buddhist year = Gregorian + 543. "ยอดขาย" = sum(net) of sales with status <> 'cancelled'. "กำไร" = sum(line_total - qty*cost_avg) from sale_lines joined to completed sales.`

// SystemPrompt instructs the model to answer with one SELECT only.
const SystemPrompt = `You are a PostgreSQL analyst for a Thai community co-op store POS. Given the schema and a question (Thai or English),
reply with ONE read-only SQL SELECT (or WITH … SELECT) statement and nothing else — no explanation, no markdown other than an optional sql code fence.
Rules: never modify data; never reference tables outside the schema; add ORDER BY where useful; alias columns with short readable names (Thai allowed);
use LIMIT 200 unless the question asks for a single aggregate; round money to 2 decimals.`

// ExplainPrompt asks for a short natural-language explanation of the result.
const ExplainPrompt = `You are a helpful analyst for a Thai co-op store. Summarise the query result for the manager in the user's language (Thai if the question is Thai) in at most 5 sentences, citing the key numbers. Do not invent numbers that are not in the result.`

func BuildUserPrompt(question string, hints []string) string {
	var b strings.Builder
	b.WriteString("Schema:\n")
	b.WriteString(Schema)
	if len(hints) > 0 {
		b.WriteString("\n\nPrevious attempt problems:\n- ")
		b.WriteString(strings.Join(hints, "\n- "))
	}
	b.WriteString("\n\nQuestion: ")
	b.WriteString(strings.TrimSpace(question))
	b.WriteString("\nSQL:")
	return b.String()
}
