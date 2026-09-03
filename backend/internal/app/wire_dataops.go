package app

import (
	"log/slog"

	"github.com/svdev/pos/internal/config"
	"github.com/svdev/pos/internal/repository/postgres"
	httptransport "github.com/svdev/pos/internal/transport/http"
	"github.com/svdev/pos/internal/usecase/dataopsuc"
)

// wireDataOps attaches backup / restore / legacy-import, which keep their files under DATA_DIR.
func wireDataOps(db *postgres.DB, cfg *config.Config, log *slog.Logger, deps *httptransport.Deps) {
	deps.DataOps = dataopsuc.New(db, cfg.DataDir, log)
}
