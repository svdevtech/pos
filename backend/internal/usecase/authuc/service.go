// Package authuc implements staff authentication: login, token refresh, logout, password change.
package authuc

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/svdev/pos/internal/auth"
	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

type Service struct {
	db         *postgres.DB
	jwt        *auth.JWT
	refreshTTL time.Duration
	users      postgres.UserRepo
	stores     postgres.StoreRepo
	tokens     postgres.TokenRepo
	audit      postgres.AuditRepo
}

func New(db *postgres.DB, jwt *auth.JWT, refreshTTL time.Duration) *Service {
	return &Service{db: db, jwt: jwt, refreshTTL: refreshTTL}
}

type LoginInput struct {
	StoreCode string `json:"store_code"` // empty => platform admin login
	Username  string `json:"username"`
	Password  string `json:"password"`
	UserAgent string `json:"-"`
	IP        string `json:"-"`
}

type Session struct {
	AccessToken  string        `json:"access_token"`
	RefreshToken string        `json:"refresh_token"`
	ExpiresAt    time.Time     `json:"expires_at"`
	User         *domain.User  `json:"user"`
	Store        *domain.Store `json:"store,omitempty"`
}

func (s *Service) Login(ctx context.Context, in LoginInput) (*Session, error) {
	var sess *Session
	err := s.db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, _ postgresTx) error {
		var store *domain.Store
		var storeID *uuid.UUID
		if in.StoreCode != "" {
			st, err := s.stores.GetByCode(ctx, in.StoreCode)
			if err != nil {
				if errors.Is(err, domain.ErrNotFound) {
					return domain.ErrLoginFailed
				}
				return err
			}
			store = st
			storeID = &st.ID
		}
		u, err := s.users.FindByStoreAndUsername(ctx, storeID, in.Username)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				return domain.ErrLoginFailed
			}
			return err
		}
		if !auth.VerifyPassword(u.PasswordHash, in.Password) {
			return domain.ErrLoginFailed
		}
		if !u.IsActive {
			return domain.ErrUserDisabled
		}
		if store != nil && !store.IsActive {
			return domain.ErrStoreInactive
		}
		sess, err = s.issue(ctx, u, store, in.UserAgent, in.IP)
		if err != nil {
			return err
		}
		_ = s.users.TouchLogin(ctx, u.ID)
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: u.StoreID, ActorID: &u.ID, ActorName: u.DisplayName, Action: "auth.login", Entity: "user", EntityID: u.ID.String(), IP: in.IP})
	})
	return sess, err
}

func (s *Service) issue(ctx context.Context, u *domain.User, store *domain.Store, ua, ip string) (*Session, error) {
	p := auth.Principal{UserID: u.ID, Role: string(u.Role), Username: u.Username, Name: u.DisplayName, Locale: u.Locale, Kind: "staff"}
	if u.StoreID != nil {
		p.StoreID = *u.StoreID
	}
	access, exp, err := s.jwt.Issue(p)
	if err != nil {
		return nil, err
	}
	raw, err := auth.RandomToken(32)
	if err != nil {
		return nil, err
	}
	if err := s.tokens.Create(ctx, u.ID, auth.HashToken(raw), time.Now().Add(s.refreshTTL), ua, ip); err != nil {
		return nil, err
	}
	return &Session{AccessToken: access, RefreshToken: raw, ExpiresAt: exp, User: u, Store: store}, nil
}

func (s *Service) Refresh(ctx context.Context, refreshToken, ua, ip string) (*Session, error) {
	var sess *Session
	err := s.db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, _ postgresTx) error {
		uid, err := s.tokens.Consume(ctx, auth.HashToken(refreshToken))
		if err != nil {
			return err
		}
		u, err := s.users.Get(ctx, uid)
		if err != nil {
			return domain.ErrTokenInvalid
		}
		if !u.IsActive {
			return domain.ErrUserDisabled
		}
		var store *domain.Store
		if u.StoreID != nil {
			store, _ = s.stores.Get(ctx, *u.StoreID)
		}
		sess, err = s.issue(ctx, u, store, ua, ip)
		return err
	})
	return sess, err
}

func (s *Service) Logout(ctx context.Context, userID uuid.UUID) error {
	return s.db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, _ postgresTx) error {
		return s.tokens.RevokeAll(ctx, userID)
	})
}

type MeResult struct {
	User  *domain.User  `json:"user"`
	Store *domain.Store `json:"store,omitempty"`
}

func (s *Service) Me(ctx context.Context, userID uuid.UUID) (*MeResult, error) {
	var out MeResult
	err := s.db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, _ postgresTx) error {
		u, err := s.users.Get(ctx, userID)
		if err != nil {
			return domain.ErrTokenInvalid
		}
		out.User = u
		if u.StoreID != nil {
			out.Store, _ = s.stores.Get(ctx, *u.StoreID)
		}
		return nil
	})
	return &out, err
}

func (s *Service) ChangePassword(ctx context.Context, userID uuid.UUID, current, next string) error {
	if err := auth.ValidatePasswordStrength(next); err != nil {
		return domain.ErrPasswordWeak
	}
	return s.db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, _ postgresTx) error {
		u, err := s.users.Get(ctx, userID)
		if err != nil {
			return err
		}
		if !auth.VerifyPassword(u.PasswordHash, current) {
			return domain.ErrPasswordMismatch
		}
		h, err := auth.HashPassword(next)
		if err != nil {
			return err
		}
		if err := s.users.SetPassword(ctx, userID, h, false); err != nil {
			return err
		}
		_ = s.tokens.RevokeAll(ctx, userID)
		return s.audit.Write(ctx, domain.AuditEntry{StoreID: u.StoreID, ActorID: &u.ID, ActorName: u.DisplayName, Action: "auth.password_change", Entity: "user", EntityID: u.ID.String()})
	})
}

// UpdateLocale persists the user's preferred UI language.
func (s *Service) UpdateLocale(ctx context.Context, userID uuid.UUID, locale string) error {
	if locale != "th" && locale != "en" {
		return domain.ErrValidation.With("field", "locale")
	}
	return s.db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, tx postgresTx) error {
		_, err := tx.Exec(ctx, `UPDATE users SET locale=$2 WHERE id=$1`, userID, locale)
		return err
	})
}
