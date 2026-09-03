package app

import (
	"github.com/svdev/pos/internal/auth"
	"github.com/svdev/pos/internal/config"
	"github.com/svdev/pos/internal/repository/postgres"
	httptransport "github.com/svdev/pos/internal/transport/http"
	"github.com/svdev/pos/internal/usecase/memberuc"
)

// wireMembers attaches the members / share ledger / LIFF module.
// Call from modules.go: wireMembers(db, cfg, deps.JWT, &deps).
func wireMembers(db *postgres.DB, cfg *config.Config, jwt *auth.JWT, deps *httptransport.Deps) {
	svc := memberuc.New(db, jwt, auth.NewLineVerifier(cfg.LineMock, cfg.LineChannelID))
	deps.Member = svc
	deps.Liff = svc
}
