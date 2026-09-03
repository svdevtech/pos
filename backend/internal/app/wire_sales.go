package app

import (
	"github.com/svdev/pos/internal/config"
	"github.com/svdev/pos/internal/repository/postgres"
	httptransport "github.com/svdev/pos/internal/transport/http"
	"github.com/svdev/pos/internal/usecase/aruc"
	"github.com/svdev/pos/internal/usecase/expenseuc"
	"github.com/svdev/pos/internal/usecase/promouc"
	"github.com/svdev/pos/internal/usecase/salesuc"
)

// wireSales attaches the cashier (sales/shifts/held bills), AR, expenses and promotions modules.
func wireSales(db *postgres.DB, _ *config.Config, deps *httptransport.Deps) {
	deps.Sales = salesuc.New(db, postgres.StockRepo{})
	deps.AR = aruc.New(db)
	deps.Expense = expenseuc.New(db)
	deps.Promo = promouc.New(db)
}
