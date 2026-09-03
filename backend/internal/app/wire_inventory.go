package app

import (
	"github.com/svdev/pos/internal/config"
	"github.com/svdev/pos/internal/repository/postgres"
	httptransport "github.com/svdev/pos/internal/transport/http"
	"github.com/svdev/pos/internal/usecase/inventoryuc"
)

// wireInventory attaches the stock module (movements, receipts, adjustments, stock takes, valuation).
func wireInventory(db *postgres.DB, _ *config.Config, deps *httptransport.Deps) {
	deps.Inventory = inventoryuc.New(db)
}
