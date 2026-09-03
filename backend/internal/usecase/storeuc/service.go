// Package storeuc manages stores (platform admin) and per-store profile, settings, and staff users.
package storeuc

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/svdev/pos/internal/auth"
	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

type Service struct {
	db     *postgres.DB
	stores postgres.StoreRepo
	users  postgres.UserRepo
	audit  postgres.AuditRepo
}

func New(db *postgres.DB) *Service { return &Service{db: db} }

// Actor identifies who performs an action (for audit).
type Actor struct {
	UserID uuid.UUID
	Name   string
	IP     string
}

// ---- platform admin: stores ------------------------------------------------

func (s *Service) ListStores(ctx context.Context) ([]domain.Store, error) {
	var out []domain.Store
	err := s.db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.stores.List(ctx)
		return err
	})
	return out, err
}

type CreateStoreInput struct {
	Store         domain.Store `json:"store"`
	OwnerUsername string       `json:"owner_username"`
	OwnerPassword string       `json:"owner_password"`
	OwnerName     string       `json:"owner_name"`
}

func (s *Service) CreateStore(ctx context.Context, actor Actor, in CreateStoreInput) (*domain.Store, error) {
	in.Store.Code = strings.ToUpper(strings.TrimSpace(in.Store.Code))
	if in.Store.Code == "" || in.Store.Name == "" {
		return nil, domain.ErrValidation.With("field", "code/name")
	}
	if in.OwnerUsername != "" {
		if err := auth.ValidatePasswordStrength(in.OwnerPassword); err != nil {
			return nil, domain.ErrPasswordWeak
		}
	}
	st := in.Store
	st.IsActive = true
	err := s.db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, _ pgx.Tx) error {
		if err := s.stores.Create(ctx, &st); err != nil {
			return err
		}
		if in.OwnerUsername != "" {
			h, err := auth.HashPassword(in.OwnerPassword)
			if err != nil {
				return err
			}
			owner := &domain.User{StoreID: &st.ID, Username: in.OwnerUsername, PasswordHash: h, DisplayName: orDefault(in.OwnerName, in.OwnerUsername), Role: domain.RoleStoreOwner, Locale: st.DefaultLocale, IsActive: true}
			if err := s.users.Create(ctx, owner); err != nil {
				return err
			}
		}
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &st.ID, ActorID: &actor.UserID, ActorName: actor.Name, Action: "store.create", Entity: "store", EntityID: st.ID.String(), After: st, IP: actor.IP})
	})
	if err != nil {
		return nil, err
	}
	return &st, nil
}

func (s *Service) UpdateStoreAdmin(ctx context.Context, actor Actor, st domain.Store) (*domain.Store, error) {
	var out *domain.Store
	err := s.db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, _ pgx.Tx) error {
		cur, err := s.stores.Get(ctx, st.ID)
		if err != nil {
			return err
		}
		st.Code = cur.Code
		if err := s.stores.Update(ctx, &st); err != nil {
			return err
		}
		out, err = s.stores.Get(ctx, st.ID)
		if err != nil {
			return err
		}
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &st.ID, ActorID: &actor.UserID, ActorName: actor.Name, Action: "store.update", Entity: "store", EntityID: st.ID.String(), Before: cur, After: out, IP: actor.IP})
	})
	return out, err
}

// ---- current store ----------------------------------------------------------

func (s *Service) GetStore(ctx context.Context, storeID uuid.UUID) (*domain.Store, error) {
	var out *domain.Store
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.stores.Get(ctx, storeID)
		return err
	})
	return out, err
}

func (s *Service) UpdateStore(ctx context.Context, actor Actor, storeID uuid.UUID, st domain.Store) (*domain.Store, error) {
	var out *domain.Store
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		cur, err := s.stores.Get(ctx, storeID)
		if err != nil {
			return err
		}
		st.ID = storeID
		st.Code = cur.Code
		st.IsActive = cur.IsActive
		if err := s.stores.Update(ctx, &st); err != nil {
			return err
		}
		out, err = s.stores.Get(ctx, storeID)
		if err != nil {
			return err
		}
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: &actor.UserID, ActorName: actor.Name, Action: "store.update", Entity: "store", EntityID: storeID.String(), Before: cur, After: out, IP: actor.IP})
	})
	return out, err
}

func (s *Service) SetLogo(ctx context.Context, storeID uuid.UUID, logo []byte) error {
	return s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		return s.stores.SetLogo(ctx, storeID, logo)
	})
}

func (s *Service) GetLogo(ctx context.Context, storeID uuid.UUID) ([]byte, error) {
	var b []byte
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		b, err = s.stores.GetLogo(ctx, storeID)
		return err
	})
	return b, err
}

func (s *Service) GetSettings(ctx context.Context, storeID uuid.UUID) (domain.StoreSettings, error) {
	var out domain.StoreSettings
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.stores.GetSettings(ctx, storeID)
		return err
	})
	return out, err
}

func (s *Service) PutSettings(ctx context.Context, actor Actor, storeID uuid.UUID, in domain.StoreSettings) (domain.StoreSettings, error) {
	var out domain.StoreSettings
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		cur, _ := s.stores.GetSettings(ctx, storeID)
		if err := s.stores.PutSettings(ctx, storeID, in); err != nil {
			return err
		}
		out = in
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: &actor.UserID, ActorName: actor.Name, Action: "store.settings", Entity: "store_settings", EntityID: storeID.String(), Before: cur, After: in, IP: actor.IP})
	})
	return out, err
}

// ---- staff users --------------------------------------------------------------

func (s *Service) ListUsers(ctx context.Context, storeID uuid.UUID) ([]domain.User, error) {
	var out []domain.User
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.users.ListByStore(ctx, storeID)
		return err
	})
	return out, err
}

type UserInput struct {
	Username    string `json:"username"`
	Password    string `json:"password,omitempty"`
	DisplayName string `json:"display_name"`
	Phone       string `json:"phone"`
	Role        string `json:"role"`
	Locale      string `json:"locale"`
	IsActive    *bool  `json:"is_active"`
}

func (s *Service) CreateUser(ctx context.Context, actor Actor, storeID uuid.UUID, in UserInput) (*domain.User, error) {
	role := domain.Role(in.Role)
	if !role.Valid() || role == domain.RolePlatformAdmin {
		return nil, domain.ErrValidation.With("field", "role")
	}
	if strings.TrimSpace(in.Username) == "" {
		return nil, domain.ErrValidation.With("field", "username")
	}
	if err := auth.ValidatePasswordStrength(in.Password); err != nil {
		return nil, domain.ErrPasswordWeak
	}
	h, err := auth.HashPassword(in.Password)
	if err != nil {
		return nil, err
	}
	u := &domain.User{StoreID: &storeID, Username: strings.TrimSpace(in.Username), PasswordHash: h, DisplayName: orDefault(in.DisplayName, in.Username),
		Phone: in.Phone, Role: role, Locale: orDefault(in.Locale, "th"), IsActive: true}
	if in.IsActive != nil {
		u.IsActive = *in.IsActive
	}
	err = s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		if err := s.users.Create(ctx, u); err != nil {
			return err
		}
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: &actor.UserID, ActorName: actor.Name, Action: "user.create", Entity: "user", EntityID: u.ID.String(), After: u, IP: actor.IP})
	})
	return u, err
}

func (s *Service) UpdateUser(ctx context.Context, actor Actor, storeID, userID uuid.UUID, in UserInput) (*domain.User, error) {
	var out *domain.User
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		u, err := s.users.Get(ctx, userID)
		if err != nil {
			return err
		}
		if u.StoreID == nil || *u.StoreID != storeID {
			return domain.ErrNotFound
		}
		before := *u
		if in.DisplayName != "" {
			u.DisplayName = in.DisplayName
		}
		u.Phone = in.Phone
		if in.Role != "" {
			role := domain.Role(in.Role)
			if !role.Valid() || role == domain.RolePlatformAdmin {
				return domain.ErrValidation.With("field", "role")
			}
			u.Role = role
		}
		if in.Locale != "" {
			u.Locale = in.Locale
		}
		if in.IsActive != nil {
			u.IsActive = *in.IsActive
		}
		if err := s.users.Update(ctx, u); err != nil {
			return err
		}
		if in.Password != "" {
			if err := auth.ValidatePasswordStrength(in.Password); err != nil {
				return domain.ErrPasswordWeak
			}
			h, err := auth.HashPassword(in.Password)
			if err != nil {
				return err
			}
			if err := s.users.SetPassword(ctx, userID, h, true); err != nil {
				return err
			}
		}
		out = u
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: &actor.UserID, ActorName: actor.Name, Action: "user.update", Entity: "user", EntityID: u.ID.String(), Before: before, After: u, IP: actor.IP})
	})
	if err != nil && errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return out, err
}

func (s *Service) AuditLogs(ctx context.Context, storeID uuid.UUID, entity string, limit, offset int) ([]postgres.AuditRow, int64, error) {
	var rows []postgres.AuditRow
	var total int64
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		rows, total, err = s.audit.List(ctx, storeID, entity, limit, offset)
		return err
	})
	return rows, total, err
}

func orDefault(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}
