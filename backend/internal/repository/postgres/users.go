package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/svdev/pos/internal/domain"
)

const userCols = `id, store_id, username, password_hash, display_name, COALESCE(phone,''), role, locale, is_active,
	must_reset_password, last_login_at, COALESCE(legacy_id,''), created_at, updated_at`

func scanUser(row pgx.Row) (*domain.User, error) {
	var u domain.User
	var role, loc string
	if err := row.Scan(&u.ID, &u.StoreID, &u.Username, &u.PasswordHash, &u.DisplayName, &u.Phone, &role, &loc, &u.IsActive,
		&u.MustResetPassword, &u.LastLoginAt, &u.LegacyID, &u.CreatedAt, &u.UpdatedAt); err != nil {
		return nil, err
	}
	u.Role = domain.Role(role)
	u.Locale = loc
	return &u, nil
}

type UserRepo struct{}

func (UserRepo) FindByStoreAndUsername(ctx context.Context, storeID *uuid.UUID, username string) (*domain.User, error) {
	var row pgx.Row
	if storeID == nil {
		row = Q(ctx).QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE store_id IS NULL AND lower(username)=lower($1)`, username)
	} else {
		row = Q(ctx).QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE store_id=$1 AND lower(username)=lower($2)`, *storeID, username)
	}
	u, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return u, err
}

func (UserRepo) Get(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	u, err := scanUser(Q(ctx).QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return u, err
}

func (UserRepo) ListByStore(ctx context.Context, storeID uuid.UUID) ([]domain.User, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT `+userCols+` FROM users WHERE store_id=$1 ORDER BY role, username`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	return out, rows.Err()
}

func (UserRepo) Create(ctx context.Context, u *domain.User) error {
	err := Q(ctx).QueryRow(ctx, `INSERT INTO users (store_id, username, password_hash, display_name, phone, role, locale, is_active, must_reset_password, legacy_id, legacy_level)
		VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8,$9,NULLIF($10,''),NULLIF($11,'')) RETURNING id, created_at, updated_at`,
		u.StoreID, u.Username, u.PasswordHash, u.DisplayName, u.Phone, string(u.Role), u.Locale, u.IsActive, u.MustResetPassword, u.LegacyID, "").
		Scan(&u.ID, &u.CreatedAt, &u.UpdatedAt)
	if isUniqueViolation(err) {
		return domain.ErrConflict.With("field", "username")
	}
	return err
}

func (UserRepo) Update(ctx context.Context, u *domain.User) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE users SET display_name=$2, phone=NULLIF($3,''), role=$4, locale=$5, is_active=$6, must_reset_password=$7 WHERE id=$1`,
		u.ID, u.DisplayName, u.Phone, string(u.Role), u.Locale, u.IsActive, u.MustResetPassword)
	return err
}

func (UserRepo) SetPassword(ctx context.Context, id uuid.UUID, hash string, mustReset bool) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE users SET password_hash=$2, must_reset_password=$3 WHERE id=$1`, id, hash, mustReset)
	return err
}

func (UserRepo) TouchLogin(ctx context.Context, id uuid.UUID) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE users SET last_login_at=now() WHERE id=$1`, id)
	return err
}

// UpsertLegacy inserts a user by (store_id, legacy_id) or updates its mutable fields; returns the id.
func (UserRepo) UpsertLegacy(ctx context.Context, u *domain.User, legacyLevel string) (uuid.UUID, error) {
	var id uuid.UUID
	err := Q(ctx).QueryRow(ctx, `INSERT INTO users (store_id, username, password_hash, display_name, phone, role, locale, is_active, must_reset_password, legacy_id, legacy_level)
		VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8,true,$9,$10)
		ON CONFLICT (store_id, legacy_id) WHERE legacy_id IS NOT NULL
		DO UPDATE SET display_name=EXCLUDED.display_name, is_active=EXCLUDED.is_active, legacy_level=EXCLUDED.legacy_level
		RETURNING id`,
		u.StoreID, u.Username, u.PasswordHash, u.DisplayName, u.Phone, string(u.Role), u.Locale, u.IsActive, u.LegacyID, legacyLevel).Scan(&id)
	return id, err
}

// --- refresh tokens ---------------------------------------------------------

type TokenRepo struct{}

func (TokenRepo) Create(ctx context.Context, userID uuid.UUID, hash string, exp time.Time, ua, ip string) error {
	_, err := Q(ctx).Exec(ctx, `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip) VALUES ($1,$2,$3,$4,$5)`, userID, hash, exp, ua, ip)
	return err
}

// Consume revokes a live token and returns its user id (rotation).
func (TokenRepo) Consume(ctx context.Context, hash string) (uuid.UUID, error) {
	var uid uuid.UUID
	err := Q(ctx).QueryRow(ctx, `UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() RETURNING user_id`, hash).Scan(&uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, domain.ErrTokenInvalid
	}
	return uid, err
}

func (TokenRepo) RevokeAll(ctx context.Context, userID uuid.UUID) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, userID)
	return err
}

// --- audit -----------------------------------------------------------------

type AuditRepo struct{}

func (AuditRepo) Write(ctx context.Context, e domain.AuditEntry) error {
	_, err := Q(ctx).Exec(ctx, `INSERT INTO audit_logs (store_id, actor_id, actor_name, action, entity, entity_id, before, after, ip)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, e.StoreID, e.ActorID, e.ActorName, e.Action, e.Entity, e.EntityID, jsonOrNil(e.Before), jsonOrNil(e.After), e.IP)
	if err != nil {
		return fmt.Errorf("audit: %w", err)
	}
	return nil
}

type AuditRow struct {
	ID        int64     `json:"id"`
	ActorName string    `json:"actor_name"`
	Action    string    `json:"action"`
	Entity    string    `json:"entity"`
	EntityID  string    `json:"entity_id"`
	Before    any       `json:"before,omitempty"`
	After     any       `json:"after,omitempty"`
	IP        string    `json:"ip,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

func (AuditRepo) List(ctx context.Context, storeID uuid.UUID, entity string, limit, offset int) ([]AuditRow, int64, error) {
	var total int64
	if err := Q(ctx).QueryRow(ctx, `SELECT count(*) FROM audit_logs WHERE store_id=$1 AND ($2='' OR entity=$2)`, storeID, entity).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := Q(ctx).Query(ctx, `SELECT id, COALESCE(actor_name,''), action, entity, COALESCE(entity_id,''), before, after, COALESCE(ip,''), created_at
		FROM audit_logs WHERE store_id=$1 AND ($2='' OR entity=$2) ORDER BY id DESC LIMIT $3 OFFSET $4`, storeID, entity, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []AuditRow{}
	for rows.Next() {
		var a AuditRow
		if err := rows.Scan(&a.ID, &a.ActorName, &a.Action, &a.Entity, &a.EntityID, &a.Before, &a.After, &a.IP, &a.CreatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, a)
	}
	return out, total, rows.Err()
}
