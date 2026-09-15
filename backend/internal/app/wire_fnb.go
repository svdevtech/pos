package app

import (
	"github.com/svdev/pos/internal/config"
	"github.com/svdev/pos/internal/repository/postgres"
	httptransport "github.com/svdev/pos/internal/transport/http"
	"github.com/svdev/pos/internal/usecase/fnbuc"
	"github.com/svdev/pos/internal/usecase/salesuc"
)

// wireFnb attaches the restaurant / café module (menu, recipes, orders, kitchen, checkout). A
// bill for an order is posted through the sales module, so it gets its own instance of it.
func wireFnb(db *postgres.DB, _ *config.Config, deps *httptransport.Deps) {
	deps.Fnb = fnbuc.New(db, postgres.StockRepo{}, salesuc.New(db, postgres.StockRepo{}))
}
