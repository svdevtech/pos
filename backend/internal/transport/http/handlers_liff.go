package httptransport

import (
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/svdev/pos/internal/usecase/memberuc"
)

// LiffService is implemented by memberuc.Service (member self-service via LINE LIFF).
// Me returns *memberuc.LiffMe typed as any because handlers_auth.go shares it for member principals.
type LiffService interface {
	Me(ctx context.Context, storeID, memberID uuid.UUID) (any, error)
	Verify(ctx context.Context, in memberuc.LiffAuthInput) (*memberuc.LiffAuthResult, error)
	Link(ctx context.Context, in memberuc.LiffAuthInput) (*memberuc.LiffAuthResult, error)
	LiffPurchases(ctx context.Context, storeID, memberID uuid.UUID, year int) (*memberuc.PurchaseSummary, error)
	LiffDividend(ctx context.Context, storeID, memberID uuid.UUID) (*memberuc.LiffDividend, error)
	LiffStore(ctx context.Context, storeID uuid.UUID) (*memberuc.LiffStoreInfo, error)
}

// mountLiff: authenticated member routes (the router group already applies authenticate + requireStore).
func (s *Server) mountLiff(r chi.Router) {
	r.Route("/liff", func(r chi.Router) {
		r.Use(requireMember)
		r.Get("/me", func(w http.ResponseWriter, r *http.Request) {
			p := PrincipalFrom(r.Context())
			out, err := s.Liff.Me(r.Context(), p.StoreID, p.MemberID)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.Get("/purchases", func(w http.ResponseWriter, r *http.Request) {
			p := PrincipalFrom(r.Context())
			out, err := s.Liff.LiffPurchases(r.Context(), p.StoreID, p.MemberID, queryInt(r, "year", 0))
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.Get("/dividend", func(w http.ResponseWriter, r *http.Request) {
			p := PrincipalFrom(r.Context())
			out, err := s.Liff.LiffDividend(r.Context(), p.StoreID, p.MemberID)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.Get("/store", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Liff.LiffStore(r.Context(), PrincipalFrom(r.Context()).StoreID)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
	})
}

func decodeLiffAuth(w http.ResponseWriter, r *http.Request) (memberuc.LiffAuthInput, bool) {
	var in memberuc.LiffAuthInput
	if err := decode(r, &in); err != nil {
		fail(w, r, err)
		return in, false
	}
	if strings.TrimSpace(in.IDToken) == "" {
		fail(w, r, validation("id_token", "required"))
		return in, false
	}
	if strings.TrimSpace(in.StoreCode) == "" {
		fail(w, r, validation("store_code", "required"))
		return in, false
	}
	in.IP = r.RemoteAddr
	return in, true
}

// liffVerify: POST /api/v1/auth/line/verify (unauthenticated, rate-limited; routed in handlers_auth.go).
// Body {id_token, store_code, link_code?, phone?}. Returns linked:true + access_token when the LINE account
// is attached to a member; otherwise linked:false with the LINE profile and store card (HTTP 200).
// When link_code or phone is supplied and the account is not yet linked, the link is performed in the same call.
func (s *Server) liffVerify(w http.ResponseWriter, r *http.Request) {
	in, okIn := decodeLiffAuth(w, r)
	if !okIn {
		return
	}
	out, err := s.Liff.Verify(r.Context(), in)
	if err != nil {
		fail(w, r, err)
		return
	}
	ok(w, out)
}

// liffLink: unauthenticated link endpoint. Body {id_token, store_code, link_code?, phone?}.
// Not routed by this file (mountLiff sits inside the authenticated group); the lead can attach it with
// r.With(s.authRL.middleware).Post("/line/link", s.liffLink) next to /line/verify in handlers_auth.go.
func (s *Server) liffLink(w http.ResponseWriter, r *http.Request) {
	in, okIn := decodeLiffAuth(w, r)
	if !okIn {
		return
	}
	if strings.TrimSpace(in.LinkCode) == "" && strings.TrimSpace(in.Phone) == "" {
		fail(w, r, validation("link_code", "link_code or phone required"))
		return
	}
	out, err := s.Liff.Link(r.Context(), in)
	if err != nil {
		fail(w, r, err)
		return
	}
	ok(w, out)
}
