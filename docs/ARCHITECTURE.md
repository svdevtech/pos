# สถาปัตยกรรมระบบ (Architecture)

```
 browser / LINE app                    Next.js 14 (web:3010)                 Go API (api:8090)                 PostgreSQL 16
 ┌──────────────┐   /api/v1/* rewrite  ┌────────────────────┐  JSON/JWT   ┌─────────────────────────┐  pgx   ┌──────────────┐
 │ (pos) cashier│ ───────────────────▶ │ App Router, MUI,   │ ──────────▶ │ chi → usecase → repo    │ ─────▶ │ RLS per store│
 │ (dashboard)  │                      │ next-intl th/en,   │             │ WithTx(Scope{StoreID})  │        │ 40+ tables   │
 │ (liff) member│                      │ TanStack Query     │             │ i18n error codes        │        └──────────────┘
 └──────────────┘                      └────────────────────┘             │ tllm client (AI, flag)  │──▶ T-LLM gateway :9001
                                                                          └─────────────────────────┘
                                                                                     ▲
                                              tools/legacy-extract/extract.ps1 ──▶ cmd/migrate-legacy (JSONL → PostgreSQL)
```

## หลายร้านใน 1 ระบบ (multi-tenancy)

- ตาราง `stores` = ผู้เช่า (tenant); ทุกตารางธุรกิจมี `store_id` และเปิด **Row-Level Security แบบ FORCE** ด้วย policy `store_id = app_current_store_id()`
- API ตั้งค่า `SET LOCAL app.current_store_id` ในทุก transaction (`postgres.DB.WithTx`) จาก JWT claim `sid`; ผู้ดูแลระบบกลาง (`platform_admin`) ใช้ `app.bypass_rls='on'` และเลือกร้านผ่าน header `X-Store-Id`
- เลขที่เอกสารแยกต่อร้านต่องวด (`doc_sequences`) รูปแบบเดิม `N6602-05115` (ปี พ.ศ. 2 หลัก + เดือน)

## เลเยอร์ฝั่ง backend (Clean Architecture)

| เลเยอร์ | แพ็กเกจ | หน้าที่ |
|---|---|---|
| domain | `internal/domain` | entity + `domain.Error` (รหัส error) — ไม่พึ่งพาเลเยอร์อื่น |
| usecase | `internal/usecase/<module>uc` | กฎธุรกิจ, transaction, audit; รับ `postgres.DB` + repo structs |
| repository | `internal/repository/postgres` | SQL ด้วย pgx; ทุกฟังก์ชันใช้ tx จาก context (`postgres.Q(ctx)`) |
| transport | `internal/transport/http` | chi routes, JWT/role middleware, DTO, error → ข้อความ 2 ภาษา (`internal/i18n`) |
| app | `internal/app` | composition root (`wire_<module>.go`) |

โมดูล: auth/store/admin · products · inventory (stock ledger, receipts, adjustments, stock takes) · members + share ledger + LIFF · sales (POS, shifts, held bills, returns) · AR · expenses · promotions · reports · dividends · ai (NL→SQL) · legacy importer

## จุดออกแบบสำคัญ

- **สต็อกเป็น ledger**: ทุกการเปลี่ยนแปลงผ่าน `StockRepo.Apply` → `stock_movements` + `products.stock_on_hand`; ล็อกแถวสินค้าแบบ `FOR NO KEY UPDATE` (ไม่ชนกับ FK KEY SHARE)
- **การขายเป็น transaction เดียว**: header, lines (snapshot ต้นทุน), tenders (หลายช่องทาง), stock, AR, เงินสดในกะ, log ลิ้นชัก
- **ปันผล**: engine เป็น pure function (ทดสอบซ้ำได้), ผลลัพธ์เก็บเป็น run + snapshot input; state machine draft→simulated→approved→paid→closed
- **AI**: prompt มี schema เฉพาะตาราง whitelist; SQL ที่ได้ผ่าน guard (SELECT เดียว, ห้ามตารางระบบ, บังคับ LIMIT) แล้วรันใน transaction read-only + RLS + statement_timeout 8s
- **i18n**: backend ส่ง `code` + ข้อความตาม `Accept-Language`/`X-Locale`; frontend เก็บข้อความใน `i18n/messages/{th,en}.json` และมี test ตรวจ key ครบทั้งสองภาษา
- **ความปลอดภัย**: argon2id, JWT access 15 นาที + refresh token หมุนเวียน 30 วัน, rate limit บน `/auth/*`, audit log ทุกการแก้ไขเอกสารธุรกิจ

## การ deploy

Docker Compose (`deploy/docker-compose.yml`): postgres 16 (volume `/data/pos/pgdata`), api (auto-migrate ตอนเริ่ม), web (standalone Next.js) — ดู [DEPLOY.md](DEPLOY.md)
