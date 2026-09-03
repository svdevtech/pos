package app

import (
	"github.com/svdev/pos/internal/config"
	"github.com/svdev/pos/internal/repository/postgres"
	httptransport "github.com/svdev/pos/internal/transport/http"
	"github.com/svdev/pos/internal/usecase/dividenduc"
)

// wireDividends attaches the annual dividend (ปันผล) module.
// Call from modules.go: wireDividends(db, cfg, &deps).
func wireDividends(db *postgres.DB, _ *config.Config, deps *httptransport.Deps) {
	deps.Dividend = dividenduc.New(db)
}
