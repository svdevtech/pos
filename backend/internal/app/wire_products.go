package app

import (
	"github.com/svdev/pos/internal/config"
	"github.com/svdev/pos/internal/repository/postgres"
	httptransport "github.com/svdev/pos/internal/transport/http"
	"github.com/svdev/pos/internal/usecase/productuc"
)

// wireProducts attaches the catalogue module (categories, units, suppliers, products, barcodes, prices, labels).
func wireProducts(db *postgres.DB, _ *config.Config, deps *httptransport.Deps) {
	deps.Product = productuc.New(db)
}
