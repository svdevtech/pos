package app

import (
	"context"
	"log/slog"

	"github.com/svdev/pos/internal/config"
	"github.com/svdev/pos/internal/repository/postgres"
	httptransport "github.com/svdev/pos/internal/transport/http"
)

// wireModules attaches the business modules (products, members, sales, ...) to the HTTP deps.
func wireModules(_ context.Context, cfg *config.Config, _ *slog.Logger, db *postgres.DB, deps httptransport.Deps) httptransport.Deps {
	wireProducts(db, cfg, &deps)
	wireInventory(db, cfg, &deps)
	wireMembers(db, cfg, deps.JWT, &deps)
	wireSales(db, cfg, &deps)
	wireReports(db, cfg, &deps)
	wireDividends(db, cfg, &deps)
	wireAI(db, cfg, &deps)
	return deps
}
