package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Principal is the authenticated identity carried in request context.
type Principal struct {
	UserID   uuid.UUID
	StoreID  uuid.UUID // Nil for platform admin (may be overridden with X-Store-Id)
	Role     string
	Username string
	Name     string
	Locale   string
	Kind     string // staff | member
	MemberID uuid.UUID
}

func (p Principal) IsPlatformAdmin() bool { return p.Role == "platform_admin" }
func (p Principal) IsStaff() bool         { return p.Kind == "staff" }
func (p Principal) IsMember() bool        { return p.Kind == "member" }

// HasRole reports whether the principal has at least one of the roles (platform admin always passes).
func (p Principal) HasRole(roles ...string) bool {
	if p.IsPlatformAdmin() {
		return true
	}
	for _, r := range roles {
		if p.Role == r {
			return true
		}
	}
	return false
}

type Claims struct {
	jwt.RegisteredClaims
	StoreID  string `json:"sid,omitempty"`
	Role     string `json:"role,omitempty"`
	Username string `json:"usr,omitempty"`
	Name     string `json:"name,omitempty"`
	Locale   string `json:"loc,omitempty"`
	Kind     string `json:"kind,omitempty"`
	MemberID string `json:"mid,omitempty"`
}

type JWT struct {
	secret    []byte
	accessTTL time.Duration
}

func NewJWT(secret string, accessTTL time.Duration) *JWT {
	return &JWT{secret: []byte(secret), accessTTL: accessTTL}
}

func (j *JWT) Issue(p Principal) (string, time.Time, error) {
	now := time.Now()
	exp := now.Add(j.accessTTL)
	c := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   p.UserID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
			Issuer:    "pos",
		},
		Role: p.Role, Username: p.Username, Name: p.Name, Locale: p.Locale, Kind: p.Kind,
	}
	if p.StoreID != uuid.Nil {
		c.StoreID = p.StoreID.String()
	}
	if p.MemberID != uuid.Nil {
		c.MemberID = p.MemberID.String()
	}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(j.secret)
	return tok, exp, err
}

var ErrInvalidToken = errors.New("invalid token")

func (j *JWT) Verify(tok string) (Principal, error) {
	var c Claims
	t, err := jwt.ParseWithClaims(tok, &c, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, ErrInvalidToken
		}
		return j.secret, nil
	}, jwt.WithIssuer("pos"), jwt.WithLeeway(30*time.Second))
	if err != nil || !t.Valid {
		return Principal{}, ErrInvalidToken
	}
	uid, err := uuid.Parse(c.Subject)
	if err != nil {
		return Principal{}, ErrInvalidToken
	}
	p := Principal{UserID: uid, Role: c.Role, Username: c.Username, Name: c.Name, Locale: c.Locale, Kind: c.Kind}
	if c.StoreID != "" {
		if p.StoreID, err = uuid.Parse(c.StoreID); err != nil {
			return Principal{}, ErrInvalidToken
		}
	}
	if c.MemberID != "" {
		if p.MemberID, err = uuid.Parse(c.MemberID); err != nil {
			return Principal{}, ErrInvalidToken
		}
	}
	if p.Kind == "" {
		p.Kind = "staff"
	}
	return p, nil
}

// HashToken hashes an opaque refresh token for storage.
func HashToken(tok string) string {
	h := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(h[:])
}
