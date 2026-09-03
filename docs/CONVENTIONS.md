# Engineering conventions (read before adding a module)

## Backend (Go, `backend/`)

Layers (Clean Architecture, dependency direction →):
`internal/transport/http` (chi handlers, DTO decode/encode) → `internal/usecase/<module>uc` (business rules, transactions) → `internal/repository/postgres` (SQL via pgx) → PostgreSQL. `internal/domain` holds entities + `domain.Error` codes used by every layer.

Rules:
1. **Every DB access runs inside `db.WithTx(ctx, postgres.Scope{StoreID: id}, fn)`** (see `internal/repository/postgres/db.go`). Repositories obtain the tx via `postgres.Q(ctx)`. Never use `db.Pool` directly from use cases. Platform-admin / migration paths use `Scope{Bypass: true}`. RLS is enforced in the DB; repositories still filter by `store_id`.
2. Repository types are stateless structs (`type ProductRepo struct{}`) with methods `(ProductRepo) Get(ctx, ...)`. Put SQL in `internal/repository/postgres/<module>.go`. Scan helpers per entity. NUMERIC columns scan into `string` then `dec(s)` → `decimal.Decimal`, or scan directly into `decimal.Decimal` via `pgtype.Numeric` – prefer scanning to `string` (`::text`) + `dec()` for simplicity.
3. Money/qty use `github.com/shopspring/decimal`. Money rounds to 2 dp (`RoundBank`? no → use `Round(2)` half-up to match legacy). Quantities 3 dp.
4. Errors: return `domain.ErrXxx` values (optionally `.With("param", v)` or `.Wrap(err)`); the HTTP layer localizes by code (`internal/i18n`). **Add a new code to both `th` and `en` maps** in `internal/i18n/i18n.go` and the var list in `internal/domain/errors.go`; the parity test enforces it.
5. Handlers live in `internal/transport/http/handlers_<module>.go` which **declares the `<Module>Service` interface** the handler needs and `func (s *Server) mount<Module>(r chi.Router)`. Use helpers in `respond.go`: `decode`, `ok`, `created`, `noContent`, `fail`, `uuidParam`, `paging`, `Page[T]`; role guards `requireRole(rolesSell...)` etc. from `middleware.go`; `storeID(r)` and `actorOf(r)` from `handlers_store.go`.
6. Use-case constructors: `func New(db *postgres.DB, ...) *Service`; write an `Actor` (user id, name, ip) for audit; write audit rows via `postgres.AuditRepo` for every mutation of business documents (sale, cancel, receipt, adjustment, member share, dividend transitions, settings).
7. Wire the module in `internal/app/wire_<module>.go`: `func wire<Module>(db *postgres.DB, cfg *config.Config, deps *httptransport.Deps)` and call it from `internal/app/modules.go`.
8. Document numbers: `postgres.NextDocNo(ctx, storeID, docType, at)` (in `sequences.go`) formats `<PREFIX><BE yy><MM>-<seq 5>` with prefixes: sale `N`, receipt `OD`, return `RT`, adjustment `ADJ`, stocktake `ST`, AR payment `RC`, expense `EX`.
9. Timestamps: `timestamptz`; the API receives/returns RFC3339. Business dates for reports use store timezone (`Asia/Bangkok`).
10. Tests: table-driven unit tests for pure logic (`_test.go` next to code). DB tests (optional) use `TEST_DATABASE_URL` and skip when unset.
11. JSON field names: `snake_case`. IDs are UUID strings. Lists return `Page[T]{items,total,page,page_size}` for paginated endpoints, plain arrays for small lookups.
12. No global state; no `init()` side effects; `log/slog` for logging.

## Frontend (Next.js 14 App Router, `frontend/`)

- TypeScript strict, MUI v5, `next-intl` (cookie locale, default `th`), TanStack Query v5, zod + react-hook-form.
- API client `lib/api/client.ts`: base URL `/api/v1` (Next rewrites proxy to backend), attaches `Authorization: Bearer`, `X-Locale`, auto-refreshes on 401 using the refresh token, throws `ApiError{code,message,fields}` from the error envelope.
- All user-visible strings via `useTranslations('<namespace>')`; keys live in `i18n/messages/th.json` and `en.json` (identical key sets; test enforces).
- Route groups: `(auth)`, `(pos)`, `(dashboard)`, `(liff)`. Glass components in `components/glass/`.
- Money formatting via `lib/format.ts` (`formatMoney`, `formatQty`, `formatDate` with th-TH/en-US).

## API error envelope

```json
{"error":{"code":"STOCK_INSUFFICIENT","message":"สต็อกสินค้า X ไม่พอ (คงเหลือ 2)","params":{"name":"X","stock":"2"},"fields":{"qty":"required"}}}
```
