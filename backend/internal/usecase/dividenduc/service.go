package dividenduc

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

// Service runs the dividend period lifecycle: draft → simulated → approved → paid → closed.
type Service struct {
	db      *postgres.DB
	repo    postgres.DividendRepo
	members postgres.MemberRepo
	shares  postgres.ShareRepo
	audit   postgres.AuditRepo
	loc     *time.Location
}

func New(db *postgres.DB) *Service {
	loc, err := time.LoadLocation("Asia/Bangkok")
	if err != nil {
		loc = time.FixedZone("ICT", 7*3600)
	}
	return &Service{db: db, loc: loc}
}

type Actor struct {
	UserID uuid.UUID
	Name   string
	IP     string
}

func (a Actor) idPtr() *uuid.UUID {
	if a.UserID == uuid.Nil {
		return nil
	}
	id := a.UserID
	return &id
}

// MethodShareReinvest is the pseudo payment method that books the payout into the member's share capital.
const MethodShareReinvest = "share_reinvest"

func (s *Service) scope(storeID uuid.UUID) postgres.Scope { return postgres.Scope{StoreID: storeID} }

func (s *Service) writeAudit(ctx context.Context, storeID uuid.UUID, actor Actor, action, entity, id string, before, after any) error {
	return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: actor.idPtr(), ActorName: actor.Name, Action: action, Entity: entity, EntityID: id, Before: before, After: after, IP: actor.IP})
}

// DefaultCriteria seeds a new period: 50 ฿/share, HUN 25 %, AVG 25 %, reserves 30 %, board 10 %, public benefit 10 %.
func DefaultCriteria() []domain.DividendCriterion {
	bps := decimal.NewFromInt(50)
	pct := func(v int64) decimal.Decimal { return decimal.NewFromInt(v) }
	return []domain.DividendCriterion{
		{Kind: domain.CriterionShareRule, Name: "ราคาหุ้น", NameEN: "Baht per share", BahtPerShare: &bps, PoolCode: domain.PoolOther, SortOrder: 1},
		{Kind: domain.CriterionAllocation, Name: "ปันผลตามหุ้น", NameEN: "Share dividend", Percent: pct(25), PoolCode: domain.PoolHUN, SortOrder: 2},
		{Kind: domain.CriterionAllocation, Name: "เฉลี่ยคืน", NameEN: "Purchase rebate", Percent: pct(25), PoolCode: domain.PoolAVG, SortOrder: 3},
		{Kind: domain.CriterionAllocation, Name: "ทุนสำรอง", NameEN: "Reserve fund", Percent: pct(30), PoolCode: domain.PoolOther, SortOrder: 4},
		{Kind: domain.CriterionAllocation, Name: "ตอบแทนกรรมการ", NameEN: "Board compensation", Percent: pct(10), PoolCode: domain.PoolOther, SortOrder: 5},
		{Kind: domain.CriterionAllocation, Name: "สาธารณะประโยชน์", NameEN: "Public benefit", Percent: pct(10), PoolCode: domain.PoolOther, SortOrder: 6},
	}
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

// PeriodDetail is GET /periods/{id}: the period, its criteria and runs (newest first).
type PeriodDetail struct {
	domain.DividendPeriod
	Criteria  []domain.DividendCriterion `json:"criteria"`
	Runs      []domain.DividendRun       `json:"runs"`
	LatestRun *domain.DividendRun        `json:"latest_run,omitempty"`
}

type CreatePeriodInput struct {
	BEYear                   int              `json:"be_year"`
	StartsOn                 *domain.Date     `json:"starts_on,omitempty"`
	EndsOn                   *domain.Date     `json:"ends_on,omitempty"`
	NetProfit                decimal.Decimal  `json:"net_profit"`
	Note                     string           `json:"note,omitempty"`
	CopyCriteriaFromPeriodID *uuid.UUID       `json:"copy_criteria_from_period_id,omitempty"`
	Criteria                 []CriterionInput `json:"criteria,omitempty"` // optional explicit list (wins over copy/default)
}

type UpdatePeriodInput struct {
	NetProfit *decimal.Decimal `json:"net_profit,omitempty"`
	StartsOn  *domain.Date     `json:"starts_on,omitempty"`
	EndsOn    *domain.Date     `json:"ends_on,omitempty"`
	Note      *string          `json:"note,omitempty"`
}

// CriterionInput is one row of PUT /periods/{id}/criteria.
type CriterionInput struct {
	Kind         domain.DividendCriterionKind `json:"kind"`
	Name         string                       `json:"name"`
	NameEN       string                       `json:"name_en,omitempty"`
	Percent      decimal.Decimal              `json:"percent"`
	BahtPerShare *decimal.Decimal             `json:"baht_per_share,omitempty"`
	MaxShares    *decimal.Decimal             `json:"max_shares,omitempty"`
	ApplyCap     bool                         `json:"apply_cap"`
	PoolCode     domain.DividendPool          `json:"pool_code"`
	SortOrder    int                          `json:"sort_order"`
}

func (c CriterionInput) toDomain() domain.DividendCriterion {
	pool := c.PoolCode
	if pool == "" {
		pool = domain.PoolOther
	}
	return domain.DividendCriterion{Kind: c.Kind, Name: strings.TrimSpace(c.Name), NameEN: strings.TrimSpace(c.NameEN), Percent: c.Percent,
		BahtPerShare: c.BahtPerShare, MaxShares: c.MaxShares, ApplyCap: c.ApplyCap, PoolCode: pool, SortOrder: c.SortOrder}
}

func toCriteria(in []CriterionInput) ([]domain.DividendCriterion, error) {
	out := make([]domain.DividendCriterion, 0, len(in))
	for i, c := range in {
		d := c.toDomain()
		if d.Name == "" {
			return nil, domain.ErrValidation.With("field", fmt.Sprintf("criteria[%d].name", i))
		}
		out = append(out, d)
	}
	if _, err := ValidateCriteria(out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Service) ListPeriods(ctx context.Context, storeID uuid.UUID) ([]postgres.PeriodSummary, error) {
	var out []postgres.PeriodSummary
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.repo.ListPeriods(ctx, storeID)
		return err
	})
	return out, err
}

func (s *Service) CreatePeriod(ctx context.Context, storeID uuid.UUID, actor Actor, in CreatePeriodInput) (*PeriodDetail, error) {
	if in.BEYear < 2400 || in.BEYear > 2700 {
		return nil, domain.ErrValidation.With("field", "be_year")
	}
	if in.NetProfit.IsNegative() {
		return nil, domain.ErrValidation.With("field", "net_profit")
	}
	gy := in.BEYear - 543
	p := domain.DividendPeriod{StoreID: storeID, BEYear: in.BEYear, NetProfit: in.NetProfit.Round(2), Status: domain.DividendDraft, Note: strings.TrimSpace(in.Note),
		StartsOn: domain.NewDate(time.Date(gy, 1, 1, 0, 0, 0, 0, time.UTC)), EndsOn: domain.NewDate(time.Date(gy, 12, 31, 0, 0, 0, 0, time.UTC))}
	if in.StartsOn != nil && !in.StartsOn.IsZero() {
		p.StartsOn = *in.StartsOn
	}
	if in.EndsOn != nil && !in.EndsOn.IsZero() {
		p.EndsOn = *in.EndsOn
	}
	if p.EndsOn.Before(p.StartsOn.Time) {
		return nil, domain.ErrValidation.With("field", "ends_on")
	}
	var explicit []domain.DividendCriterion
	if len(in.Criteria) > 0 {
		var err error
		if explicit, err = toCriteria(in.Criteria); err != nil {
			return nil, err
		}
	}
	var out *PeriodDetail
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		if err := s.repo.InsertPeriod(ctx, &p); err != nil {
			return err
		}
		criteria := explicit
		switch {
		case criteria != nil:
		case in.CopyCriteriaFromPeriodID != nil:
			src, err := s.repo.ListCriteria(ctx, storeID, *in.CopyCriteriaFromPeriodID)
			if err != nil {
				return err
			}
			if len(src) == 0 {
				return domain.ErrDividendNotFound
			}
			for _, c := range src {
				c.ID, c.IsLocked, c.LegacyID = uuid.Nil, false, ""
				criteria = append(criteria, c)
			}
		default:
			criteria = DefaultCriteria()
		}
		cs, err := s.repo.ReplaceCriteria(ctx, storeID, p.ID, criteria)
		if err != nil {
			return err
		}
		out = &PeriodDetail{DividendPeriod: p, Criteria: cs, Runs: []domain.DividendRun{}}
		return s.writeAudit(ctx, storeID, actor, "dividend.period.create", "dividend_period", p.ID.String(), nil, out)
	})
	return out, err
}

func (s *Service) GetPeriod(ctx context.Context, storeID, id uuid.UUID) (*PeriodDetail, error) {
	var out *PeriodDetail
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.loadDetail(ctx, storeID, id)
		return err
	})
	return out, err
}

func (s *Service) loadDetail(ctx context.Context, storeID, id uuid.UUID) (*PeriodDetail, error) {
	p, err := s.repo.GetPeriod(ctx, storeID, id)
	if err != nil {
		return nil, err
	}
	d := &PeriodDetail{DividendPeriod: *p}
	if d.Criteria, err = s.repo.ListCriteria(ctx, storeID, id); err != nil {
		return nil, err
	}
	if d.Runs, err = s.repo.ListRuns(ctx, storeID, id); err != nil {
		return nil, err
	}
	for i := range d.Runs {
		if d.Runs[i].IsFinal {
			d.LatestRun = &d.Runs[i]
			break
		}
	}
	if d.LatestRun == nil && len(d.Runs) > 0 {
		d.LatestRun = &d.Runs[0]
	}
	return d, nil
}

func (s *Service) UpdatePeriod(ctx context.Context, storeID uuid.UUID, actor Actor, id uuid.UUID, in UpdatePeriodInput) (*PeriodDetail, error) {
	var out *PeriodDetail
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		p, err := s.repo.GetPeriodForUpdate(ctx, storeID, id)
		if err != nil {
			return err
		}
		if !p.Status.Editable() {
			return domain.ErrDividendLocked.With("status", string(p.Status))
		}
		before := *p
		if in.NetProfit != nil {
			if in.NetProfit.IsNegative() {
				return domain.ErrValidation.With("field", "net_profit")
			}
			p.NetProfit = in.NetProfit.Round(2)
		}
		if in.StartsOn != nil && !in.StartsOn.IsZero() {
			p.StartsOn = *in.StartsOn
		}
		if in.EndsOn != nil && !in.EndsOn.IsZero() {
			p.EndsOn = *in.EndsOn
		}
		if in.Note != nil {
			p.Note = strings.TrimSpace(*in.Note)
		}
		if p.EndsOn.Before(p.StartsOn.Time) {
			return domain.ErrValidation.With("field", "ends_on")
		}
		if err := s.repo.UpdatePeriod(ctx, p); err != nil {
			return err
		}
		if out, err = s.loadDetail(ctx, storeID, id); err != nil {
			return err
		}
		return s.writeAudit(ctx, storeID, actor, "dividend.period.update", "dividend_period", id.String(), before, out.DividendPeriod)
	})
	return out, err
}

// PutCriteria replaces the whole criteria list of an editable period.
func (s *Service) PutCriteria(ctx context.Context, storeID uuid.UUID, actor Actor, id uuid.UUID, in []CriterionInput) ([]domain.DividendCriterion, error) {
	cs, err := toCriteria(in)
	if err != nil {
		return nil, err
	}
	var out []domain.DividendCriterion
	err = s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		p, err := s.repo.GetPeriodForUpdate(ctx, storeID, id)
		if err != nil {
			return err
		}
		if !p.Status.Editable() {
			return domain.ErrDividendLocked.With("status", string(p.Status))
		}
		before, err := s.repo.ListCriteria(ctx, storeID, id)
		if err != nil {
			return err
		}
		if out, err = s.repo.ReplaceCriteria(ctx, storeID, id, cs); err != nil {
			return err
		}
		return s.writeAudit(ctx, storeID, actor, "dividend.criteria.replace", "dividend_period", id.String(), before, out)
	})
	return out, err
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

// periodRange converts the inclusive date range into [from, to) instants in the store timezone.
func (s *Service) periodRange(p *domain.DividendPeriod) (time.Time, time.Time) {
	a, b := p.StartsOn.Time, p.EndsOn.Time
	from := time.Date(a.Year(), a.Month(), a.Day(), 0, 0, 0, 0, s.loc)
	to := time.Date(b.Year(), b.Month(), b.Day(), 0, 0, 0, 0, s.loc).AddDate(0, 0, 1)
	return from, to
}

// Simulate computes a new run (run_no = max+1) from the current criteria, net profit, member share capital and
// period purchases, writes its statements and moves the period to "simulated".
func (s *Service) Simulate(ctx context.Context, storeID uuid.UUID, actor Actor, id uuid.UUID) (*domain.DividendRun, error) {
	var out *domain.DividendRun
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		p, err := s.repo.GetPeriodForUpdate(ctx, storeID, id)
		if err != nil {
			return err
		}
		if !p.Status.CanTransition(domain.DividendSimulated) {
			return domain.ErrDividendBadTransition.With("from", string(p.Status)).With("to", string(domain.DividendSimulated))
		}
		criteria, err := s.repo.ListCriteria(ctx, storeID, id)
		if err != nil {
			return err
		}
		if _, err := ValidateCriteria(criteria); err != nil {
			return err
		}
		from, to := s.periodRange(p)
		members, err := s.repo.MembersSnapshot(ctx, storeID, from, to)
		if err != nil {
			return err
		}
		res, err := Compute(Inputs{NetProfit: p.NetProfit, Criteria: criteria, Members: members})
		if err != nil {
			return err
		}
		run := &domain.DividendRun{StoreID: storeID, PeriodID: id, ComputedBy: actor.idPtr(), Source: "engine", MemberCount: res.Totals.MemberCount, Totals: res.Totals,
			Inputs: domain.DividendRunInputs{NetProfit: p.NetProfit, StartsOn: p.StartsOn, EndsOn: p.EndsOn, Criteria: criteria, Members: members}}
		if err := s.repo.InsertRun(ctx, run); err != nil {
			return err
		}
		if err := s.repo.InsertStatements(ctx, storeID, run.ID, res.Statements); err != nil {
			return err
		}
		if p.Status != domain.DividendSimulated {
			if err := s.repo.SetStatus(ctx, storeID, id, domain.DividendSimulated, nil, nil); err != nil {
				return err
			}
		}
		out = run
		return s.writeAudit(ctx, storeID, actor, "dividend.simulate", "dividend_period", id.String(),
			map[string]any{"status": p.Status}, map[string]any{"status": domain.DividendSimulated, "run_id": run.ID, "run_no": run.RunNo, "totals": run.Totals})
	})
	return out, err
}

func (s *Service) GetRun(ctx context.Context, storeID, runID uuid.UUID) (*domain.DividendRun, error) {
	var out *domain.DividendRun
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.repo.GetRun(ctx, storeID, runID)
		return err
	})
	return out, err
}

func (s *Service) Statements(ctx context.Context, storeID, runID uuid.UUID, q string, limit, offset int) ([]domain.DividendStatement, int64, error) {
	var out []domain.DividendStatement
	var total int64
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		if _, err := s.repo.GetRun(ctx, storeID, runID); err != nil {
			return err
		}
		var err error
		out, total, err = s.repo.ListStatements(ctx, storeID, runID, strings.TrimSpace(q), limit, offset)
		return err
	})
	return out, total, err
}

// ExportCSV renders every statement of a run as a UTF-8 (BOM) CSV; returns the bytes and a file name.
func (s *Service) ExportCSV(ctx context.Context, storeID, runID uuid.UUID) ([]byte, string, error) {
	var buf bytes.Buffer
	var name string
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		run, err := s.repo.GetRun(ctx, storeID, runID)
		if err != nil {
			return err
		}
		p, err := s.repo.GetPeriod(ctx, storeID, run.PeriodID)
		if err != nil {
			return err
		}
		stmts, err := s.repo.AllStatements(ctx, storeID, runID)
		if err != nil {
			return err
		}
		name = fmt.Sprintf("dividend_%d_run%d.csv", p.BEYear, run.RunNo)
		buf.Write([]byte{0xEF, 0xBB, 0xBF}) // UTF-8 BOM so Excel opens Thai text correctly
		w := csv.NewWriter(&buf)
		_ = w.Write([]string{"seq", "member_code", "name", "address", "share_capital", "shares", "purchases", "share_dividend", "rebate", "total"})
		for _, st := range stmts {
			_ = w.Write([]string{fmt.Sprint(st.SeqNo), st.MemberCode, st.MemberName, st.MemberAddress, st.ShareCapital.StringFixed(2), st.Shares.StringFixed(4),
				st.Purchases.StringFixed(2), st.ShareDividend.StringFixed(2), st.Rebate.StringFixed(2), st.Total.StringFixed(2)})
		}
		w.Flush()
		return w.Error()
	})
	return buf.Bytes(), name, err
}

// VerifyRun recomputes a stored run (engine or legacy_import) from its inputs and reports the differences.
func (s *Service) VerifyRun(ctx context.Context, storeID, runID uuid.UUID) (*VerifyReport, error) {
	var out *VerifyReport
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		run, err := s.repo.GetRun(ctx, storeID, runID)
		if err != nil {
			return err
		}
		in := InputsFromRun(run.Inputs)
		if len(in.Criteria) == 0 {
			if in.Criteria, err = s.repo.ListCriteria(ctx, storeID, run.PeriodID); err != nil {
				return err
			}
		}
		if in.NetProfit.IsZero() {
			p, err := s.repo.GetPeriod(ctx, storeID, run.PeriodID)
			if err != nil {
				return err
			}
			in.NetProfit = p.NetProfit
		}
		stmts, err := s.repo.AllStatements(ctx, storeID, runID)
		if err != nil {
			return err
		}
		out, err = Verify(in, stmts)
		return err
	})
	return out, err
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

func (s *Service) transition(ctx context.Context, storeID uuid.UUID, actor Actor, id uuid.UUID, to domain.DividendStatus, action string,
	extra func(ctx context.Context, p *domain.DividendPeriod) (map[string]any, error)) (*PeriodDetail, error) {
	var out *PeriodDetail
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		p, err := s.repo.GetPeriodForUpdate(ctx, storeID, id)
		if err != nil {
			return err
		}
		if !p.Status.CanTransition(to) {
			return domain.ErrDividendBadTransition.With("from", string(p.Status)).With("to", string(to))
		}
		after := map[string]any{"status": to}
		if extra != nil {
			ex, err := extra(ctx, p)
			if err != nil {
				return err
			}
			for k, v := range ex {
				after[k] = v
			}
		}
		var by *uuid.UUID
		var at *time.Time
		if to == domain.DividendApproved {
			by = actor.idPtr()
			now := time.Now()
			at = &now
		}
		if err := s.repo.SetStatus(ctx, storeID, id, to, by, at); err != nil {
			return err
		}
		if out, err = s.loadDetail(ctx, storeID, id); err != nil {
			return err
		}
		return s.writeAudit(ctx, storeID, actor, action, "dividend_period", id.String(), map[string]any{"status": p.Status}, after)
	})
	return out, err
}

// Approve marks the latest run final, locks the criteria and records the approver.
func (s *Service) Approve(ctx context.Context, storeID uuid.UUID, actor Actor, id uuid.UUID) (*PeriodDetail, error) {
	return s.transition(ctx, storeID, actor, id, domain.DividendApproved, "dividend.approve", func(ctx context.Context, p *domain.DividendPeriod) (map[string]any, error) {
		run, err := s.repo.LatestRun(ctx, storeID, id)
		if err != nil {
			return nil, err
		}
		if run == nil {
			return nil, domain.ErrDividendNoRun
		}
		if err := s.repo.MarkFinal(ctx, storeID, id, run.ID); err != nil {
			return nil, err
		}
		if err := s.repo.LockCriteria(ctx, storeID, id); err != nil {
			return nil, err
		}
		return map[string]any{"run_id": run.ID, "run_no": run.RunNo, "totals": run.Totals}, nil
	})
}

// MarkPaid moves approved → paid without requiring every statement to be paid out.
func (s *Service) MarkPaid(ctx context.Context, storeID uuid.UUID, actor Actor, id uuid.UUID) (*PeriodDetail, error) {
	return s.transition(ctx, storeID, actor, id, domain.DividendPaid, "dividend.mark_paid", nil)
}

// Close moves paid → closed.
func (s *Service) Close(ctx context.Context, storeID uuid.UUID, actor Actor, id uuid.UUID) (*PeriodDetail, error) {
	return s.transition(ctx, storeID, actor, id, domain.DividendClosed, "dividend.close", nil)
}

// ---------------------------------------------------------------------------
// Statements & payouts
// ---------------------------------------------------------------------------

// StatementDetail is GET /statements/{id}: the statement, its payouts and the period context.
type StatementDetail struct {
	domain.DividendStatement
	Payouts   []domain.DividendPayout `json:"payouts"`
	Remaining decimal.Decimal         `json:"remaining"`
	PeriodID  uuid.UUID               `json:"period_id"`
	BEYear    int                     `json:"be_year"`
	Status    domain.DividendStatus   `json:"status"`
	RunNo     int                     `json:"run_no"`
	IsFinal   bool                    `json:"is_final"`
}

type PayoutInput struct {
	Amount decimal.Decimal `json:"amount"`
	Method string          `json:"method"` // cash | transfer | qr | card | other | share_reinvest
	Note   string          `json:"note,omitempty"`
	PaidAt *time.Time      `json:"paid_at,omitempty"`
}

func (s *Service) loadStatement(ctx context.Context, storeID, id uuid.UUID, lock bool) (*StatementDetail, *domain.DividendRun, *domain.DividendPeriod, error) {
	var st *domain.DividendStatement
	var err error
	if lock {
		st, err = s.repo.GetStatementForUpdate(ctx, storeID, id)
	} else {
		st, err = s.repo.GetStatement(ctx, storeID, id)
	}
	if err != nil {
		return nil, nil, nil, err
	}
	run, err := s.repo.GetRun(ctx, storeID, st.RunID)
	if err != nil {
		return nil, nil, nil, err
	}
	p, err := s.repo.GetPeriod(ctx, storeID, run.PeriodID)
	if err != nil {
		return nil, nil, nil, err
	}
	payouts, err := s.repo.ListPayouts(ctx, storeID, id)
	if err != nil {
		return nil, nil, nil, err
	}
	d := &StatementDetail{DividendStatement: *st, Payouts: payouts, Remaining: st.Total.Sub(st.PaidTotal), PeriodID: p.ID, BEYear: p.BEYear, Status: p.Status, RunNo: run.RunNo, IsFinal: run.IsFinal}
	return d, run, p, nil
}

func (s *Service) GetStatement(ctx context.Context, storeID, id uuid.UUID) (*StatementDetail, error) {
	var out *StatementDetail
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, _, _, err = s.loadStatement(ctx, storeID, id, false)
		return err
	})
	return out, err
}

// AddPayout records a payout against a statement of the final run of an approved/paid period.
// method "share_reinvest" is stored as payment_method 'other' and additionally books a dividend_reinvest
// share transaction that raises the member's share capital. When every payable statement is covered,
// an approved period moves to "paid" automatically.
func (s *Service) AddPayout(ctx context.Context, storeID uuid.UUID, actor Actor, id uuid.UUID, in PayoutInput) (*StatementDetail, error) {
	if !in.Amount.IsPositive() {
		return nil, domain.ErrValidation.With("field", "amount")
	}
	in.Amount = in.Amount.Round(2)
	method := strings.ToLower(strings.TrimSpace(in.Method))
	reinvest := method == MethodShareReinvest
	pm := domain.PaymentMethod(method)
	if method == "" {
		pm = domain.PayCash
	}
	if reinvest {
		pm = domain.PayOther
	}
	if !pm.Valid() || pm == domain.PayCredit {
		return nil, domain.ErrValidation.With("field", "method")
	}
	var out *StatementDetail
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		d, run, p, err := s.loadStatement(ctx, storeID, id, true)
		if err != nil {
			return err
		}
		if p.Status != domain.DividendApproved && p.Status != domain.DividendPaid {
			return domain.ErrDividendNotApproved.With("status", string(p.Status))
		}
		if !run.IsFinal {
			return domain.ErrDividendNotApproved.With("status", "run not final")
		}
		if d.IsWalkin || d.MemberID == nil {
			return domain.ErrValidation.With("field", "statement").With("reason", "walk-in statement has no payee")
		}
		if in.Amount.GreaterThan(d.Remaining) {
			return domain.ErrDividendPayoutExceeds.With("remaining", d.Remaining.StringFixed(2))
		}
		note := strings.TrimSpace(in.Note)
		if reinvest {
			note = strings.TrimSpace(MethodShareReinvest + " " + note)
		}
		pay := &domain.DividendPayout{StoreID: storeID, StatementID: id, Amount: in.Amount, Method: pm, PaidBy: actor.idPtr(), Note: note}
		if in.PaidAt != nil {
			pay.PaidAt = *in.PaidAt
		}
		if err := s.repo.InsertPayout(ctx, pay); err != nil {
			return err
		}
		after := map[string]any{"payout": pay}
		if reinvest {
			m, err := s.members.GetForUpdate(ctx, storeID, *d.MemberID)
			if err != nil {
				return err
			}
			balance := m.ShareCapital.Add(in.Amount)
			sid := id
			tx := &domain.ShareTx{StoreID: storeID, MemberID: m.ID, Type: domain.ShareDividendReinvest, Amount: in.Amount, BalanceAfter: balance,
				Note: fmt.Sprintf("ปันผลปี %d", p.BEYear), RefType: "dividend_statement", RefID: &sid, CreatedBy: actor.idPtr(), OccurredAt: pay.PaidAt}
			if err := s.shares.Insert(ctx, tx); err != nil {
				return err
			}
			if err := s.members.SetShareCapital(ctx, storeID, m.ID, balance); err != nil {
				return err
			}
			after["share_tx"] = tx
		}
		if err := s.writeAudit(ctx, storeID, actor, "dividend.payout", "dividend_statement", id.String(), map[string]any{"paid_total": d.PaidTotal}, after); err != nil {
			return err
		}
		if p.Status == domain.DividendApproved {
			n, err := s.repo.UnpaidCount(ctx, storeID, run.ID)
			if err != nil {
				return err
			}
			if n == 0 {
				if err := s.repo.SetStatus(ctx, storeID, p.ID, domain.DividendPaid, nil, nil); err != nil {
					return err
				}
				if err := s.writeAudit(ctx, storeID, actor, "dividend.mark_paid", "dividend_period", p.ID.String(), map[string]any{"status": p.Status}, map[string]any{"status": domain.DividendPaid, "auto": true}); err != nil {
					return err
				}
			}
		}
		out, _, _, err = s.loadStatement(ctx, storeID, id, false)
		return err
	})
	return out, err
}

func (s *Service) MemberHistory(ctx context.Context, storeID, memberID uuid.UUID) ([]postgres.MemberStatementRow, error) {
	var out []postgres.MemberStatementRow
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		if _, err := s.members.Get(ctx, storeID, memberID); err != nil {
			return err
		}
		var err error
		out, err = s.repo.MemberHistory(ctx, storeID, memberID)
		return err
	})
	return out, err
}
