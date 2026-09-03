// Package app is the composition root: it builds repositories, use cases and the HTTP server.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/svdev/pos/internal/auth"
	"github.com/svdev/pos/internal/config"
	"github.com/svdev/pos/internal/repository/postgres"
	httptransport "github.com/svdev/pos/internal/transport/http"
	"github.com/svdev/pos/internal/usecase/authuc"
	"github.com/svdev/pos/internal/usecase/storeuc"
)

type App struct {
	DB     *postgres.DB
	Server *httptransport.Server
	Deps   httptransport.Deps
}

func New(ctx context.Context, cfg *config.Config, log *slog.Logger, version string) (*App, error) {
	if cfg.AutoMigrate {
		if err := postgres.Migrate(cfg.DatabaseURL, log); err != nil {
			return nil, fmt.Errorf("migrate: %w", err)
		}
	}
	db, err := postgres.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	jwt := auth.NewJWT(cfg.JWTSecret, cfg.AccessTTL)
	storeSvc := storeuc.New(db)

	deps := httptransport.Deps{
		Cfg:   cfg,
		DB:    db,
		JWT:   jwt,
		Log:   log,
		Auth:  authuc.New(db, jwt, cfg.RefreshTTL),
		Store: storeSvc,
		Admin: storeSvc,
	}
	deps = wireModules(ctx, cfg, log, db, deps)
	srv := httptransport.New(deps, version)
	return &App{DB: db, Server: srv, Deps: deps}, nil
}

func (a *App) Handler() http.Handler { return a.Server.Handler() }
func (a *App) Close()                { a.DB.Close() }
