# POS สหกรณ์ (multi-tenant web POS) — project guide for Claude Code

Replacement for the legacy MS Access POS "pstorenusoft" of a Thai community co-op store. One deployment serves many stores
(store chosen at login). Bilingual UI (Thai default / English).

## Layout

- `backend/` Go 1.25 API — Clean Architecture (`internal/domain` → `internal/usecase/*uc` → `internal/repository/postgres` → PostgreSQL 16), chi router in `internal/transport/http`, pgx/v5, shopspring/decimal. Migrations embedded from `backend/migrations` (golang-migrate). Commands: `cmd/api`, `cmd/seed`, `cmd/migrate-legacy`.
- `frontend/` Next.js 14 App Router + TypeScript + MUI v5 (glass theme) + TanStack Query + next-intl (`i18n/messages/{th,en}.json`). Route groups `(auth)`, `(pos)`, `(dashboard)`, `(liff)`, `admin`. Browser calls `/api/v1/*`; `next.config.mjs` rewrites to `BACKEND_INTERNAL_URL`.
- `tools/legacy-extract/extract.ps1` Windows-only extractor (Access ODBC → JSONL + manifest). `legacy-dump/` (git-ignored) holds the dump.
- `deploy/` docker-compose stack + `tee-dev/{install,deploy,backup}.sh` for the Ubuntu test server.
- `docs/` CONVENTIONS.md (read before adding a module), LEGACY_DATABASE_REFERENCE.md (legacy schema, column by column), MIGRATION.md, DEPLOY.md, DIVIDEND_MATH.md.

## Commands

```bash
# backend (needs Postgres: docker run -d --name pos-pg -e POSTGRES_USER=pos -e POSTGRES_PASSWORD=pos -e POSTGRES_DB=pos -p 54322:5432 postgres:16-alpine)
cd backend && cp .env.example .env
go run ./cmd/seed -store BBR -store-name "ร้านทดสอบ" -owner owner -owner-password Owner12345   # migrations + admin + store
go run ./cmd/api                                  # http://localhost:8090  (GET /health)
go build ./... && go vet ./... && go test ./...
go run ./cmd/migrate-legacy -dir ../legacy-dump -store BBR -dry-run

# frontend
cd frontend && npm install && npm run dev         # http://localhost:3010 (proxies /api to :8090)
npm run i18n:check && npx tsc --noEmit && npm run lint && npm run build
```

## Rules that matter

- Every DB access runs inside `db.WithTx(ctx, postgres.Scope{StoreID: id}, ...)`; RLS is FORCEd on all tenant tables and keyed by the `app.current_store_id` GUC. Platform-admin/migration paths use `Scope{Bypass: true}`.
- Errors are `domain.Err*` codes localized by `internal/i18n` (add th **and** en; a test enforces parity). Frontend strings live only in `i18n/messages/*.json` (`npm run i18n:check` enforces parity).
- Money is `decimal` (NUMERIC 14,2), quantities NUMERIC 12,3; API serializes decimals as strings.
- Document numbers keep the legacy Buddhist-year format `N6602-05115` (`postgres.NextDocNo`).
- Do not touch `database.mdb`; the legacy dump is regenerated with `extract.ps1` when the file changes (sha256 in `manifest.json`).
- Dividend math must reproduce the BE 2565 legacy statements exactly (`internal/usecase/dividenduc/engine_test.go`).

## Environment notes

- Dev machine: Windows, Go 1.25, Node 24, Docker Desktop. Test server: `tee-dev` (Docker 29, ports 3010/8090/54322 reserved for this project).
- LINE LIFF runs in mock mode (`LINE_MOCK=true`, token `mock:<lineUserId>:<name>`) until real channel credentials exist.
- AI (T-LLM gateway) is feature-flagged off (`AI_ENABLED=false`) until `192.168.1.116:9001` is reachable/whitelisted from tee-dev.
