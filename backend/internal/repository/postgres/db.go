// Package postgres provides the pgx connection pool, migrations, and tenant-scoped transactions.
package postgres

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/golang-migrate/migrate/v4"
	migratepg "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"

	"github.com/svdev/pos/migrations"
)

type DB struct {
	Pool *pgxpool.Pool
}

func Open(ctx context.Context, url string) (*DB, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	cfg.MaxConns = 20
	cfg.MinConns = 2
	cfg.MaxConnLifetime = time.Hour
	cfg.HealthCheckPeriod = 30 * time.Second
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	pctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return &DB{Pool: pool}, nil
}

func (d *DB) Close() { d.Pool.Close() }

// Migrate applies all embedded up-migrations.
func Migrate(url string, log *slog.Logger) error {
	src, err := iofs.New(migrations.FS, ".")
	if err != nil {
		return fmt.Errorf("migration source: %w", err)
	}
	sqlDB := stdlib.OpenDB(*mustParse(url))
	defer sqlDB.Close()
	driver, err := migratepg.WithInstance(sqlDB, &migratepg.Config{})
	if err != nil {
		return fmt.Errorf("migration driver: %w", err)
	}
	m, err := migrate.NewWithInstance("iofs", src, "postgres", driver)
	if err != nil {
		return fmt.Errorf("migrate init: %w", err)
	}
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrate up: %w", err)
	}
	v, dirty, _ := m.Version()
	log.Info("migrations applied", "version", v, "dirty", dirty)
	return nil
}

func mustParse(url string) *pgx.ConnConfig {
	c, err := pgx.ParseConfig(url)
	if err != nil {
		panic(err)
	}
	return c
}

// ---------------------------------------------------------------------------
// Tenant scoping
// ---------------------------------------------------------------------------

// Scope describes how a transaction is scoped for row-level security.
type Scope struct {
	StoreID uuid.UUID // zero => no store
	Bypass  bool      // platform admin / migration
	// Snapshot opens the transaction as REPEATABLE READ, so a long export sees one consistent
	// picture of every table it reads.
	Snapshot bool
}

type txKey struct{}

// WithTx runs fn inside a transaction whose RLS GUCs are set from scope.
// Nested calls reuse the outer transaction.
func (d *DB) WithTx(ctx context.Context, scope Scope, fn func(ctx context.Context, tx pgx.Tx) error) error {
	if tx, ok := ctx.Value(txKey{}).(pgx.Tx); ok {
		return fn(ctx, tx)
	}
	var tx pgx.Tx
	var err error
	if scope.Snapshot {
		tx, err = d.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	} else {
		tx, err = d.Pool.Begin(ctx)
	}
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := applyScope(ctx, tx, scope); err != nil {
		return err
	}
	ctx = context.WithValue(ctx, txKey{}, tx)
	if err := fn(ctx, tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func applyScope(ctx context.Context, tx pgx.Tx, scope Scope) error {
	if scope.Bypass {
		if _, err := tx.Exec(ctx, "SELECT set_config('app.bypass_rls', 'on', true)"); err != nil {
			return fmt.Errorf("set bypass: %w", err)
		}
	}
	if scope.StoreID != uuid.Nil {
		if _, err := tx.Exec(ctx, "SELECT set_config('app.current_store_id', $1, true)", scope.StoreID.String()); err != nil {
			return fmt.Errorf("set store: %w", err)
		}
	}
	return nil
}

// TxFrom returns the transaction stored in ctx (if any).
func TxFrom(ctx context.Context) (pgx.Tx, bool) {
	tx, ok := ctx.Value(txKey{}).(pgx.Tx)
	return tx, ok
}

// Q returns the transaction from ctx, or panics: repositories must always run inside WithTx.
func Q(ctx context.Context) pgx.Tx {
	tx, ok := TxFrom(ctx)
	if !ok {
		panic("postgres: no transaction in context (wrap the call in DB.WithTx)")
	}
	return tx
}
