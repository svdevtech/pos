package httptransport

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/svdev/pos/internal/auth"
	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

type ctxKey int

const (
	principalKey ctxKey = iota
	scopeKey
)

// PrincipalFrom returns the authenticated principal (zero value when anonymous).
func PrincipalFrom(ctx context.Context) auth.Principal {
	p, _ := ctx.Value(principalKey).(auth.Principal)
	return p
}

// ScopeFrom returns the tenant scope derived from the principal (+ X-Store-Id for platform admins).
func ScopeFrom(ctx context.Context) postgres.Scope {
	s, _ := ctx.Value(scopeKey).(postgres.Scope)
	return s
}

// authenticate parses the bearer token and stores principal + scope in context.
func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			fail(w, r, domain.ErrUnauthorized)
			return
		}
		p, err := s.jwt.Verify(strings.TrimSpace(h[7:]))
		if err != nil {
			fail(w, r, domain.ErrTokenInvalid)
			return
		}
		scope := postgres.Scope{StoreID: p.StoreID}
		if p.IsPlatformAdmin() {
			scope.Bypass = true
			if sid := r.Header.Get("X-Store-Id"); sid != "" {
				id, err := uuid.Parse(sid)
				if err != nil {
					fail(w, r, domain.ErrBadRequest.With("reason", "invalid X-Store-Id"))
					return
				}
				scope.StoreID = id
				p.StoreID = id
			}
		}
		ctx := context.WithValue(r.Context(), principalKey, p)
		ctx = context.WithValue(ctx, scopeKey, scope)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// requireStore rejects requests that have no tenant scope (platform admin without X-Store-Id).
func requireStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if ScopeFrom(r.Context()).StoreID == uuid.Nil {
			fail(w, r, domain.ErrStoreRequired)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// requireRole allows only staff principals with one of the given roles (platform admin always allowed).
func requireRole(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p := PrincipalFrom(r.Context())
			if !p.IsStaff() || !p.HasRole(roles...) {
				fail(w, r, domain.ErrForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func requireMember(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !PrincipalFrom(r.Context()).IsMember() {
			fail(w, r, domain.ErrForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Role sets used across routes.
var (
	rolesAll    = []string{"store_owner", "manager", "cashier", "viewer"}
	rolesSell   = []string{"store_owner", "manager", "cashier"}
	rolesManage = []string{"store_owner", "manager"}
	rolesOwner  = []string{"store_owner"}
)

// ---------------------------------------------------------------------------
// Simple fixed-window rate limiter for auth endpoints (per client IP).
// ---------------------------------------------------------------------------
type rateLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	hits   map[string]*bucket
}

type bucket struct {
	count int
	reset time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	rl := &rateLimiter{limit: limit, window: window, hits: map[string]*bucket{}}
	go func() {
		for range time.Tick(window) {
			rl.mu.Lock()
			now := time.Now()
			for k, b := range rl.hits {
				if now.After(b.reset) {
					delete(rl.hits, k)
				}
			}
			rl.mu.Unlock()
		}
	}()
	return rl
}

func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	b, ok := rl.hits[key]
	if !ok || now.After(b.reset) {
		rl.hits[key] = &bucket{count: 1, reset: now.Add(rl.window)}
		return true
	}
	b.count++
	return b.count <= rl.limit
}

func (rl *rateLimiter) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.Header.Get("X-Forwarded-For")
		if ip == "" {
			ip = r.RemoteAddr
		}
		if i := strings.Index(ip, ","); i > 0 {
			ip = ip[:i]
		}
		if !rl.allow(strings.TrimSpace(ip)) {
			fail(w, r, domain.ErrRateLimited)
			return
		}
		next.ServeHTTP(w, r)
	})
}
