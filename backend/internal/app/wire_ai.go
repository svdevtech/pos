package app

import (
	"github.com/svdev/pos/internal/ai/tllm"
	"github.com/svdev/pos/internal/config"
	"github.com/svdev/pos/internal/repository/postgres"
	httptransport "github.com/svdev/pos/internal/transport/http"
	"github.com/svdev/pos/internal/usecase/aiuc"
)

// wireAI attaches the T-RAG natural-language query service (feature-flagged by AI_ENABLED).
func wireAI(db *postgres.DB, cfg *config.Config, deps *httptransport.Deps) {
	var client *tllm.Client
	if cfg.AIEnabled {
		client = tllm.New(cfg.TLLMBaseURL, cfg.TLLMModel, cfg.TLLMAdminToken)
	}
	deps.AI = aiuc.New(db, client, cfg.AIEnabled)
}
