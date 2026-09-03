package app

import (
	"github.com/svdev/pos/internal/config"
	"github.com/svdev/pos/internal/repository/postgres"
	httptransport "github.com/svdev/pos/internal/transport/http"
	"github.com/svdev/pos/internal/usecase/reportuc"
)

// wireReports attaches the management reports / dashboard module.
func wireReports(db *postgres.DB, _ *config.Config, deps *httptransport.Deps) {
	deps.Report = reportuc.New(db)
}
