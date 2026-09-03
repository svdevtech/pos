# การย้ายข้อมูลจากระบบเดิม (Legacy MS Access → PostgreSQL)

เอกสารอ้างอิงโครงสร้างฐานข้อมูลเดิมฉบับเต็มอยู่ที่ [LEGACY_DATABASE_REFERENCE.md](LEGACY_DATABASE_REFERENCE.md)

## ภาพรวม (Overview)

```
database.mdb ──(Windows: tools/legacy-extract/extract.ps1)──▶ legacy-dump/*.jsonl + manifest.json
                                                                        │ tar / scp
                                                                        ▼
                                              /data/pos/legacy ──(cmd/migrate-legacy)──▶ PostgreSQL (store BBR)
                                                                        │
                                                                        ▼ reconcile report (JSON)
```

1. **ดึงข้อมูล (extract)** ทำบนเครื่อง Windows ที่มี ODBC driver ของ Access เท่านั้น (เครื่อง dev) — เปิดไฟล์แบบอ่านอย่างเดียว ไม่แก้ .mdb
2. **นำเข้า (import)** ทำได้ทั้งบนเครื่อง dev (ต่อ DB ใน Docker) และบนเซิร์ฟเวอร์ (ภายใน container `api`)
3. **กระทบยอด (reconcile)** เป็น stage สุดท้าย ถ้าตัวเลขไม่ตรงคำสั่งจะ exit 1 พร้อมรายการที่ไม่ตรง

## 1. ดึงข้อมูล (extract) — Windows

```powershell
powershell -ExecutionPolicy Bypass -File tools\legacy-extract\extract.ps1 -Mdb D:\workspace\pos\database.mdb -Password pstorenusoft -Out D:\workspace\pos\legacy-dump
# ตรวจซ้ำว่าจำนวนแถวตรงกับ manifest
powershell -ExecutionPolicy Bypass -File tools\legacy-extract\extract.ps1 -Mdb D:\workspace\pos\database.mdb -Out D:\workspace\pos\legacy-dump -Verify
```

- ใช้เวลาประมาณ 10–12 นาที (ตาราง `buydetails` 585,778 แถวเป็นตัวหน่วง) ได้ไฟล์รวม ~260 MB
- ไม่ export `keyregister` (ลิขสิทธิ์โปรแกรมเดิม), `ข้อผิดพลาดในการวาง` (ขยะจากการ paste), `MSys*`
- `manifest.json` เก็บ sha256 ของ .mdb, จำนวนแถว, ชื่อคอลัมน์/ชนิดข้อมูลทุกตาราง — ใช้ตรวจว่า dump ตรงกับไฟล์ต้นทาง

ส่งขึ้นเซิร์ฟเวอร์:

```bash
tar -C D:/workspace/pos -czf - legacy-dump | ssh ubuntu-server 'tar -xzf - -C /data/pos/legacy --strip-components=1'
```

## 2. นำเข้า (import)

ต้องมีร้าน (store) อยู่ก่อน — สร้างด้วย `cmd/seed`:

```bash
# บนเครื่อง dev (backend/.env ชี้ไป postgres://pos:pos@localhost:54322/pos)
cd backend
go run ./cmd/seed -store BBR -store-name "ร้านค้าชุมชน(ประชารัฐ)บ้านบุญเรืองเหนือ" -owner owner -owner-password Owner12345
go run ./cmd/migrate-legacy -dir ../legacy-dump -store BBR -dry-run -report dryrun.json   # ทดลอง (rollback ทั้งหมด)
go run ./cmd/migrate-legacy -dir ../legacy-dump -store BBR -report import.json            # นำเข้าจริง
```

```bash
# บนเซิร์ฟเวอร์ (ภายใน container; โฟลเดอร์ /data/pos/legacy ถูก mount เป็น /legacy)
cd /data/pos/src/deploy
docker compose --env-file /data/pos/.env run --rm --entrypoint /app/seed api -store BBR -store-name "..." -owner owner -owner-password '...'
docker compose --env-file /data/pos/.env run --rm --entrypoint /app/migrate-legacy api -dir /legacy -store BBR -dry-run
docker compose --env-file /data/pos/.env run --rm --entrypoint /app/migrate-legacy api -dir /legacy -store BBR -report /legacy/import-report.json
```

ตัวเลือก: `-stage validate,lookups,...` รันเฉพาะบาง stage (ลำดับ: validate → lookups → products → members → sales → payments → receipts → expenses → misc → dividends → reconcile), `-check-hash` ตรวจ sha256 ของทุกไฟล์

**รันซ้ำได้ (idempotent)**: ทุกตารางใช้ `legacy_id` + `ON CONFLICT` การรันรอบสองจะได้ `rows_out=0, skipped=N` และตัวเลข reconcile เท่าเดิม

## 3. กฎการแปลงข้อมูล (transformation rules)

| ข้อมูลเดิม | กฎ |
|---|---|
| `company` | → `stores` (ชื่อ ที่อยู่ โทร หัว/ท้ายใบเสร็จ โลโก้) + `store_settings.legacy` เก็บค่าตั้งค่าเดิมทั้งหมด |
| `usersys` | → `users` รหัสผ่านเดิม (plaintext) **ไม่ย้าย** ตั้งรหัสสุ่ม + `must_reset_password=true`; level 1→store_owner, 2→cashier, 3→manager, 5→cashier |
| `brand` | → `product_categories`; สินค้าที่ไม่มีหมวด → "ไม่ระบุหมวด" |
| `product.pro_model` | → `units` (หน่วยนับ) |
| `product` / `delproducts` | → `products` (delproducts = `is_archived`, reason `deleted`); `pro_barcode` ตัด `*` → `product_barcodes` (primary); `pro_stock` → `stock_movements` ชนิด `opening` (ครั้งแรกเท่านั้น; ค่าติดลบคงไว้และรายงานใน `extra.negative_stock`) |
| รหัสสินค้าที่ถูกอ้างแต่ไม่มีในตาราง | สร้าง placeholder `[ARCHIVED] <id>` (`archived_reason=placeholder_orphan`) ใช้ชื่อจาก delproducts ถ้ามี |
| `customer` | → `members`; `0` = walk-in (`is_walkin`); `cust_hunmoney` → `share_capital` + รายการ `member_share_transactions` ชนิด `opening`; รหัสลูกค้าที่ไม่มีในตาราง (เช่น `ต100`) → placeholder member สถานะ inactive |
| `buymain` | → `sales`; เลขบิลซ้ำ (N6512-*) แยกเป็นคนละบิลด้วย `legacy_dup_seq` เรียงตามวัน-เวลา; แถวที่ซ้ำกันทุกคอลัมน์ 67 แถวถูกตัดทิ้ง; `buy_status=3` → `cancelled` (+เวลา/ผู้ยกเลิกจาก `buy_cancel_time` แบบ พ.ศ.); `buy_type` 1/2/3/4 → `sale_payments` cash/credit/transfer/card; ลูกหนี้ → `ar_*` |
| `buydetails` | → `sale_lines` แบ่ง segment เมื่อ `buy_rownumber` เริ่ม 1 ใหม่ (สำหรับเลขบิลซ้ำ); `line_total = buy_sumprice − buy_discount`; แถวไร้หัวบิล (25) → `legacy_orphans` |
| `payments` | → `ar_payments`; บิลปี 2561–2562 ที่ถูกลบไปแล้ว → `sale_id NULL` + `legacy_bill_no` |
| `ordermain`/`orderdetails` | → `purchase_receipts`/`_lines` (**ไม่**บวกสต็อกซ้ำ เพราะ `pro_stock` รวมไว้แล้ว) |
| `expenses`, `expenses_type` | → `expenses`, `expense_types` |
| `logopencashdrawer` | → `cash_drawer_logs` (reason `no_sale`) |
| `barcodeforms` | → `barcode_label_templates` (twips → mm) |
| `criteriondividend` | → `dividend_periods` (ปีละงวด) + `dividend_criteria`; `temps2` ปี 2565 → `dividend_runs` (source `legacy_import`, final) + `dividend_member_statements`; net_profit ประมาณจาก pool HUN ÷ 25 % |
| เลขที่เอกสาร | `doc_sequences` ถูกดันให้ต่อจากเลขสุดท้ายของแต่ละงวด (`N6602-05226` → บิลใหม่เดือน ก.พ. 2566 จะเป็น 05227) |

## 4. ตัวเลขกระทบยอดที่ต้องได้ (expected reconciliation)

| รายการ | ค่าที่คาดหวัง |
|---|---|
| หัวบิลใน dump | 231,774 (ซ้ำทุกคอลัมน์ 67 → นำเข้า 231,707) |
| บิลยกเลิก | 977 |
| รายการขายที่มีหัวบิล | 585,753 (กำพร้า 25 → `legacy_orphans`) |
| ยอดขายสถานะปกติ (ไม่รวมบิลยกเลิก) 2563/2564/2565/2566 | 78,021 / 71,470 / 70,537 / 10,702 บิล = ฿6,966,805 / 6,989,392.50 / 5,641,771 / 915,927 (รวมบิลยกเลิกจะเป็น 78,258 / 71,701 / 71,050 / 10,765) |
| สินค้า | 6,611 รหัสไม่ซ้ำ (product 6,285 + delproducts 359 − รหัสที่ซ้ำกับสินค้าปัจจุบัน 33) + placeholder 121 |
| การแก้ค่า tendered ที่เป็นบาร์โค้ด | 32 บิล (`extra.tender_fixed`) |
| สมาชิก | 1,040 (หุ้นรวม ฿512,220 จาก 348 ราย) |
| ชำระลูกหนี้ | 10,351 รายการ (2,776 รายการไม่มีบิลให้ผูก) |
| รับสินค้า | 4,256 ใบ / 18,759 รายการ |
| ปันผล | เกณฑ์ 45 แถว (2559–2566), ใบแจ้งปันผล 2565 1,035 แถว, อัตรา 10.00125 ฿/หุ้น, เฉลี่ยคืน 0.018142 |

รายงาน JSON (`-report`) มี `stages[]` (rows_in/out/skipped/warnings/extra) และ `reconcile.checks[]` (expected/actual/ok)

## 5. หลังนำเข้า (post-import checklist)

1. ให้พนักงานทุกคนตั้งรหัสผ่านใหม่ (`must_reset_password`)
2. ตรวจนับสต็อกสินค้าที่ติดลบ 604 รายการ แล้วสร้างใบตรวจนับ (stock take) เพื่อปรับให้ตรง
3. ตรวจ `legacy_orphans` และสินค้า placeholder (`archived_reason = placeholder_orphan`) ว่าต้องการ merge กับสินค้าจริงหรือไม่
4. ปี 2566 มีเกณฑ์ปันผลแล้วแต่ยังไม่คำนวณ → ใส่กำไรสุทธิและกด "จำลอง" ในหน้าปันผล
5. ถ้ามี backup ปี 2561–2562 ของ `buymain` สามารถรัน stage `sales,payments` ซ้ำเพื่อผูกการชำระที่ค้างอยู่
