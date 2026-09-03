package legacy

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/repository/postgres"
)

// stageDividends imports criteriondividend → dividend_periods/criteria (per BE year) and the last
// computed statement set (temps2, BE 2565) as a final run with member statements.
func (im *Importer) stageDividends(ctx context.Context, sr *StageReport) error {
	if err := im.loadCaches(ctx); err != nil {
		return err
	}
	q := postgres.Q(ctx)
	rows, err := ReadAll(im.m.Path("criteriondividend"))
	if err != nil {
		return err
	}
	byYear := map[int][]Row{}
	for _, r := range rows {
		y, err := strconv.Atoi(r.Str("criteriondividend_year"))
		if err != nil {
			sr.Skipped++
			continue
		}
		byYear[y] = append(byYear[y], r)
	}
	years := make([]int, 0, len(byYear))
	for y := range byYear {
		years = append(years, y)
	}
	sort.Ints(years)
	periods := map[int]uuid.UUID{}
	for _, y := range years {
		g := y - 543
		starts := time.Date(g, 1, 1, 0, 0, 0, 0, Bangkok)
		ends := time.Date(g, 12, 31, 0, 0, 0, 0, Bangkok)
		status := "closed"
		if y == 2566 { // last legacy year had criteria but no computed run
			status = "draft"
		}
		var pid uuid.UUID
		if err := q.QueryRow(ctx, `INSERT INTO dividend_periods (store_id, be_year, starts_on, ends_on, net_profit, status, legacy_year, note)
			VALUES ($1,$2,$3,$4,0,$5::dividend_period_status,$6,'imported from legacy criteriondividend')
			ON CONFLICT (store_id, be_year) DO UPDATE SET legacy_year=EXCLUDED.legacy_year RETURNING id`,
			im.storeID, y, starts.Format("2006-01-02"), ends.Format("2006-01-02"), status, strconv.Itoa(y)).Scan(&pid); err != nil {
			return fmt.Errorf("period %d: %w", y, err)
		}
		periods[y] = pid
		for i, r := range byYear[y] {
			sr.RowsIn++
			kind, pool := "allocation", "OTHER"
			var bps, maxShares any
			percent := r.Dec("criteriondividend_percent")
			if r.Str("criteriondividend_type") == "1" {
				kind, pool = "share_rule", "OTHER"
				bps = percent
				percent = decimal.Zero
				if mh := r.Dec("criteriondividend_maxhun"); mh.IsPositive() {
					maxShares = mh
				}
			} else {
				switch r.Str("criteriondividend_typepercent") {
				case "HUN":
					pool = "HUN"
				case "AVG":
					pool = "AVG"
				}
			}
			if _, err := q.Exec(ctx, `INSERT INTO dividend_criteria (store_id, period_id, kind, name, percent, baht_per_share, max_shares, apply_cap, pool_code, is_locked, sort_order, legacy_id)
				VALUES ($1,$2,$3::dividend_criterion_kind,$4,$5,$6,$7,false,$8::dividend_pool,$9,$10,$11)
				ON CONFLICT (store_id, legacy_id) WHERE legacy_id IS NOT NULL DO UPDATE SET name=EXCLUDED.name, percent=EXCLUDED.percent, baht_per_share=EXCLUDED.baht_per_share, max_shares=EXCLUDED.max_shares`,
				im.storeID, pid, kind, r.Str("criteriondividend_name"), percent, bps, maxShares, pool, r.Str("criteriondividend_fixnoedit") == "NOTDEL", i, r.Str("criteriondividend_id")); err != nil {
				return fmt.Errorf("criterion %s: %w", r.Str("criteriondividend_id"), err)
			}
			sr.RowsOut++
		}
	}

	// statements from temps2 (one year)
	stmts, err := ReadAll(im.m.Path("temps2"))
	if err != nil {
		return err
	}
	if len(stmts) == 0 {
		return nil
	}
	year, _ := strconv.Atoi(stmts[0].Str("tempstr2"))
	pid, ok := periods[year]
	if !ok {
		im.warn("dividends", fmt.Sprintf("temps2 year %d has no criteria; statements skipped", year))
		return nil
	}
	var existingRun uuid.UUID
	if err := q.QueryRow(ctx, `SELECT id FROM dividend_runs WHERE period_id=$1 AND source='legacy_import' LIMIT 1`, pid).Scan(&existingRun); err == nil {
		sr.Skipped += len(stmts)
		sr.Extra["statements_already_imported"] = len(stmts)
		return nil
	}
	totShares, totPurch, totShareDiv, totRebate := decimal.Zero, decimal.Zero, decimal.Zero, decimal.Zero
	for _, s := range stmts {
		totShares = totShares.Add(s.Dec("tempint1"))
		totPurch = totPurch.Add(s.Dec("tempint2"))
		totShareDiv = totShareDiv.Add(s.Dec("tempint3"))
		totRebate = totRebate.Add(s.Dec("tempint4"))
	}
	rate, rebate := decimal.Zero, decimal.Zero
	if totShares.IsPositive() {
		rate = totShareDiv.DivRound(totShares, 10)
	}
	if totPurch.IsPositive() {
		rebate = totRebate.DivRound(totPurch, 10)
	}
	// allocation summary from temps (name, percent, amount)
	allocs := []map[string]any{}
	if temps, err := ReadAll(im.m.Path("temps")); err == nil {
		for _, t := range temps {
			allocs = append(allocs, map[string]any{"name": t.Str("temp2"), "percent": t.Dec("temp6"), "amount": t.Dec("temp7")})
		}
	}
	// net profit implied by the HUN pool (25 % → pool / 0.25)
	netProfit := decimal.Zero
	for _, r := range byYear[year] {
		if r.Str("criteriondividend_typepercent") == "HUN" && r.Dec("criteriondividend_percent").IsPositive() {
			netProfit = totShareDiv.Mul(decimal.NewFromInt(100)).DivRound(r.Dec("criteriondividend_percent"), 2)
		}
	}
	if netProfit.IsPositive() {
		_, _ = q.Exec(ctx, `UPDATE dividend_periods SET net_profit=$2 WHERE id=$1 AND net_profit=0`, pid, netProfit)
	}
	totals := map[string]any{"total_shares": totShares, "total_purchases": totPurch, "rate_per_share": rate, "rebate_rate": rebate,
		"sum_share_dividend": totShareDiv, "sum_rebate": totRebate, "sum_total": totShareDiv.Add(totRebate), "net_profit_implied": netProfit, "legacy_allocations": allocs}
	tb, _ := json.Marshal(totals)
	ib, _ := json.Marshal(map[string]any{"source": "temps2", "year": year})
	var runID uuid.UUID
	if err := q.QueryRow(ctx, `INSERT INTO dividend_runs (store_id, period_id, run_no, inputs, totals, member_count, is_final, source)
		VALUES ($1,$2,COALESCE((SELECT max(run_no)+1 FROM dividend_runs WHERE period_id=$2),1),$3,$4,$5,true,'legacy_import') RETURNING id`,
		im.storeID, pid, ib, tb, len(stmts)).Scan(&runID); err != nil {
		return fmt.Errorf("dividend run: %w", err)
	}
	for _, s := range stmts {
		sr.RowsIn++
		code := s.Str("tempstr3")
		var memberID *uuid.UUID
		if id, ok := im.members[code]; ok {
			memberID = &id
		}
		shares := s.Dec("tempint1")
		if _, err := q.Exec(ctx, `INSERT INTO dividend_member_statements (store_id, run_id, member_id, member_code, member_name, member_address, share_capital, shares, shares_effective, purchases, share_dividend, rebate, total, seq_no)
			VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),$7,$8,$8,$9,$10,$11,$12,$13) ON CONFLICT (run_id, member_code) DO NOTHING`,
			im.storeID, runID, memberID, code, orDefault(s.Str("tempstr4"), code), s.Str("tempstr5"), shares.Mul(decimal.NewFromInt(50)), shares, s.Dec("tempint2"), s.Dec("tempint3"), s.Dec("tempint4"), s.Dec("tempint5"), s.Int("tempstr1")); err != nil {
			return fmt.Errorf("statement %s: %w", code, err)
		}
		sr.RowsOut++
	}
	_, _ = q.Exec(ctx, `UPDATE dividend_periods SET status='paid' WHERE id=$1`, pid)
	sr.Extra["statement_year"] = year
	sr.Extra["rate_per_share"] = rate.String()
	sr.Extra["rebate_rate"] = rebate.String()
	return nil
}
