package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/svdev/pos/internal/domain"
)

// DividendRepo persists periods, criteria, runs, statements and payouts (0006_dividends).
type DividendRepo struct{}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

const periodCols = `p.id, p.store_id, p.be_year, p.starts_on, p.ends_on, p.net_profit::text, p.status::text, p.approved_by, p.approved_at,
	COALESCE(p.note,''), COALESCE(p.legacy_year,''), p.created_at, p.updated_at`

func scanPeriod(row pgx.Row) (*domain.DividendPeriod, error) {
	var p domain.DividendPeriod
	var np, st string
	var starts, ends time.Time
	if err := row.Scan(&p.ID, &p.StoreID, &p.BEYear, &starts, &ends, &np, &st, &p.ApprovedBy, &p.ApprovedAt, &p.Note, &p.LegacyYear, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return nil, err
	}
	p.NetProfit, p.Status = dec(np), domain.DividendStatus(st)
	p.StartsOn, p.EndsOn = domain.NewDate(starts), domain.NewDate(ends)
	return &p, nil
}

// PeriodSummary is a period plus the totals of its latest run (list view).
type PeriodSummary struct {
	domain.DividendPeriod
	LatestRunID   *uuid.UUID             `json:"latest_run_id,omitempty"`
	LatestRunNo   int                    `json:"latest_run_no"`
	LatestIsFinal bool                   `json:"latest_is_final"`
	LatestSource  string                 `json:"latest_source,omitempty"`
	MemberCount   int                    `json:"member_count"`
	Totals        *domain.DividendTotals `json:"totals,omitempty"`
}

func (DividendRepo) ListPeriods(ctx context.Context, storeID uuid.UUID) ([]PeriodSummary, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT `+periodCols+`, r.id, COALESCE(r.run_no,0), COALESCE(r.is_final,false), COALESCE(r.source,''), COALESCE(r.member_count,0), r.totals
		FROM dividend_periods p
		LEFT JOIN LATERAL (SELECT id, run_no, is_final, source, member_count, totals FROM dividend_runs x WHERE x.period_id=p.id ORDER BY x.is_final DESC, x.run_no DESC LIMIT 1) r ON true
		WHERE p.store_id=$1 ORDER BY p.be_year DESC`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PeriodSummary{}
	for rows.Next() {
		var s PeriodSummary
		var np, st string
		var starts, ends time.Time
		var totals []byte
		if err := rows.Scan(&s.ID, &s.StoreID, &s.BEYear, &starts, &ends, &np, &st, &s.ApprovedBy, &s.ApprovedAt, &s.Note, &s.LegacyYear, &s.CreatedAt, &s.UpdatedAt,
			&s.LatestRunID, &s.LatestRunNo, &s.LatestIsFinal, &s.LatestSource, &s.MemberCount, &totals); err != nil {
			return nil, err
		}
		s.NetProfit, s.Status = dec(np), domain.DividendStatus(st)
		s.StartsOn, s.EndsOn = domain.NewDate(starts), domain.NewDate(ends)
		if len(totals) > 0 && s.LatestRunID != nil {
			var t domain.DividendTotals
			if json.Unmarshal(totals, &t) == nil {
				s.Totals = &t
			}
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (DividendRepo) GetPeriod(ctx context.Context, storeID, id uuid.UUID) (*domain.DividendPeriod, error) {
	p, err := scanPeriod(Q(ctx).QueryRow(ctx, `SELECT `+periodCols+` FROM dividend_periods p WHERE p.store_id=$1 AND p.id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrDividendNotFound
	}
	return p, err
}

// GetPeriodForUpdate locks the period row for a state transition.
func (DividendRepo) GetPeriodForUpdate(ctx context.Context, storeID, id uuid.UUID) (*domain.DividendPeriod, error) {
	p, err := scanPeriod(Q(ctx).QueryRow(ctx, `SELECT `+periodCols+` FROM dividend_periods p WHERE p.store_id=$1 AND p.id=$2 FOR UPDATE`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrDividendNotFound
	}
	return p, err
}

func (DividendRepo) InsertPeriod(ctx context.Context, p *domain.DividendPeriod) error {
	err := Q(ctx).QueryRow(ctx, `INSERT INTO dividend_periods (store_id, be_year, starts_on, ends_on, net_profit, status, note, legacy_year)
		VALUES ($1,$2,$3,$4,$5,$6::dividend_period_status,NULLIF($7,''),NULLIF($8,'')) RETURNING id, created_at, updated_at`,
		p.StoreID, p.BEYear, p.StartsOn.Time, p.EndsOn.Time, p.NetProfit.StringFixed(2), string(p.Status), p.Note, p.LegacyYear).Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt)
	if isUniqueViolation(err) {
		return domain.ErrDividendPeriodExists.With("year", p.BEYear)
	}
	return err
}

// UpdatePeriod writes the editable fields (net_profit, dates, note).
func (DividendRepo) UpdatePeriod(ctx context.Context, p *domain.DividendPeriod) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE dividend_periods SET net_profit=$3, starts_on=$4, ends_on=$5, note=NULLIF($6,'') WHERE store_id=$1 AND id=$2`,
		p.StoreID, p.ID, p.NetProfit.StringFixed(2), p.StartsOn.Time, p.EndsOn.Time, p.Note)
	return err
}

// SetStatus moves a period to a new status; approvedBy/approvedAt are written when non-nil.
func (DividendRepo) SetStatus(ctx context.Context, storeID, id uuid.UUID, st domain.DividendStatus, approvedBy *uuid.UUID, approvedAt *time.Time) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE dividend_periods SET status=$3::dividend_period_status,
		approved_by=COALESCE($4, approved_by), approved_at=COALESCE($5, approved_at) WHERE store_id=$1 AND id=$2`, storeID, id, string(st), approvedBy, approvedAt)
	return err
}

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

const criterionCols = `id, store_id, period_id, kind::text, name, COALESCE(name_en,''), percent::text, baht_per_share::text, max_shares::text, apply_cap, pool_code::text, is_locked, sort_order, COALESCE(legacy_id,''), created_at`

func scanCriterion(row pgx.Row) (*domain.DividendCriterion, error) {
	var c domain.DividendCriterion
	var kind, pct, pool string
	var bps, maxSh *string
	if err := row.Scan(&c.ID, &c.StoreID, &c.PeriodID, &kind, &c.Name, &c.NameEN, &pct, &bps, &maxSh, &c.ApplyCap, &pool, &c.IsLocked, &c.SortOrder, &c.LegacyID, &c.CreatedAt); err != nil {
		return nil, err
	}
	c.Kind, c.PoolCode, c.Percent = domain.DividendCriterionKind(kind), domain.DividendPool(pool), dec(pct)
	c.BahtPerShare, c.MaxShares = decPtr(bps), decPtr(maxSh)
	return &c, nil
}

func (DividendRepo) ListCriteria(ctx context.Context, storeID, periodID uuid.UUID) ([]domain.DividendCriterion, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT `+criterionCols+` FROM dividend_criteria WHERE store_id=$1 AND period_id=$2 ORDER BY kind DESC, sort_order, created_at`, storeID, periodID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.DividendCriterion{}
	for rows.Next() {
		c, err := scanCriterion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// ReplaceCriteria deletes the period's criteria and inserts the given list (ids are regenerated).
func (DividendRepo) ReplaceCriteria(ctx context.Context, storeID, periodID uuid.UUID, cs []domain.DividendCriterion) ([]domain.DividendCriterion, error) {
	if _, err := Q(ctx).Exec(ctx, `DELETE FROM dividend_criteria WHERE store_id=$1 AND period_id=$2`, storeID, periodID); err != nil {
		return nil, err
	}
	out := make([]domain.DividendCriterion, 0, len(cs))
	for i, c := range cs {
		c.StoreID, c.PeriodID = storeID, periodID
		if c.SortOrder == 0 {
			c.SortOrder = i + 1
		}
		err := Q(ctx).QueryRow(ctx, `INSERT INTO dividend_criteria (store_id, period_id, kind, name, name_en, percent, baht_per_share, max_shares, apply_cap, pool_code, is_locked, sort_order, legacy_id)
			VALUES ($1,$2,$3::dividend_criterion_kind,$4,NULLIF($5,''),$6,$7,$8,$9,$10::dividend_pool,$11,$12,NULLIF($13,'')) RETURNING id, created_at`,
			storeID, periodID, string(c.Kind), c.Name, c.NameEN, c.Percent.StringFixed(4), nullDec(c.BahtPerShare), nullDec(c.MaxShares), c.ApplyCap, string(c.PoolCode), c.IsLocked, c.SortOrder, c.LegacyID).
			Scan(&c.ID, &c.CreatedAt)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

// LockCriteria sets is_locked on every criterion of the period (approval).
func (DividendRepo) LockCriteria(ctx context.Context, storeID, periodID uuid.UUID) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE dividend_criteria SET is_locked=true WHERE store_id=$1 AND period_id=$2`, storeID, periodID)
	return err
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

const runCols = `r.id, r.store_id, r.period_id, r.run_no, r.inputs, r.totals, r.member_count, r.is_final, r.computed_by, r.computed_at, r.source`

func scanRun(row pgx.Row) (*domain.DividendRun, error) {
	var r domain.DividendRun
	var inputs, totals []byte
	if err := row.Scan(&r.ID, &r.StoreID, &r.PeriodID, &r.RunNo, &inputs, &totals, &r.MemberCount, &r.IsFinal, &r.ComputedBy, &r.ComputedAt, &r.Source); err != nil {
		return nil, err
	}
	if len(inputs) > 0 {
		_ = json.Unmarshal(inputs, &r.Inputs)
	}
	if len(totals) > 0 {
		_ = json.Unmarshal(totals, &r.Totals)
	}
	return &r, nil
}

func (DividendRepo) ListRuns(ctx context.Context, storeID, periodID uuid.UUID) ([]domain.DividendRun, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT `+runCols+` FROM dividend_runs r WHERE r.store_id=$1 AND r.period_id=$2 ORDER BY r.run_no DESC`, storeID, periodID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.DividendRun{}
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		r.Inputs.Members = nil // list view: keep the payload small
		out = append(out, *r)
	}
	return out, rows.Err()
}

func (DividendRepo) GetRun(ctx context.Context, storeID, id uuid.UUID) (*domain.DividendRun, error) {
	r, err := scanRun(Q(ctx).QueryRow(ctx, `SELECT `+runCols+` FROM dividend_runs r WHERE r.store_id=$1 AND r.id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrDividendNotFound
	}
	return r, err
}

// LatestRun returns the newest run of a period (final first), or nil when none exists.
func (DividendRepo) LatestRun(ctx context.Context, storeID, periodID uuid.UUID) (*domain.DividendRun, error) {
	r, err := scanRun(Q(ctx).QueryRow(ctx, `SELECT `+runCols+` FROM dividend_runs r WHERE r.store_id=$1 AND r.period_id=$2 ORDER BY r.is_final DESC, r.run_no DESC LIMIT 1`, storeID, periodID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return r, err
}

// InsertRun writes a run with run_no = max+1 for the period.
func (DividendRepo) InsertRun(ctx context.Context, r *domain.DividendRun) error {
	inputs, err := json.Marshal(r.Inputs)
	if err != nil {
		return err
	}
	totals, err := json.Marshal(r.Totals)
	if err != nil {
		return err
	}
	if r.Source == "" {
		r.Source = "engine"
	}
	return Q(ctx).QueryRow(ctx, `INSERT INTO dividend_runs (store_id, period_id, run_no, inputs, totals, member_count, is_final, computed_by, source)
		VALUES ($1,$2,(SELECT COALESCE(max(run_no),0)+1 FROM dividend_runs WHERE period_id=$2),$3,$4,$5,$6,$7,$8) RETURNING id, run_no, computed_at`,
		r.StoreID, r.PeriodID, inputs, totals, r.MemberCount, r.IsFinal, r.ComputedBy, r.Source).Scan(&r.ID, &r.RunNo, &r.ComputedAt)
}

// MarkFinal flags exactly one run of the period as final.
func (DividendRepo) MarkFinal(ctx context.Context, storeID, periodID, runID uuid.UUID) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE dividend_runs SET is_final = (id=$3) WHERE store_id=$1 AND period_id=$2`, storeID, periodID, runID)
	return err
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

const stmtCols = `s.id, s.store_id, s.run_id, s.member_id, s.member_code, s.member_name, COALESCE(s.member_address,''), s.share_capital::text, s.shares::text, s.shares_effective::text,
	s.purchases::text, s.share_dividend::text, s.rebate::text, s.total::text, COALESCE(s.seq_no,0), (COALESCE(m.is_walkin,false) OR s.member_code='0'),
	COALESCE((SELECT sum(amount) FROM dividend_payouts x WHERE x.statement_id=s.id),0)::text`

const stmtFrom = ` FROM dividend_member_statements s LEFT JOIN members m ON m.id=s.member_id `

func scanStatement(row pgx.Row) (*domain.DividendStatement, error) {
	var s domain.DividendStatement
	var cap, sh, eff, pu, sd, rb, tt, paid string
	if err := row.Scan(&s.ID, &s.StoreID, &s.RunID, &s.MemberID, &s.MemberCode, &s.MemberName, &s.MemberAddress, &cap, &sh, &eff, &pu, &sd, &rb, &tt, &s.SeqNo, &s.IsWalkin, &paid); err != nil {
		return nil, err
	}
	s.ShareCapital, s.Shares, s.SharesEffective, s.Purchases = dec(cap), dec(sh), dec(eff), dec(pu)
	s.ShareDividend, s.Rebate, s.Total, s.PaidTotal = dec(sd), dec(rb), dec(tt), dec(paid)
	return &s, nil
}

// InsertStatements bulk-inserts the statements of a run in one batch.
func (DividendRepo) InsertStatements(ctx context.Context, storeID, runID uuid.UUID, stmts []domain.DividendStatement) error {
	if len(stmts) == 0 {
		return nil
	}
	b := &pgx.Batch{}
	for _, s := range stmts {
		b.Queue(`INSERT INTO dividend_member_statements (store_id, run_id, member_id, member_code, member_name, member_address, share_capital, shares, shares_effective, purchases, share_dividend, rebate, total, seq_no)
			VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),$7,$8,$9,$10,$11,$12,$13,$14)`,
			storeID, runID, s.MemberID, s.MemberCode, s.MemberName, s.MemberAddress, s.ShareCapital.StringFixed(2), s.Shares.StringFixed(4), s.SharesEffective.StringFixed(4),
			s.Purchases.StringFixed(2), s.ShareDividend.StringFixed(2), s.Rebate.StringFixed(2), s.Total.StringFixed(2), s.SeqNo)
	}
	res := Q(ctx).SendBatch(ctx, b)
	defer res.Close()
	for range stmts {
		if _, err := res.Exec(); err != nil {
			return fmt.Errorf("insert statement: %w", err)
		}
	}
	return nil
}

// ListStatements pages a run's statements, ordered by seq_no then member_code; q filters by code prefix or name.
func (DividendRepo) ListStatements(ctx context.Context, storeID, runID uuid.UUID, q string, limit, offset int) ([]domain.DividendStatement, int64, error) {
	where := ` WHERE s.store_id=$1 AND s.run_id=$2 AND ($3='' OR s.member_code ILIKE $3||'%' OR s.member_name ILIKE '%'||$3||'%')`
	var total int64
	if err := Q(ctx).QueryRow(ctx, `SELECT count(*)`+stmtFrom+where, storeID, runID, q).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := Q(ctx).Query(ctx, `SELECT `+stmtCols+stmtFrom+where+` ORDER BY COALESCE(s.seq_no, 2147483647), s.member_code LIMIT $4 OFFSET $5`, storeID, runID, q, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []domain.DividendStatement{}
	for rows.Next() {
		s, err := scanStatement(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *s)
	}
	return out, total, rows.Err()
}

// AllStatements returns every statement of a run in seq order (export / verify).
func (r DividendRepo) AllStatements(ctx context.Context, storeID, runID uuid.UUID) ([]domain.DividendStatement, error) {
	out, _, err := r.ListStatements(ctx, storeID, runID, "", 1_000_000, 0)
	return out, err
}

func (DividendRepo) GetStatement(ctx context.Context, storeID, id uuid.UUID) (*domain.DividendStatement, error) {
	s, err := scanStatement(Q(ctx).QueryRow(ctx, `SELECT `+stmtCols+stmtFrom+` WHERE s.store_id=$1 AND s.id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrDividendNotFound
	}
	return s, err
}

// GetStatementForUpdate locks a statement row while a payout is recorded.
func (DividendRepo) GetStatementForUpdate(ctx context.Context, storeID, id uuid.UUID) (*domain.DividendStatement, error) {
	s, err := scanStatement(Q(ctx).QueryRow(ctx, `SELECT `+stmtCols+stmtFrom+` WHERE s.store_id=$1 AND s.id=$2 FOR UPDATE OF s`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrDividendNotFound
	}
	return s, err
}

// UnpaidCount counts statements of a run whose payouts do not yet cover the total (walk-in rows and zero totals excluded).
func (DividendRepo) UnpaidCount(ctx context.Context, storeID, runID uuid.UUID) (int64, error) {
	var n int64
	err := Q(ctx).QueryRow(ctx, `SELECT count(*) FROM dividend_member_statements s LEFT JOIN members m ON m.id=s.member_id
		WHERE s.store_id=$1 AND s.run_id=$2 AND s.total>0 AND NOT (COALESCE(m.is_walkin,false) OR s.member_code='0')
		AND COALESCE((SELECT sum(amount) FROM dividend_payouts x WHERE x.statement_id=s.id),0) < s.total`, storeID, runID).Scan(&n)
	return n, err
}

// MemberStatementRow is a statement joined with its period (member history).
type MemberStatementRow struct {
	domain.DividendStatement
	PeriodID uuid.UUID             `json:"period_id"`
	BEYear   int                   `json:"be_year"`
	Status   domain.DividendStatus `json:"status"`
	RunNo    int                   `json:"run_no"`
	Source   string                `json:"source"`
}

// MemberHistory lists a member's statements from final runs, newest year first.
func (DividendRepo) MemberHistory(ctx context.Context, storeID, memberID uuid.UUID) ([]MemberStatementRow, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT `+stmtCols+`, p.id, p.be_year, p.status::text, r.run_no, r.source`+stmtFrom+`
		JOIN dividend_runs r ON r.id=s.run_id JOIN dividend_periods p ON p.id=r.period_id
		WHERE s.store_id=$1 AND s.member_id=$2 AND r.is_final ORDER BY p.be_year DESC, r.run_no DESC`, storeID, memberID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MemberStatementRow{}
	for rows.Next() {
		var h MemberStatementRow
		var cap, sh, eff, pu, sd, rb, tt, paid, st string
		if err := rows.Scan(&h.ID, &h.StoreID, &h.RunID, &h.MemberID, &h.MemberCode, &h.MemberName, &h.MemberAddress, &cap, &sh, &eff, &pu, &sd, &rb, &tt, &h.SeqNo, &h.IsWalkin, &paid,
			&h.PeriodID, &h.BEYear, &st, &h.RunNo, &h.Source); err != nil {
			return nil, err
		}
		h.ShareCapital, h.Shares, h.SharesEffective, h.Purchases = dec(cap), dec(sh), dec(eff), dec(pu)
		h.ShareDividend, h.Rebate, h.Total, h.PaidTotal, h.Status = dec(sd), dec(rb), dec(tt), dec(paid), domain.DividendStatus(st)
		out = append(out, h)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

const payoutCols = `id, store_id, statement_id, amount::text, method::text, paid_at, paid_by, COALESCE(note,'')`

func (DividendRepo) InsertPayout(ctx context.Context, p *domain.DividendPayout) error {
	paidAt := p.PaidAt
	if paidAt.IsZero() {
		paidAt = time.Now()
	}
	return Q(ctx).QueryRow(ctx, `INSERT INTO dividend_payouts (store_id, statement_id, amount, method, paid_at, paid_by, note)
		VALUES ($1,$2,$3,$4::payment_method,$5,$6,NULLIF($7,'')) RETURNING id, paid_at`,
		p.StoreID, p.StatementID, p.Amount.StringFixed(2), string(p.Method), paidAt, p.PaidBy, p.Note).Scan(&p.ID, &p.PaidAt)
}

func (DividendRepo) ListPayouts(ctx context.Context, storeID, statementID uuid.UUID) ([]domain.DividendPayout, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT `+payoutCols+` FROM dividend_payouts WHERE store_id=$1 AND statement_id=$2 ORDER BY paid_at, id`, storeID, statementID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.DividendPayout{}
	for rows.Next() {
		var p domain.DividendPayout
		var amt, m string
		if err := rows.Scan(&p.ID, &p.StoreID, &p.StatementID, &amt, &m, &p.PaidAt, &p.PaidBy, &p.Note); err != nil {
			return nil, err
		}
		p.Amount, p.Method = dec(amt), domain.PaymentMethod(m)
		out = append(out, p)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Engine inputs: member snapshot + purchases per member for the period
// ---------------------------------------------------------------------------

// MembersSnapshot returns every member of the store (all statuses, walk-in included) with purchases for
// [from, to) already attached: Σ sales.net WHERE status='completed'. Sales without a member are attributed
// to the store's walk-in member; when no walk-in member exists a synthetic code '0' row is appended.
func (DividendRepo) MembersSnapshot(ctx context.Context, storeID uuid.UUID, from, to time.Time) ([]domain.DividendMemberInput, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT m.id, m.member_code, m.name, COALESCE(m.address,''), m.share_capital::text, m.is_walkin,
		COALESCE((SELECT sum(s.net) FROM sales s WHERE s.store_id=m.store_id AND s.member_id=m.id AND s.status='completed' AND s.sold_at>=$2 AND s.sold_at<$3),0)::text
		FROM members m WHERE m.store_id=$1 ORDER BY m.member_code`, storeID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.DividendMemberInput{}
	walkinIdx := -1
	for rows.Next() {
		var m domain.DividendMemberInput
		var id uuid.UUID
		var cap, pu string
		if err := rows.Scan(&id, &m.Code, &m.Name, &m.Address, &cap, &m.IsWalkin, &pu); err != nil {
			return nil, err
		}
		m.MemberID = &id
		m.ShareCapital, m.Purchases = dec(cap), dec(pu)
		if m.IsWalkin && walkinIdx < 0 {
			walkinIdx = len(out)
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var anon string
	if err := Q(ctx).QueryRow(ctx, `SELECT COALESCE(sum(net),0)::text FROM sales WHERE store_id=$1 AND member_id IS NULL AND status='completed' AND sold_at>=$2 AND sold_at<$3`, storeID, from, to).Scan(&anon); err != nil {
		return nil, err
	}
	a := dec(anon)
	switch {
	case walkinIdx >= 0:
		out[walkinIdx].Purchases = out[walkinIdx].Purchases.Add(a)
	case !a.IsZero():
		out = append(out, domain.DividendMemberInput{Code: domain.WalkinMemberCode, Name: "ไม่ระบุ", Purchases: a, IsWalkin: true})
	}
	return out, nil
}
