package domain

import (
	"time"

	"github.com/google/uuid"
)

type Role string

const (
	RolePlatformAdmin Role = "platform_admin"
	RoleStoreOwner    Role = "store_owner"
	RoleManager       Role = "manager"
	RoleCashier       Role = "cashier"
	RoleViewer        Role = "viewer"
)

func (r Role) Valid() bool {
	switch r {
	case RolePlatformAdmin, RoleStoreOwner, RoleManager, RoleCashier, RoleViewer:
		return true
	}
	return false
}

type User struct {
	ID                uuid.UUID  `json:"id"`
	StoreID           *uuid.UUID `json:"store_id,omitempty"`
	Username          string     `json:"username"`
	PasswordHash      string     `json:"-"`
	DisplayName       string     `json:"display_name"`
	Phone             string     `json:"phone,omitempty"`
	Role              Role       `json:"role"`
	Locale            string     `json:"locale"`
	IsActive          bool       `json:"is_active"`
	MustResetPassword bool       `json:"must_reset_password"`
	LastLoginAt       *time.Time `json:"last_login_at,omitempty"`
	LegacyID          string     `json:"legacy_id,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type Store struct {
	ID            uuid.UUID `json:"id"`
	Code          string    `json:"code"`
	Name          string    `json:"name"`
	NameEN        string    `json:"name_en,omitempty"`
	Address       string    `json:"address,omitempty"`
	Phone         string    `json:"phone,omitempty"`
	TaxID         string    `json:"tax_id,omitempty"`
	ReceiptHeader string    `json:"receipt_header,omitempty"`
	ReceiptFooter string    `json:"receipt_footer,omitempty"`
	HasLogo       bool      `json:"has_logo"`
	DefaultLocale string    `json:"default_locale"`
	Timezone      string    `json:"timezone"`
	IsActive      bool      `json:"is_active"`
	LegacyID      string    `json:"legacy_id,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// StoreSettings is the free-form per-store configuration (validated keys documented in docs/API.md).
type StoreSettings map[string]any

type RefreshToken struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	TokenHash string
	ExpiresAt time.Time
	RevokedAt *time.Time
}

type AuditEntry struct {
	StoreID   *uuid.UUID
	ActorID   *uuid.UUID
	ActorName string
	Action    string
	Entity    string
	EntityID  string
	Before    any
	After     any
	IP        string
}
