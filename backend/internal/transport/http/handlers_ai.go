package httptransport

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/svdev/pos/internal/usecase/aiuc"
)

// AIService is implemented by aiuc.Service (T-RAG natural-language → SQL).
type AIService interface {
	Enabled() bool
	Status(ctx context.Context) map[string]any
	Ask(ctx context.Context, storeID, userID uuid.UUID, question string, explain bool) (*aiuc.Result, error)
	History(ctx context.Context, storeID uuid.UUID, limit int) ([]aiuc.HistoryRow, error)
}

func (s *Server) mountAI(r chi.Router) {
	r.Route("/ai", func(r chi.Router) {
		r.Use(requireRole(rolesManage...))
		r.Get("/status", func(w http.ResponseWriter, r *http.Request) {
			ok(w, s.AI.Status(r.Context()))
		})
		r.Post("/query", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Question string `json:"question"`
				Explain  bool   `json:"explain"`
			}
			if err := decode(r, &in); err != nil {
				fail(w, r, err)
				return
			}
			out, err := s.AI.Ask(r.Context(), storeID(r), PrincipalFrom(r.Context()).UserID, in.Question, in.Explain)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.Get("/history", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.AI.History(r.Context(), storeID(r), queryInt(r, "limit", 50))
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
	})
}
