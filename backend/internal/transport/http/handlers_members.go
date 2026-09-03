package httptransport

import (
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/usecase/memberuc"
)

// MemberService is implemented by memberuc.Service.
type MemberService interface {
	ListMembers(ctx context.Context, storeID uuid.UUID, f memberuc.ListFilter) ([]domain.MemberView, int64, error)
	SearchMembers(ctx context.Context, storeID uuid.UUID, q string, limit int) ([]domain.Member, error)
	CreateMember(ctx context.Context, actor memberuc.Actor, storeID uuid.UUID, in memberuc.MemberInput) (*domain.Member, error)
	GetMember(ctx context.Context, storeID, id uuid.UUID) (*memberuc.MemberDetail, error)
	UpdateMember(ctx context.Context, actor memberuc.Actor, storeID, id uuid.UUID, in memberuc.MemberPatch) (*domain.Member, error)
	SetMemberStatus(ctx context.Context, actor memberuc.Actor, storeID, id uuid.UUID, status string) (*domain.Member, error)
	ListShares(ctx context.Context, storeID, memberID uuid.UUID, limit, offset int) ([]domain.ShareTx, int64, error)
	PostShare(ctx context.Context, actor memberuc.Actor, storeID, memberID uuid.UUID, in memberuc.ShareInput) (*domain.ShareTx, error)
	CreateLinkCode(ctx context.Context, actor memberuc.Actor, storeID, memberID uuid.UUID) (*memberuc.LinkCodeResult, error)
	UnlinkLine(ctx context.Context, actor memberuc.Actor, storeID, memberID uuid.UUID) error
	MemberPurchases(ctx context.Context, storeID, id uuid.UUID, year int) (*memberuc.PurchaseSummary, error)
}

func queryBool(r *http.Request, name string) *bool {
	switch strings.ToLower(queryStr(r, name)) {
	case "true", "1", "yes":
		v := true
		return &v
	case "false", "0", "no":
		v := false
		return &v
	}
	return nil
}

// withID wraps a handler that needs the {id} path param.
func withID(fn func(w http.ResponseWriter, r *http.Request, id uuid.UUID)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := uuidParam(r, "id")
		if err != nil {
			fail(w, r, err)
			return
		}
		fn(w, r, id)
	}
}

func (s *Server) mountMembers(r chi.Router) {
	r.Route("/members", func(r chi.Router) {
		r.With(requireRole(rolesAll...)).Get("/", s.listMembers)
		r.With(requireRole(rolesSell...)).Get("/search", s.searchMembers)
		r.With(requireRole(rolesManage...)).Post("/", s.createMember)

		r.Route("/{id}", func(r chi.Router) {
			r.With(requireRole(rolesAll...)).Get("/", withID(s.getMember))
			r.With(requireRole(rolesManage...)).Patch("/", withID(s.updateMember))
			r.With(requireRole(rolesManage...)).Post("/status", withID(s.setMemberStatus))
			r.With(requireRole(rolesAll...)).Get("/shares", withID(s.listShares))
			r.With(requireRole(rolesManage...)).Post("/shares", withID(s.postShare))
			r.With(requireRole(rolesSell...)).Post("/link-code", withID(s.createLinkCode))
			r.With(requireRole(rolesManage...)).Delete("/line", withID(s.unlinkLine))
			r.With(requireRole(rolesAll...)).Get("/purchases", withID(s.memberPurchases))
		})
	})
}

func (s *Server) listMembers(w http.ResponseWriter, r *http.Request) {
	page, size := paging(r)
	f := memberuc.ListFilter{Q: queryStr(r, "q"), Status: queryStr(r, "status"), HasShares: queryBool(r, "has_shares"), Page: page, PageSize: size}
	items, total, err := s.Member.ListMembers(r.Context(), storeID(r), f)
	if err != nil {
		fail(w, r, err)
		return
	}
	ok(w, Page[domain.MemberView]{Items: items, Total: total, Page: page, PageSize: size})
}

func (s *Server) searchMembers(w http.ResponseWriter, r *http.Request) {
	out, err := s.Member.SearchMembers(r.Context(), storeID(r), queryStr(r, "q"), queryInt(r, "limit", 10))
	if err != nil {
		fail(w, r, err)
		return
	}
	ok(w, out)
}

func (s *Server) createMember(w http.ResponseWriter, r *http.Request) {
	var in memberuc.MemberInput
	if err := decode(r, &in); err != nil {
		fail(w, r, err)
		return
	}
	if strings.TrimSpace(in.Name) == "" {
		fail(w, r, validation("name", "required"))
		return
	}
	out, err := s.Member.CreateMember(r.Context(), actorOf(r), storeID(r), in)
	if err != nil {
		fail(w, r, err)
		return
	}
	created(w, out)
}

func (s *Server) getMember(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
	out, err := s.Member.GetMember(r.Context(), storeID(r), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	ok(w, out)
}

func (s *Server) updateMember(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
	var in memberuc.MemberPatch
	if err := decode(r, &in); err != nil {
		fail(w, r, err)
		return
	}
	out, err := s.Member.UpdateMember(r.Context(), actorOf(r), storeID(r), id, in)
	if err != nil {
		fail(w, r, err)
		return
	}
	ok(w, out)
}

func (s *Server) setMemberStatus(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
	var in struct {
		Status string `json:"status"`
	}
	if err := decode(r, &in); err != nil {
		fail(w, r, err)
		return
	}
	if in.Status == "" {
		fail(w, r, validation("status", "required"))
		return
	}
	out, err := s.Member.SetMemberStatus(r.Context(), actorOf(r), storeID(r), id, in.Status)
	if err != nil {
		fail(w, r, err)
		return
	}
	ok(w, out)
}

func (s *Server) listShares(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
	page, size := paging(r)
	items, total, err := s.Member.ListShares(r.Context(), storeID(r), id, size, (page-1)*size)
	if err != nil {
		fail(w, r, err)
		return
	}
	ok(w, Page[domain.ShareTx]{Items: items, Total: total, Page: page, PageSize: size})
}

func (s *Server) postShare(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
	var in memberuc.ShareInput
	if err := decode(r, &in); err != nil {
		fail(w, r, err)
		return
	}
	if in.Type == "" {
		fail(w, r, validation("type", "required"))
		return
	}
	out, err := s.Member.PostShare(r.Context(), actorOf(r), storeID(r), id, in)
	if err != nil {
		fail(w, r, err)
		return
	}
	created(w, out)
}

func (s *Server) createLinkCode(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
	out, err := s.Member.CreateLinkCode(r.Context(), actorOf(r), storeID(r), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	created(w, out)
}

func (s *Server) unlinkLine(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
	if err := s.Member.UnlinkLine(r.Context(), actorOf(r), storeID(r), id); err != nil {
		fail(w, r, err)
		return
	}
	noContent(w)
}

func (s *Server) memberPurchases(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
	out, err := s.Member.MemberPurchases(r.Context(), storeID(r), id, queryInt(r, "year", 0))
	if err != nil {
		fail(w, r, err)
		return
	}
	ok(w, out)
}
