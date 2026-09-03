package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/svdev/pos/internal/domain"
)

const storeCols = `id, code, name, COALESCE(name_en,''), COALESCE(address,''), COALESCE(phone,''), COALESCE(tax_id,''),
	COALESCE(receipt_header,''), COALESCE(receipt_footer,''), logo IS NOT NULL, default_locale::text, timezone, is_active, COALESCE(legacy_id,''), created_at, updated_at`

func scanStore(row pgx.Row) (*domain.Store, error) {
	var s domain.Store
	if err := row.Scan(&s.ID, &s.Code, &s.Name, &s.NameEN, &s.Address, &s.Phone, &s.TaxID, &s.ReceiptHeader, &s.ReceiptFooter,
		&s.HasLogo, &s.DefaultLocale, &s.Timezone, &s.IsActive, &s.LegacyID, &s.CreatedAt, &s.UpdatedAt); err != nil {
		return nil, err
	}
	return &s, nil
}

type StoreRepo struct{}

func (StoreRepo) Get(ctx context.Context, id uuid.UUID) (*domain.Store, error) {
	s, err := scanStore(Q(ctx).QueryRow(ctx, `SELECT `+storeCols+` FROM stores WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return s, err
}

func (StoreRepo) GetByCode(ctx context.Context, code string) (*domain.Store, error) {
	s, err := scanStore(Q(ctx).QueryRow(ctx, `SELECT `+storeCols+` FROM stores WHERE lower(code)=lower($1)`, code))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return s, err
}

func (StoreRepo) List(ctx context.Context) ([]domain.Store, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT `+storeCols+` FROM stores ORDER BY code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Store{}
	for rows.Next() {
		s, err := scanStore(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

func (StoreRepo) Create(ctx context.Context, s *domain.Store) error {
	err := Q(ctx).QueryRow(ctx, `INSERT INTO stores (code, name, name_en, address, phone, tax_id, receipt_header, receipt_footer, default_locale, timezone, is_active, legacy_id)
		VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),$9::locale_code,$10,$11,NULLIF($12,''))
		RETURNING id, created_at, updated_at`,
		s.Code, s.Name, s.NameEN, s.Address, s.Phone, s.TaxID, s.ReceiptHeader, s.ReceiptFooter, orDefault(s.DefaultLocale, "th"), orDefault(s.Timezone, "Asia/Bangkok"), s.IsActive, s.LegacyID).
		Scan(&s.ID, &s.CreatedAt, &s.UpdatedAt)
	if isUniqueViolation(err) {
		return domain.ErrConflict.With("field", "code")
	}
	if err == nil {
		_, err = Q(ctx).Exec(ctx, `INSERT INTO store_settings (store_id) VALUES ($1) ON CONFLICT DO NOTHING`, s.ID)
	}
	return err
}

func (StoreRepo) Update(ctx context.Context, s *domain.Store) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE stores SET name=$2, name_en=NULLIF($3,''), address=NULLIF($4,''), phone=NULLIF($5,''), tax_id=NULLIF($6,''),
		receipt_header=NULLIF($7,''), receipt_footer=NULLIF($8,''), default_locale=$9::locale_code, timezone=$10, is_active=$11 WHERE id=$1`,
		s.ID, s.Name, s.NameEN, s.Address, s.Phone, s.TaxID, s.ReceiptHeader, s.ReceiptFooter, orDefault(s.DefaultLocale, "th"), orDefault(s.Timezone, "Asia/Bangkok"), s.IsActive)
	return err
}

func (StoreRepo) SetLogo(ctx context.Context, id uuid.UUID, logo []byte) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE stores SET logo=$2 WHERE id=$1`, id, logo)
	return err
}

func (StoreRepo) GetLogo(ctx context.Context, id uuid.UUID) ([]byte, error) {
	var b []byte
	err := Q(ctx).QueryRow(ctx, `SELECT logo FROM stores WHERE id=$1`, id).Scan(&b)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return b, err
}

func (StoreRepo) GetSettings(ctx context.Context, id uuid.UUID) (domain.StoreSettings, error) {
	var raw []byte
	err := Q(ctx).QueryRow(ctx, `SELECT settings FROM store_settings WHERE store_id=$1`, id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.StoreSettings{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := domain.StoreSettings{}
	_ = json.Unmarshal(raw, &out)
	return out, nil
}

func (StoreRepo) PutSettings(ctx context.Context, id uuid.UUID, s domain.StoreSettings) error {
	b, _ := json.Marshal(s)
	_, err := Q(ctx).Exec(ctx, `INSERT INTO store_settings (store_id, settings, updated_at) VALUES ($1,$2,now())
		ON CONFLICT (store_id) DO UPDATE SET settings=EXCLUDED.settings, updated_at=now()`, id, b)
	return err
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}
