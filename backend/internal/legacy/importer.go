package legacy

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/svdev/pos/internal/auth"
	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

// Stage names in execution order.
var StageOrder = []string{"validate", "lookups", "products", "members", "sales", "payments", "receipts", "expenses", "misc", "dividends", "reconcile"}

type Options struct {
	Dir       string
	StoreCode string
	Stages    []string // empty = all
	DryRun    bool
	CheckHash bool
	Log       *slog.Logger
}

// StageReport is one line of the final report.
type StageReport struct {
	Stage    string         `json:"stage"`
	RowsIn   int            `json:"rows_in"`
	RowsOut  int            `json:"rows_out"`
	Skipped  int            `json:"skipped"`
	Warnings []string       `json:"warnings,omitempty"`
	Extra    map[string]any `json:"extra,omitempty"`
	Duration string         `json:"duration"`
}

type Report struct {
	StoreID    uuid.UUID     `json:"store_id"`
	StoreCode  string        `json:"store_code"`
	DryRun     bool          `json:"dry_run"`
	StartedAt  time.Time     `json:"started_at"`
	FinishedAt time.Time     `json:"finished_at"`
	Stages     []StageReport `json:"stages"`
	Reconcile  *Reconcile    `json:"reconcile,omitempty"`
	Failed     string        `json:"failed,omitempty"`
	SourceSHA  string        `json:"source_sha256"`
}

type Importer struct {
	db      *postgres.DB
	m       *Manifest
	opt     Options
	log     *slog.Logger
	storeID uuid.UUID
	report  *Report

	// caches (legacy id → new id)
	users      map[string]uuid.UUID // user_user → users.id
	userNames  map[string]string
	categories map[string]uuid.UUID // brand_id → category id
	units      map[string]uuid.UUID // unit name → id
	suppliers  map[string]uuid.UUID // sup_id → id
	products   map[string]uuid.UUID // pro_id → id
	prodInfo   map[string]prodMeta
	members    map[string]uuid.UUID // cust_id → id
	walkinID   uuid.UUID
	delNames   map[string]string // pro_id → name from delproducts
	expTypes   map[string]uuid.UUID
	sales      map[string]uuid.UUID // doc_no (dup_seq 0) → sale id
	warn       func(stage, msg string)
}

type prodMeta struct {
	Name    string
	CostAvg string
}

func New(db *postgres.DB, opt Options) (*Importer, error) {
	m, err := LoadManifest(opt.Dir)
	if err != nil {
		return nil, err
	}
	if opt.Log == nil {
		opt.Log = slog.Default()
	}
	return &Importer{db: db, m: m, opt: opt, log: opt.Log,
		users: map[string]uuid.UUID{}, userNames: map[string]string{}, categories: map[string]uuid.UUID{}, units: map[string]uuid.UUID{},
		suppliers: map[string]uuid.UUID{}, products: map[string]uuid.UUID{}, prodInfo: map[string]prodMeta{}, members: map[string]uuid.UUID{},
		delNames: map[string]string{}, expTypes: map[string]uuid.UUID{}, sales: map[string]uuid.UUID{}}, nil
}

// Run executes the selected stages. In dry-run mode everything happens in one transaction that is rolled back.
func (im *Importer) Run(ctx context.Context) (*Report, error) {
	im.report = &Report{StoreCode: im.opt.StoreCode, DryRun: im.opt.DryRun, StartedAt: time.Now(), SourceSHA: im.m.SourceSHA256}
	stages := im.opt.Stages
	if len(stages) == 0 {
		stages = StageOrder
	}
	run := func(ctx context.Context) error {
		if err := im.resolveStore(ctx); err != nil {
			return err
		}
		for _, st := range stages {
			if err := im.runStage(ctx, st); err != nil {
				im.report.Failed = fmt.Sprintf("%s: %v", st, err)
				return err
			}
		}
		return nil
	}
	var err error
	if im.opt.DryRun {
		errRollback := errors.New("dry-run rollback")
		err = im.db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, _ pgx.Tx) error {
			if e := run(ctx); e != nil {
				return e
			}
			return errRollback
		})
		if errors.Is(err, errRollback) {
			err = nil
		}
	} else {
		// one transaction per stage so a failure keeps earlier stages
		err = im.db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, _ pgx.Tx) error { return im.resolveStore(ctx) })
		if err == nil {
			for _, st := range stages {
				st := st
				err = im.db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, _ pgx.Tx) error { return im.runStage(ctx, st) })
				if err != nil {
					im.report.Failed = fmt.Sprintf("%s: %v", st, err)
					break
				}
			}
		}
	}
	im.report.FinishedAt = time.Now()
	return im.report, err
}

func (im *Importer) runStage(ctx context.Context, name string) error {
	start := time.Now()
	sr := StageReport{Stage: name, Extra: map[string]any{}}
	im.warn = func(stage, msg string) {
		if len(sr.Warnings) < 200 {
			sr.Warnings = append(sr.Warnings, msg)
		} else if len(sr.Warnings) == 200 {
			sr.Warnings = append(sr.Warnings, "... more warnings suppressed")
		}
	}
	im.log.Info("stage start", "stage", name)
	var err error
	switch name {
	case "validate":
		err = im.stageValidate(&sr)
	case "lookups":
		err = im.stageLookups(ctx, &sr)
	case "products":
		err = im.stageProducts(ctx, &sr)
	case "members":
		err = im.stageMembers(ctx, &sr)
	case "sales":
		err = im.stageSales(ctx, &sr)
	case "payments":
		err = im.stagePayments(ctx, &sr)
	case "receipts":
		err = im.stageReceipts(ctx, &sr)
	case "expenses":
		err = im.stageExpenses(ctx, &sr)
	case "misc":
		err = im.stageMisc(ctx, &sr)
	case "dividends":
		err = im.stageDividends(ctx, &sr)
	case "reconcile":
		err = im.stageReconcile(ctx, &sr)
	default:
		err = fmt.Errorf("unknown stage %q", name)
	}
	sr.Duration = time.Since(start).Round(time.Millisecond).String()
	im.report.Stages = append(im.report.Stages, sr)
	if name != "validate" {
		_ = im.recordRun(ctx, sr, err)
	}
	im.log.Info("stage done", "stage", name, "in", sr.RowsIn, "out", sr.RowsOut, "skipped", sr.Skipped, "warnings", len(sr.Warnings), "took", sr.Duration, "err", err)
	return err
}

func (im *Importer) recordRun(ctx context.Context, sr StageReport, runErr error) error {
	rep, _ := json.Marshal(sr)
	var errStr any
	if runErr != nil {
		errStr = runErr.Error()
	}
	_, err := postgres.Q(ctx).Exec(ctx, `INSERT INTO legacy_import_runs (store_id, stage, source_sha256, rows_in, rows_out, rows_skipped, dry_run, report, finished_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`, im.storeID, sr.Stage, im.m.SourceSHA256, sr.RowsIn, sr.RowsOut, sr.Skipped, im.opt.DryRun, rep)
	_ = errStr
	return err
}

func (im *Importer) resolveStore(ctx context.Context) error {
	if im.storeID != uuid.Nil {
		return nil
	}
	var stores postgres.StoreRepo
	st, err := stores.GetByCode(ctx, im.opt.StoreCode)
	if err != nil {
		return fmt.Errorf("store %q: %w (create it first with cmd/seed)", im.opt.StoreCode, err)
	}
	im.storeID = st.ID
	im.report.StoreID = st.ID
	return nil
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

func (im *Importer) stageValidate(sr *StageReport) error {
	problems := im.m.Validate(im.opt.CheckHash)
	for _, t := range im.m.Tables {
		sr.RowsIn += t.Rows
	}
	sr.Extra["tables"] = len(im.m.Tables)
	if len(problems) > 0 {
		return fmt.Errorf("manifest validation failed: %s", strings.Join(problems, "; "))
	}
	return nil
}

// ---------------------------------------------------------------------------
// lookups: store profile/settings from company, users, categories, units, suppliers, expense types
// ---------------------------------------------------------------------------

var legacyRoleMap = map[string]domain.Role{"1": domain.RoleStoreOwner, "2": domain.RoleCashier, "3": domain.RoleManager, "5": domain.RoleCashier}

func (im *Importer) stageLookups(ctx context.Context, sr *StageReport) error {
	q := postgres.Q(ctx)
	// company → store profile
	if rows, err := ReadAll(im.m.Path("company")); err == nil && len(rows) > 0 {
		c := rows[0]
		sr.RowsIn++
		_, err := q.Exec(ctx, `UPDATE stores SET name=$2, address=NULLIF($3,''), phone=NULLIF($4,''), receipt_header=NULLIF($5,''), receipt_footer=NULLIF($6,''), legacy_id=$7 WHERE id=$1`,
			im.storeID, c.Str("company_name"), c.Str("company_add"), strings.TrimPrefix(c.Str("company_tel"), "โทร."), c.Str("company_typepaper"), c.Str("company_textbuttom"), c.Str("company_id"))
		if err != nil {
			return fmt.Errorf("store profile: %w", err)
		}
		if logo := c.Str("company_logo"); logo != "" {
			if b, err := base64.StdEncoding.DecodeString(logo); err == nil && len(b) > 0 {
				_, _ = q.Exec(ctx, `UPDATE stores SET logo=$2 WHERE id=$1`, im.storeID, b)
			}
		}
		settings := map[string]any{
			"legacy": map[string]any{
				"closeofday": c.Str("company_closeofday"), "typesoftware": c.Str("company_typesoftware"), "showtax": c.Str("company_showtax"),
				"editprice": c.Str("company_editprice"), "vattype": c.Str("company_vattype"), "roundpoint": c.Str("company_roundpoint"),
				"cashcomport": c.Str("company_cashcomport"), "displaycomport": c.Str("company_displaycomport"),
			},
			"paper_width": 58, "receipt_locale": "th", "allow_price_edit": c.Str("company_editprice") == "YES", "require_shift": false, "allow_negative_stock": true,
		}
		if c.Str("company_cashcomport") != "" {
			settings["drawer_port"] = c.Str("company_cashcomport")
		}
		if c.Str("company_displaycomport") != "" {
			settings["display_port"] = c.Str("company_displaycomport")
		}
		b, _ := json.Marshal(settings)
		if _, err := q.Exec(ctx, `INSERT INTO store_settings (store_id, settings) VALUES ($1,$2) ON CONFLICT (store_id) DO UPDATE SET settings = store_settings.settings || EXCLUDED.settings, updated_at=now()`, im.storeID, b); err != nil {
			return fmt.Errorf("store settings: %w", err)
		}
		sr.RowsOut++
	}

	// users
	var users postgres.UserRepo
	if err := EachRow(im.m.Path("usersys"), func(_ int, r Row) error {
		sr.RowsIn++
		role, ok := legacyRoleMap[r.Str("user_level")]
		if !ok {
			role = domain.RoleCashier
			im.warn("lookups", "user "+r.Str("user_user")+": unknown level "+r.Str("user_level")+" → cashier")
		}
		pw, _ := auth.RandomToken(24)
		hash, err := auth.HashPassword(pw) // random; must_reset_password forces a new one
		if err != nil {
			return err
		}
		u := &domain.User{StoreID: &im.storeID, Username: r.Str("user_user"), PasswordHash: hash, DisplayName: orDefault(r.Str("user_name"), r.Str("user_user")),
			Phone: r.Str("user_phone"), Role: role, Locale: "th", IsActive: strings.EqualFold(r.Str("user_status"), "Active"), LegacyID: r.Str("user_user")}
		id, err := users.UpsertLegacy(ctx, u, r.Str("user_level"))
		if err != nil {
			return fmt.Errorf("user %s: %w", u.Username, err)
		}
		im.users[u.LegacyID] = id
		im.userNames[u.LegacyID] = u.DisplayName
		sr.RowsOut++
		return nil
	}); err != nil {
		return err
	}

	// categories (brand)
	if err := EachRow(im.m.Path("brand"), func(_ int, r Row) error {
		sr.RowsIn++
		name := r.Str("brand_name")
		if name == "" {
			name = "ไม่ระบุหมวด"
		}
		var id uuid.UUID
		err := q.QueryRow(ctx, `INSERT INTO product_categories (store_id, name, legacy_id) VALUES ($1,$2,$3)
			ON CONFLICT (store_id, legacy_id) WHERE legacy_id IS NOT NULL DO UPDATE SET name=EXCLUDED.name RETURNING id`, im.storeID, name, r.Str("brand_id")).Scan(&id)
		if err != nil {
			// name collision with a different legacy id → reuse existing by name
			if e2 := q.QueryRow(ctx, `SELECT id FROM product_categories WHERE store_id=$1 AND name=$2`, im.storeID, name).Scan(&id); e2 != nil {
				return fmt.Errorf("category %s: %w", name, err)
			}
		}
		im.categories[r.Str("brand_id")] = id
		sr.RowsOut++
		return nil
	}); err != nil {
		return err
	}
	// unknown-category bucket
	if _, ok := im.categories[""]; !ok {
		var id uuid.UUID
		if err := q.QueryRow(ctx, `INSERT INTO product_categories (store_id, name) VALUES ($1,'ไม่ระบุหมวด') ON CONFLICT (store_id, name) DO UPDATE SET name=EXCLUDED.name RETURNING id`, im.storeID).Scan(&id); err != nil {
			return err
		}
		im.categories[""] = id
	}

	// units from distinct product.pro_model
	unitNames := map[string]bool{}
	_ = EachRow(im.m.Path("product"), func(_ int, r Row) error {
		if u := r.Str("pro_model"); u != "" {
			unitNames[u] = true
		}
		return nil
	})
	_ = EachRow(im.m.Path("delproducts"), func(_ int, r Row) error {
		if u := r.Str("pro_model"); u != "" {
			unitNames[u] = true
		}
		return nil
	})
	names := make([]string, 0, len(unitNames))
	for n := range unitNames {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		var id uuid.UUID
		if err := q.QueryRow(ctx, `INSERT INTO units (store_id, name) VALUES ($1,$2) ON CONFLICT (store_id, name) DO UPDATE SET name=EXCLUDED.name RETURNING id`, im.storeID, n).Scan(&id); err != nil {
			return fmt.Errorf("unit %s: %w", n, err)
		}
		im.units[n] = id
		sr.RowsOut++
	}
	sr.Extra["units"] = len(names)

	// suppliers
	if err := EachRow(im.m.Path("supplier"), func(_ int, r Row) error {
		sr.RowsIn++
		var id uuid.UUID
		err := q.QueryRow(ctx, `INSERT INTO suppliers (store_id, code, name, address, phone, fax, email, legacy_id) VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),$2)
			ON CONFLICT (store_id, legacy_id) WHERE legacy_id IS NOT NULL DO UPDATE SET name=EXCLUDED.name, address=EXCLUDED.address, phone=EXCLUDED.phone RETURNING id`,
			im.storeID, r.Str("sup_id"), orDefault(r.Str("sup_name"), "ไม่ระบุ"), r.Str("sup_address"), r.Str("sup_phone"), r.Str("sup_fax"), r.Str("sup_email")).Scan(&id)
		if err != nil {
			return fmt.Errorf("supplier %s: %w", r.Str("sup_id"), err)
		}
		im.suppliers[r.Str("sup_id")] = id
		sr.RowsOut++
		return nil
	}); err != nil {
		return err
	}

	// expense types
	if err := EachRow(im.m.Path("expenses_type"), func(_ int, r Row) error {
		sr.RowsIn++
		var id uuid.UUID
		err := q.QueryRow(ctx, `INSERT INTO expense_types (store_id, name, legacy_id) VALUES ($1,$2,$3)
			ON CONFLICT (store_id, legacy_id) WHERE legacy_id IS NOT NULL DO UPDATE SET name=EXCLUDED.name RETURNING id`, im.storeID, r.Str("expen_type"), r.Str("type_id")).Scan(&id)
		if err != nil {
			if e2 := q.QueryRow(ctx, `SELECT id FROM expense_types WHERE store_id=$1 AND name=$2`, im.storeID, r.Str("expen_type")).Scan(&id); e2 != nil {
				return fmt.Errorf("expense type %s: %w", r.Str("type_id"), err)
			}
		}
		im.expTypes[r.Str("type_id")] = id
		sr.RowsOut++
		return nil
	}); err != nil {
		return err
	}
	return nil
}

// loadCaches refreshes legacy-id maps from the database (used when a stage runs standalone).
func (im *Importer) loadCaches(ctx context.Context) error {
	q := postgres.Q(ctx)
	load := func(sql string, dst map[string]uuid.UUID) error {
		rows, err := q.Query(ctx, sql, im.storeID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var k string
			var id uuid.UUID
			if err := rows.Scan(&k, &id); err != nil {
				return err
			}
			dst[k] = id
		}
		return rows.Err()
	}
	if len(im.users) == 0 {
		if err := load(`SELECT legacy_id, id FROM users WHERE store_id=$1 AND legacy_id IS NOT NULL`, im.users); err != nil {
			return err
		}
	}
	if len(im.categories) == 0 {
		if err := load(`SELECT COALESCE(legacy_id, ''), id FROM product_categories WHERE store_id=$1`, im.categories); err != nil {
			return err
		}
	}
	if len(im.units) == 0 {
		if err := load(`SELECT name, id FROM units WHERE store_id=$1`, im.units); err != nil {
			return err
		}
	}
	if len(im.suppliers) == 0 {
		if err := load(`SELECT legacy_id, id FROM suppliers WHERE store_id=$1 AND legacy_id IS NOT NULL`, im.suppliers); err != nil {
			return err
		}
	}
	if len(im.expTypes) == 0 {
		if err := load(`SELECT legacy_id, id FROM expense_types WHERE store_id=$1 AND legacy_id IS NOT NULL`, im.expTypes); err != nil {
			return err
		}
	}
	if len(im.products) == 0 {
		rows, err := q.Query(ctx, `SELECT legacy_id, id, name, cost_avg::text FROM products WHERE store_id=$1 AND legacy_id IS NOT NULL`, im.storeID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var k, name, cost string
			var id uuid.UUID
			if err := rows.Scan(&k, &id, &name, &cost); err != nil {
				rows.Close()
				return err
			}
			im.products[k] = id
			im.prodInfo[k] = prodMeta{Name: name, CostAvg: cost}
		}
		rows.Close()
	}
	if len(im.members) == 0 {
		if err := load(`SELECT legacy_id, id FROM members WHERE store_id=$1 AND legacy_id IS NOT NULL`, im.members); err != nil {
			return err
		}
		_ = q.QueryRow(ctx, `SELECT id FROM members WHERE store_id=$1 AND is_walkin LIMIT 1`, im.storeID).Scan(&im.walkinID)
	}
	if len(im.sales) == 0 {
		if err := load(`SELECT doc_no, id FROM sales WHERE store_id=$1 AND legacy_id IS NOT NULL AND legacy_dup_seq=0`, im.sales); err != nil {
			return err
		}
	}
	return nil
}

func orDefault(s, d string) string {
	if strings.TrimSpace(s) == "" {
		return d
	}
	return s
}
