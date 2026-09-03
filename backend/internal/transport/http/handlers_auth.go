package httptransport

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/svdev/pos/internal/usecase/authuc"
)

type AuthService interface {
	Login(ctx context.Context, in authuc.LoginInput) (*authuc.Session, error)
	Refresh(ctx context.Context, refreshToken, ua, ip string) (*authuc.Session, error)
	Logout(ctx context.Context, userID uuid.UUID) error
	Me(ctx context.Context, userID uuid.UUID) (*authuc.MeResult, error)
	ChangePassword(ctx context.Context, userID uuid.UUID, current, next string) error
	UpdateLocale(ctx context.Context, userID uuid.UUID, locale string) error
}

func (s *Server) mountAuth(r chi.Router) {
	r.Route("/auth", func(r chi.Router) {
		r.With(s.authRL.middleware).Post("/login", s.login)
		r.With(s.authRL.middleware).Post("/refresh", s.refresh)
		r.With(s.authRL.middleware).Post("/line/verify", s.liffVerify) // member login (LIFF)
		r.With(s.authRL.middleware).Post("/line/link", s.liffLink)     // link LINE account to a member (code / phone)
		r.Group(func(r chi.Router) {
			r.Use(s.authenticate)
			r.Post("/logout", s.logout)
			r.Get("/me", s.me)
			r.Post("/password/change", s.changePassword)
			r.Put("/locale", s.updateLocale)
		})
	})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in authuc.LoginInput
	if err := decode(r, &in); err != nil {
		fail(w, r, err)
		return
	}
	if in.Username == "" || in.Password == "" {
		fail(w, r, validation("username", "required"))
		return
	}
	in.UserAgent = r.UserAgent()
	in.IP = r.RemoteAddr
	sess, err := s.Auth.Login(r.Context(), in)
	if err != nil {
		fail(w, r, err)
		return
	}
	ok(w, sess)
}

func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := decode(r, &in); err != nil {
		fail(w, r, err)
		return
	}
	sess, err := s.Auth.Refresh(r.Context(), in.RefreshToken, r.UserAgent(), r.RemoteAddr)
	if err != nil {
		fail(w, r, err)
		return
	}
	ok(w, sess)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if err := s.Auth.Logout(r.Context(), PrincipalFrom(r.Context()).UserID); err != nil {
		fail(w, r, err)
		return
	}
	noContent(w)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	p := PrincipalFrom(r.Context())
	if p.IsMember() {
		me, err := s.Liff.Me(r.Context(), p.StoreID, p.MemberID)
		if err != nil {
			fail(w, r, err)
			return
		}
		ok(w, me)
		return
	}
	me, err := s.Auth.Me(r.Context(), p.UserID)
	if err != nil {
		fail(w, r, err)
		return
	}
	ok(w, me)
}

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := decode(r, &in); err != nil {
		fail(w, r, err)
		return
	}
	if err := s.Auth.ChangePassword(r.Context(), PrincipalFrom(r.Context()).UserID, in.CurrentPassword, in.NewPassword); err != nil {
		fail(w, r, err)
		return
	}
	noContent(w)
}

func (s *Server) updateLocale(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Locale string `json:"locale"`
	}
	if err := decode(r, &in); err != nil {
		fail(w, r, err)
		return
	}
	if err := s.Auth.UpdateLocale(r.Context(), PrincipalFrom(r.Context()).UserID, in.Locale); err != nil {
		fail(w, r, err)
		return
	}
	noContent(w)
}
