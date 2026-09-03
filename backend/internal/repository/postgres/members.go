package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
)

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

const memberCols = `m.id, m.store_id, m.member_code, m.name, COALESCE(m.address,''), COALESCE(m.phone,''), COALESCE(m.email,''),
	COALESCE(m.national_id,''), COALESCE(m.line_user_id,''), COALESCE(m.line_display,''), m.share_capital::text, m.joined_at,
	m.price_tier, m.is_walkin, m.status::text, COALESCE(m.note,''), COALESCE(m.legacy_id,''), m.created_at, m.updated_at`

// memberFields returns the scan targets for memberCols; callers append extra targets for computed columns.
func memberFields(m *domain.Member, share *string, joined **time.Time, status *string) []any {
	return []any{&m.ID, &m.StoreID, &m.MemberCode, &m.Name, &m.Address, &m.Phone, &m.Email, &m.NationalID, &m.LineUserID, &m.LineDisplay,
		share, joined, &m.PriceTier, &m.IsWalkin, status, &m.Note, &m.LegacyID, &m.CreatedAt, &m.UpdatedAt}
}

func finishMember(m *domain.Member, share string, joined *time.Time, status string) {
	m.ShareCapital = dec(share)
	m.Status = domain.MemberStatus(status)
	if joined != nil {
		d := domain.NewDate(*joined)
		m.JoinedAt = &d
	}
}

func scanMember(row pgx.Row) (*domain.Member, error) {
	var m domain.Member
	var share, status string
	var joined *time.Time
	if err := row.Scan(memberFields(&m, &share, &joined, &status)...); err != nil {
		return nil, err
	}
	finishMember(&m, share, joined, status)
	return &m, nil
}

func scanMemberView(row pgx.Row) (*domain.MemberView, error) {
	var v domain.MemberView
	var share, status, ar, ytd string
	var joined *time.Time
	targets := append(memberFields(&v.Member, &share, &joined, &status), &ar, &ytd)
	if err := row.Scan(targets...); err != nil {
		return nil, err
	}
	finishMember(&v.Member, share, joined, status)
	v.ARBalance = dec(ar)
	v.YTDPurchases = dec(ytd)
	return &v, nil
}

// YearRange returns [from, to) for a calendar year in the store timezone (Asia/Bangkok).
func YearRange(year int) (time.Time, time.Time) {
	from := time.Date(year, 1, 1, 0, 0, 0, 0, bangkok)
	return from, from.AddDate(1, 0, 0)
}

// CurrentYear is the calendar year in the store timezone.
func CurrentYear() int { return time.Now().In(bangkok).Year() }

// likeEscape neutralises LIKE wildcards in user input.
func likeEscape(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(strings.TrimSpace(s))
}

type MemberFilter struct {
	Q         string
	Status    string
	HasShares *bool
	Limit     int
	Offset    int
}

type MemberRepo struct{}

const memberSearchWhere = `($2='' OR m.member_code ILIKE $2||'%' OR m.name ILIKE '%'||$2||'%' OR m.phone LIKE '%'||$2||'%')`

func (MemberRepo) List(ctx context.Context, storeID uuid.UUID, f MemberFilter) ([]domain.MemberView, int64, error) {
	q := likeEscape(f.Q)
	where := `m.store_id=$1 AND ` + memberSearchWhere + ` AND ($3='' OR m.status::text=$3)
		AND ($4::boolean IS NULL OR ($4 AND m.share_capital>0) OR (NOT $4 AND m.share_capital<=0))`
	var total int64
	if err := Q(ctx).QueryRow(ctx, `SELECT count(*) FROM members m WHERE `+where, storeID, q, f.Status, f.HasShares).Scan(&total); err != nil {
		return nil, 0, err
	}
	from, to := YearRange(CurrentYear())
	rows, err := Q(ctx).Query(ctx, `SELECT `+memberCols+`,
		COALESCE((SELECT sum(s.ar_balance) FROM sales s WHERE s.store_id=m.store_id AND s.member_id=m.id AND s.ar_status IN ('unpaid','partial')),0)::text,
		COALESCE((SELECT sum(s.net) FROM sales s WHERE s.store_id=m.store_id AND s.member_id=m.id AND s.status='completed' AND s.sold_at>=$5 AND s.sold_at<$6),0)::text
		FROM members m WHERE `+where+`
		ORDER BY m.is_walkin, length(m.member_code), m.member_code LIMIT $7 OFFSET $8`,
		storeID, q, f.Status, f.HasShares, from, to, f.Limit, f.Offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []domain.MemberView{}
	for rows.Next() {
		v, err := scanMemberView(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *v)
	}
	return out, total, rows.Err()
}

// Search is the fast POS lookup: code prefix / name substring / phone substring, active members only.
func (MemberRepo) Search(ctx context.Context, storeID uuid.UUID, q string, limit int) ([]domain.Member, error) {
	esc := likeEscape(q)
	rows, err := Q(ctx).Query(ctx, `SELECT `+memberCols+` FROM members m WHERE m.store_id=$1 AND m.status='active' AND `+memberSearchWhere+`
		ORDER BY (lower(m.member_code)=lower($3)) DESC, m.is_walkin, length(m.member_code), m.member_code LIMIT $4`, storeID, esc, strings.TrimSpace(q), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Member{}
	for rows.Next() {
		m, err := scanMember(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

func (MemberRepo) Get(ctx context.Context, storeID, id uuid.UUID) (*domain.Member, error) {
	m, err := scanMember(Q(ctx).QueryRow(ctx, `SELECT `+memberCols+` FROM members m WHERE m.store_id=$1 AND m.id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrMemberNotFound
	}
	return m, err
}

// GetForUpdate locks the member row (share ledger updates).
func (MemberRepo) GetForUpdate(ctx context.Context, storeID, id uuid.UUID) (*domain.Member, error) {
	m, err := scanMember(Q(ctx).QueryRow(ctx, `SELECT `+memberCols+` FROM members m WHERE m.store_id=$1 AND m.id=$2 FOR UPDATE`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrMemberNotFound
	}
	return m, err
}

func (MemberRepo) FindByLineUserID(ctx context.Context, storeID uuid.UUID, lineUserID string) (*domain.Member, error) {
	m, err := scanMember(Q(ctx).QueryRow(ctx, `SELECT `+memberCols+` FROM members m WHERE m.store_id=$1 AND m.line_user_id=$2`, storeID, lineUserID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrMemberNotFound
	}
	return m, err
}

// FindUnlinkedByPhone returns members with the exact phone that have no LINE account yet.
func (MemberRepo) FindUnlinkedByPhone(ctx context.Context, storeID uuid.UUID, phone string) ([]domain.Member, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT `+memberCols+` FROM members m WHERE m.store_id=$1 AND m.phone=$2 AND m.line_user_id IS NULL AND NOT m.is_walkin LIMIT 5`, storeID, phone)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Member
	for rows.Next() {
		m, err := scanMember(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// MaxNumericCode returns the largest numeric member code (optionally prefixed with "M") in the store, 0 when none.
func (MemberRepo) MaxNumericCode(ctx context.Context, storeID uuid.UUID) (int64, error) {
	var n int64
	err := Q(ctx).QueryRow(ctx, `SELECT COALESCE(max(regexp_replace(member_code, '^[Mm]', '')::bigint), 0) FROM members
		WHERE store_id=$1 AND member_code ~ '^[Mm]?[0-9]{1,15}$'`, storeID).Scan(&n)
	return n, err
}

func (MemberRepo) Create(ctx context.Context, m *domain.Member) error {
	var joined any
	if m.JoinedAt != nil && !m.JoinedAt.IsZero() {
		joined = m.JoinedAt.Time
	}
	err := Q(ctx).QueryRow(ctx, `INSERT INTO members (store_id, member_code, name, address, phone, email, national_id, share_capital, joined_at, price_tier, is_walkin, status, note)
		VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),$8,$9,$10,$11,$12::member_status,NULLIF($13,''))
		RETURNING id, created_at, updated_at`,
		m.StoreID, m.MemberCode, m.Name, m.Address, m.Phone, m.Email, m.NationalID, m.ShareCapital.StringFixed(2), joined, m.PriceTier, m.IsWalkin, string(m.Status), m.Note).
		Scan(&m.ID, &m.CreatedAt, &m.UpdatedAt)
	if isUniqueViolation(err) {
		return domain.ErrMemberCodeExists.With("code", m.MemberCode)
	}
	return err
}

func (MemberRepo) Update(ctx context.Context, m *domain.Member) error {
	var joined any
	if m.JoinedAt != nil && !m.JoinedAt.IsZero() {
		joined = m.JoinedAt.Time
	}
	_, err := Q(ctx).Exec(ctx, `UPDATE members SET member_code=$3, name=$4, address=NULLIF($5,''), phone=NULLIF($6,''), email=NULLIF($7,''),
		national_id=NULLIF($8,''), joined_at=$9, price_tier=$10, note=NULLIF($11,'') WHERE store_id=$1 AND id=$2`,
		m.StoreID, m.ID, m.MemberCode, m.Name, m.Address, m.Phone, m.Email, m.NationalID, joined, m.PriceTier, m.Note)
	if isUniqueViolation(err) {
		return domain.ErrMemberCodeExists.With("code", m.MemberCode)
	}
	return err
}

func (MemberRepo) SetStatus(ctx context.Context, storeID, id uuid.UUID, status domain.MemberStatus) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE members SET status=$3::member_status WHERE store_id=$1 AND id=$2`, storeID, id, string(status))
	return err
}

func (MemberRepo) SetShareCapital(ctx context.Context, storeID, id uuid.UUID, balance decimal.Decimal) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE members SET share_capital=$3 WHERE store_id=$1 AND id=$2`, storeID, id, balance.StringFixed(2))
	return err
}

// SetLine attaches a LINE account; a duplicate line_user_id in the store → MEMBER_ALREADY_LINKED.
func (MemberRepo) SetLine(ctx context.Context, storeID, id uuid.UUID, lineUserID, display string) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE members SET line_user_id=$3, line_display=NULLIF($4,'') WHERE store_id=$1 AND id=$2`, storeID, id, lineUserID, display)
	if isUniqueViolation(err) {
		return domain.ErrMemberLinked
	}
	return err
}

func (MemberRepo) ClearLine(ctx context.Context, storeID, id uuid.UUID) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE members SET line_user_id=NULL, line_display=NULL WHERE store_id=$1 AND id=$2`, storeID, id)
	return err
}

// MemberStats are the computed balances shown on the member card.
type MemberStats struct {
	ARBalance    decimal.Decimal `json:"ar_balance"`
	ARBills      int             `json:"ar_bills"`
	YTDPurchases decimal.Decimal `json:"ytd_purchases"`
	YTDBills     int             `json:"ytd_bills"`
}

func (MemberRepo) Stats(ctx context.Context, storeID, id uuid.UUID) (MemberStats, error) {
	from, to := YearRange(CurrentYear())
	var st MemberStats
	var ar, ytd string
	err := Q(ctx).QueryRow(ctx, `SELECT
		COALESCE(sum(ar_balance) FILTER (WHERE ar_status IN ('unpaid','partial')),0)::text,
		count(*) FILTER (WHERE ar_status IN ('unpaid','partial')),
		COALESCE(sum(net) FILTER (WHERE status='completed' AND sold_at>=$3 AND sold_at<$4),0)::text,
		count(*) FILTER (WHERE status='completed' AND sold_at>=$3 AND sold_at<$4)
		FROM sales WHERE store_id=$1 AND member_id=$2`, storeID, id, from, to).Scan(&ar, &st.ARBills, &ytd, &st.YTDBills)
	if err != nil {
		return st, err
	}
	st.ARBalance = dec(ar)
	st.YTDPurchases = dec(ytd)
	return st, nil
}

// MonthTotal is the purchase total for one calendar month.
type MonthTotal struct {
	Month int             `json:"month"`
	Total decimal.Decimal `json:"total"`
	Bills int             `json:"bills"`
}

// MonthlyPurchases returns completed-sale totals per month (1..12) for the year; months without sales are zero.
func (MemberRepo) MonthlyPurchases(ctx context.Context, storeID, id uuid.UUID, year int) ([]MonthTotal, error) {
	from, to := YearRange(year)
	rows, err := Q(ctx).Query(ctx, `SELECT extract(month FROM sold_at AT TIME ZONE 'Asia/Bangkok')::int, sum(net)::text, count(*)
		FROM sales WHERE store_id=$1 AND member_id=$2 AND status='completed' AND sold_at>=$3 AND sold_at<$4
		GROUP BY 1 ORDER BY 1`, storeID, id, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]MonthTotal, 12)
	for i := range out {
		out[i] = MonthTotal{Month: i + 1, Total: decimal.Zero}
	}
	for rows.Next() {
		var month, bills int
		var total string
		if err := rows.Scan(&month, &total, &bills); err != nil {
			return nil, err
		}
		if month >= 1 && month <= 12 {
			out[month-1] = MonthTotal{Month: month, Total: dec(total), Bills: bills}
		}
	}
	return out, rows.Err()
}

// SaleBrief is the compact sale row shown in purchase history.
type SaleBrief struct {
	ID        uuid.UUID       `json:"id"`
	DocNo     string          `json:"doc_no"`
	SoldAt    time.Time       `json:"sold_at"`
	Net       decimal.Decimal `json:"net"`
	Status    string          `json:"status"`
	ARStatus  string          `json:"ar_status"`
	ARBalance decimal.Decimal `json:"ar_balance"`
}

// RecentSales lists the member's latest sales in the year (all statuses), newest first.
func (MemberRepo) RecentSales(ctx context.Context, storeID, id uuid.UUID, year, limit int) ([]SaleBrief, error) {
	from, to := YearRange(year)
	rows, err := Q(ctx).Query(ctx, `SELECT id, doc_no, sold_at, net::text, status::text, ar_status::text, ar_balance::text
		FROM sales WHERE store_id=$1 AND member_id=$2 AND sold_at>=$3 AND sold_at<$4 ORDER BY sold_at DESC LIMIT $5`, storeID, id, from, to, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SaleBrief{}
	for rows.Next() {
		var s SaleBrief
		var net, ar string
		if err := rows.Scan(&s.ID, &s.DocNo, &s.SoldAt, &net, &s.Status, &s.ARStatus, &ar); err != nil {
			return nil, err
		}
		s.Net = dec(net)
		s.ARBalance = dec(ar)
		out = append(out, s)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Share ledger
// ---------------------------------------------------------------------------

const shareCols = `id, store_id, member_id, tx_type::text, amount::text, balance_after::text, COALESCE(note,''), COALESCE(ref_type,''), ref_id, created_by, occurred_at, created_at`

func scanShareTx(row pgx.Row) (*domain.ShareTx, error) {
	var t domain.ShareTx
	var typ, amount, bal string
	if err := row.Scan(&t.ID, &t.StoreID, &t.MemberID, &typ, &amount, &bal, &t.Note, &t.RefType, &t.RefID, &t.CreatedBy, &t.OccurredAt, &t.CreatedAt); err != nil {
		return nil, err
	}
	t.Type = domain.ShareTxType(typ)
	t.Amount = dec(amount)
	t.BalanceAfter = dec(bal)
	return &t, nil
}

type ShareRepo struct{}

func (ShareRepo) List(ctx context.Context, storeID, memberID uuid.UUID, limit, offset int) ([]domain.ShareTx, int64, error) {
	var total int64
	if err := Q(ctx).QueryRow(ctx, `SELECT count(*) FROM member_share_transactions WHERE store_id=$1 AND member_id=$2`, storeID, memberID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := Q(ctx).Query(ctx, `SELECT `+shareCols+` FROM member_share_transactions WHERE store_id=$1 AND member_id=$2
		ORDER BY occurred_at DESC, created_at DESC LIMIT $3 OFFSET $4`, storeID, memberID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []domain.ShareTx{}
	for rows.Next() {
		t, err := scanShareTx(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *t)
	}
	return out, total, rows.Err()
}

func (ShareRepo) Insert(ctx context.Context, t *domain.ShareTx) error {
	occurred := t.OccurredAt
	if occurred.IsZero() {
		occurred = time.Now()
	}
	return Q(ctx).QueryRow(ctx, `INSERT INTO member_share_transactions (store_id, member_id, tx_type, amount, balance_after, note, ref_type, ref_id, created_by, occurred_at)
		VALUES ($1,$2,$3::share_tx_type,$4,$5,NULLIF($6,''),NULLIF($7,''),$8,$9,$10) RETURNING id, occurred_at, created_at`,
		t.StoreID, t.MemberID, string(t.Type), t.Amount.StringFixed(2), t.BalanceAfter.StringFixed(2), t.Note, t.RefType, t.RefID, t.CreatedBy, occurred).
		Scan(&t.ID, &t.OccurredAt, &t.CreatedAt)
}

// ---------------------------------------------------------------------------
// LINE link codes
// ---------------------------------------------------------------------------

type LinkCodeRepo struct{}

// Create inserts a code; returns domain.ErrConflict when the code already exists (caller regenerates).
func (LinkCodeRepo) Create(ctx context.Context, c domain.MemberLinkCode) error {
	_, err := Q(ctx).Exec(ctx, `INSERT INTO member_link_codes (code, store_id, member_id, expires_at) VALUES ($1,$2,$3,$4)`, c.Code, c.StoreID, c.MemberID, c.ExpiresAt)
	if isUniqueViolation(err) {
		return domain.ErrConflict.With("field", "code")
	}
	return err
}

// RevokeUnused drops the member's outstanding codes so only the latest one is valid.
func (LinkCodeRepo) RevokeUnused(ctx context.Context, storeID, memberID uuid.UUID) error {
	_, err := Q(ctx).Exec(ctx, `DELETE FROM member_link_codes WHERE store_id=$1 AND member_id=$2 AND used_at IS NULL`, storeID, memberID)
	return err
}

// Consume marks a live code used and returns it; invalid/expired/used → MEMBER_LINK_CODE_INVALID.
func (LinkCodeRepo) Consume(ctx context.Context, storeID uuid.UUID, code string) (*domain.MemberLinkCode, error) {
	var c domain.MemberLinkCode
	err := Q(ctx).QueryRow(ctx, `UPDATE member_link_codes SET used_at=now() WHERE code=$2 AND store_id=$1 AND used_at IS NULL AND expires_at>now()
		RETURNING code, store_id, member_id, expires_at, used_at`, storeID, code).Scan(&c.Code, &c.StoreID, &c.MemberID, &c.ExpiresAt, &c.UsedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrLinkCodeInvalid
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// ---------------------------------------------------------------------------
// Dividend read model (LIFF history / estimate) — read only
// ---------------------------------------------------------------------------

type DividendHistoryRow struct {
	BEYear        int             `json:"be_year"`
	ShareCapital  decimal.Decimal `json:"share_capital"`
	Shares        decimal.Decimal `json:"shares"`
	Purchases     decimal.Decimal `json:"purchases"`
	ShareDividend decimal.Decimal `json:"share_dividend"`
	Rebate        decimal.Decimal `json:"rebate"`
	Total         decimal.Decimal `json:"total"`
	Status        string          `json:"status"`
}

type DividendReadRepo struct{}

// MemberHistory lists the member's statements from final runs, newest year first.
func (DividendReadRepo) MemberHistory(ctx context.Context, storeID, memberID uuid.UUID) ([]DividendHistoryRow, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT p.be_year, s.share_capital::text, s.shares::text, s.purchases::text, s.share_dividend::text, s.rebate::text, s.total::text, p.status::text
		FROM dividend_member_statements s
		JOIN dividend_runs r ON r.id=s.run_id
		JOIN dividend_periods p ON p.id=r.period_id
		WHERE s.store_id=$1 AND s.member_id=$2 AND r.is_final
		ORDER BY p.be_year DESC, r.run_no DESC`, storeID, memberID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DividendHistoryRow{}
	for rows.Next() {
		var h DividendHistoryRow
		var cap, sh, pu, sd, rb, tt string
		if err := rows.Scan(&h.BEYear, &cap, &sh, &pu, &sd, &rb, &tt, &h.Status); err != nil {
			return nil, err
		}
		h.ShareCapital, h.Shares, h.Purchases, h.ShareDividend, h.Rebate, h.Total = dec(cap), dec(sh), dec(pu), dec(sd), dec(rb), dec(tt)
		out = append(out, h)
	}
	return out, rows.Err()
}

// DividendRates are the per-unit rates of the most recent final run; nil when the key is absent.
type DividendRates struct {
	BEYear       int
	RatePerShare *decimal.Decimal
	RebateRate   *decimal.Decimal
}

// LatestFinalRates reads rate_per_share / rebate_rate from the newest final run's totals JSON. found=false when no final run exists.
func (DividendReadRepo) LatestFinalRates(ctx context.Context, storeID uuid.UUID) (DividendRates, bool, error) {
	var out DividendRates
	var raw []byte
	err := Q(ctx).QueryRow(ctx, `SELECT p.be_year, r.totals FROM dividend_runs r JOIN dividend_periods p ON p.id=r.period_id
		WHERE r.store_id=$1 AND r.is_final ORDER BY p.be_year DESC, r.run_no DESC LIMIT 1`, storeID).Scan(&out.BEYear, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, false, nil
	}
	if err != nil {
		return out, false, err
	}
	totals := map[string]any{}
	_ = json.Unmarshal(raw, &totals)
	out.RatePerShare = jsonDecimal(totals["rate_per_share"])
	out.RebateRate = jsonDecimal(totals["rebate_rate"])
	return out, true, nil
}

// jsonDecimal converts a JSON number or numeric string to a decimal; nil for absent/invalid values.
func jsonDecimal(v any) *decimal.Decimal {
	switch x := v.(type) {
	case float64:
		d := decimal.NewFromFloat(x)
		return &d
	case string:
		d, err := decimal.NewFromString(strings.TrimSpace(x))
		if err != nil {
			return nil
		}
		return &d
	case json.Number:
		d, err := decimal.NewFromString(x.String())
		if err != nil {
			return nil
		}
		return &d
	}
	return nil
}
