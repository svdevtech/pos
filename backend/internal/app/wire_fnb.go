package app

import (
	"github.com/svdev/pos/internal/config"
	"github.com/svdev/pos/internal/repository/postgres"
	httptransport "github.com/svdev/pos/internal/transport/http"
	"github.com/svdev/pos/internal/usecase/fnbuc"
)

// wireFnb attaches the restaurant / café module (menu, recipes, orders, kitchen).
func wireFnb(db *postgres.DB, _ *config.Config, deps *httptransport.Deps) {
	deps.Fnb = fnbuc.New(db, postgres.StockRepo{})
}
