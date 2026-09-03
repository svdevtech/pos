# เอกสารอ้างอิงฐานข้อมูลระบบเดิม (Legacy Database Reference) — `database.mdb` (pstorenusoft)

> เอกสารนี้เป็นเอกสารอ้างอิงถาวร (permanent reference) สำหรับฐานข้อมูล MS Access ของโปรแกรม POS เดิม
> "pstorenusoft" ซึ่งใช้ที่ร้านค้าชุมชน(ประชารัฐ)บ้านบุญเรืองเหนือ อ.เชียงของ จ.เชียงราย
> ทุกตัวเลขในเอกสารนี้ตรวจสอบจากการอ่านไฟล์จริงแบบ read-only (ODBC/DAO) เมื่อ 2026-09-02
> และจาก dump ที่ `D:\workspace\pos\legacy-dump\` (manifest `pstorenusoft-legacy-dump/1`)
> ใช้เอกสารนี้แทนการเปิดไฟล์ .mdb ซ้ำในอนาคต — ไม่ควรต้องเปิดไฟล์อีก เว้นแต่ต้องการข้อมูลที่ไม่มีในเอกสาร

สารบัญ (Contents)

1. ภาพรวม (Overview)
2. วิธีเชื่อมต่อ (How to connect)
3. รายการตาราง (Table inventory)
4. รายละเอียดรายตาราง (Per-table detail)
5. สูตรปันผล (Dividend math, verified on BE 2565)
6. ปัญหาคุณภาพข้อมูล (Data-quality issues)
7. ตัวเลขสำหรับกระทบยอด (Reconciliation numbers)
8. การจับคู่ตารางเก่า→ใหม่ (Legacy → new PostgreSQL mapping)
9. ฟังก์ชันของระบบเดิม (Legacy functional inventory)
10. ภาคผนวก (Appendix)

---

## 1. ภาพรวม (Overview)

### 1.1 ระบบคืออะไร (What the system is)

| หัวข้อ | รายละเอียด |
|---|---|
| ชื่อโปรแกรม (product) | **pstorenusoft** — โปรแกรม POS สำหรับ Windows เขียนด้วย Visual Basic ใช้ MS Access เป็น backend |
| ผู้ใช้งาน (store) | ร้านค้าชุมชน(ประชารัฐ)บ้านบุญเรืองเหนือ — หมู่ที่ 1 ตำบลบุญเรือง อำเภอเชียงของ จังหวัดเชียงราย (โทร. 084-3716939) |
| รูปแบบธุรกิจ | ร้านค้าสหกรณ์ชุมชน (community co-op store): ขายปลีก + สมาชิกถือหุ้น (share capital) + ขายเชื่อสมาชิก (ลูกหนี้) + ปันผลประจำปี (ปันหุ้น + เฉลี่ยคืนตามยอดซื้อ) |
| business logic | **ทั้งหมดอยู่ในโปรแกรม VB** — ในไฟล์ .mdb ไม่มี saved queries, relationships, forms, macros หรือ modules เลย ความหมายของคอลัมน์ทั้งหมดในเอกสารนี้อนุมานจากข้อมูลจริง |

### 1.2 ข้อมูลไฟล์ (File facts)

| หัวข้อ | ค่า |
|---|---|
| Path | `D:\workspace\pos\database.mdb` (มีไฟล์ lock `database.ldb` ข้างกันเมื่อถูกเปิด) |
| ขนาด | 171,773,952 bytes (≈ 171 MB) |
| SHA-256 | `bb4cea2785f54d8a8cbc41e304cc6bf3e73d3cba121b2ab879010f8ab66ab8d1` |
| รูปแบบ | Microsoft Access 2000–2003 (Jet 4) `.mdb` |
| รหัสผ่านฐานข้อมูล (database password) | `pstorenusoft` |
| Timezone ของข้อมูล | Asia/Bangkok (ค่า DATETIME เป็น wall-clock time ไม่มี timezone) |
| ปฏิทิน | วันที่ในคอลัมน์ DATETIME เป็น ค.ศ. (Gregorian) แต่ **ข้อความ** วันที่ (`buy_cancel_time`, `payment_datetime`) และเลขที่เอกสารใช้ **พ.ศ. (Buddhist Era)** |
| Dump | `D:\workspace\pos\legacy-dump\<table>.jsonl` + `manifest.json` (สร้างเมื่อ 2026-09-02T16:26:11+07:00) |

### 1.3 ช่วงเวลาของข้อมูลแต่ละตาราง (Date coverage per table)

| ตาราง | ตั้งแต่ | ถึง | หมายเหตุ |
|---|---|---|---|
| `buymain` / `buydetails` (ขาย) | 2020-01-01 | 2023-02-28 | บิลก่อน 2020-01-01 ถูกลบออกไปแล้ว (purged) ทำให้ payments ปี 2018–2019 ไม่มีบิลให้อ้างอิง |
| `payments` (รับชำระลูกหนี้) | 2018-11-11 | 2023-02-28 | 2,477 แถวมีวันที่ก่อน 2020; 2,776 แถวอ้างบิลที่ไม่มีใน `buymain` |
| `ordermain` / `orderdetails` (รับสินค้า) | 2018-11-11 | 2023-02-27 | |
| `logopencashdrawer` | 2018-11-10 | 2022-12-05 | |
| `expenses` | 2018-11-14 | 2022-12-31 | |
| `customer.cust_datestart` (วันที่สมัครสมาชิก) | 2016-01-17 | 2023-02-05 | 968 จาก 1,040 แถวมีค่า |
| `criteriondividend` | พ.ศ. 2559 | พ.ศ. 2566 | เกณฑ์ปันผล 8 ปี |
| `temps2` / `temps3` | พ.ศ. 2565 | พ.ศ. 2565 | ใบแจ้งปันผลรายสมาชิกปีล่าสุดที่คำนวณ |
| `chartmonth` | พ.ศ. 2562, 2565 | | cache กราฟรายเดือน 2 ปี |

### 1.4 รูปแบบเลขที่เอกสาร (Business identifiers)

| ชนิด | รูปแบบ | ตัวอย่าง | ความหมาย |
|---|---|---|---|
| บิลขาย (`buymain.buy_id`) | `N{BE yy}{MM}-{seq5}` | `N6602-05115` | N = ขาย, `66` = พ.ศ. 2566 (ค.ศ. 2023), `02` = กุมภาพันธ์, ลำดับที่ 5115 ของเดือน (counter รีเซ็ตทุกเดือน) |
| ใบรับสินค้า (`ordermain.order_id`) | `OD{BE yy}{MM}-{seq5}` | `OD6602-00005` | OD = order/receive, counter รีเซ็ตทุกเดือน |
| รหัสสมาชิก (`customer.cust_id`) | free-form text 1–13 ตัวอักษร | `101011191011`, `91014`, `238`, `Wat kang` | มักสร้างจากบ้านเลขที่/หมู่ที่; `0` = ลูกค้าทั่วไป (walk-in / ไม่ระบุ) |
| รหัสสินค้า (`product.pro_id`) | text 1–20 ตัวอักษร | `8850999321004`, `0000000073`, `*/*/*/*/*` | 5,686 จาก 6,285 เป็น EAN-13; ที่เหลือเป็นรหัสภายในที่ร้านตั้งเอง |
| บาร์โค้ด (`product.pro_barcode`) | `*{pro_id}*` | `*8850999321004*` | ห่อด้วย `*` สำหรับฟอนต์ Code 39 |
| รหัสผู้ใช้ (`usersys.user_id`) | `U{nnn}` | `U001` | แต่ key จริงที่ตารางอื่นอ้างคือ `user_user` (username) |
| รหัส supplier (`supplier.sup_id`) | `{nnnn}` | `0001` | `0` = ไม่ระบุ |
| ปีปันผล | พ.ศ. 4 หลัก (text) | `2565` | |

---

## 2. วิธีเชื่อมต่อ (How to connect)

### 2.1 ODBC จาก PowerShell (`System.Data.Odbc`) — สำหรับอ่านข้อมูล

ต้องมี driver 64-bit "Microsoft Access Driver (*.mdb, *.accdb)" (มากับ Office หรือ Access Database Engine Redistributable) และรัน PowerShell 64-bit

```powershell
$cs = "Driver={Microsoft Access Driver (*.mdb, *.accdb)};Dbq=D:\workspace\pos\database.mdb;Pwd=pstorenusoft;ReadOnly=1;"
$conn = New-Object System.Data.Odbc.OdbcConnection($cs)
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT COUNT(*) FROM [buymain]"
$cmd.CommandTimeout = 0            # ตารางใหญ่ใช้เวลานาน
$cmd.ExecuteScalar()
$conn.Close()
```

- ใส่ `ReadOnly=1;` เสมอ — ไม่ควรแก้ไขไฟล์ต้นฉบับ
- ชื่อตารางที่เป็นภาษาไทยหรือมีอักขระพิเศษต้องครอบด้วย `[...]`
- `$reader.GetDataTypeName(i)` ให้ชื่อชนิด ODBC (`VARCHAR`, `DOUBLE`, `COUNTER`, `DATETIME`, `INTEGER`, `LONGCHAR`, `LONGBINARY`) ตามที่ใช้ใน `manifest.json`

### 2.2 DAO (`DAO.DBEngine.120`) — สำหรับอ่าน index / primary key

ODBC ไม่คืนข้อมูล index ให้ ต้องใช้ DAO ผ่าน COM:

```powershell
$dbe = New-Object -ComObject DAO.DBEngine.120
$db  = $dbe.OpenDatabase('D:\workspace\pos\database.mdb', $false, $true, ';PWD=pstorenusoft')   # exclusive=false, readonly=true
foreach ($t in $db.TableDefs) {
  if ($t.Name -like 'MSys*') { continue }
  foreach ($ix in $t.Indexes) {
    $cols = ($ix.Fields | ForEach-Object { $_.Name }) -join ','
    '{0,-20} {1,-25} primary={2} unique={3} [{4}]' -f $t.Name, $ix.Name, $ix.Primary, $ix.Unique, $cols
  }
}
$db.Close()
```

### 2.3 ข้อควรระวัง / สิ่งที่ค้นพบระหว่างสำรวจ (Gotchas)

| ประเด็น | รายละเอียด |
|---|---|
| ไม่มี queries / relations / forms | `db.QueryDefs` และ `db.Relations` ว่าง ไม่มี forms/modules — logic ทั้งหมดอยู่ใน VB app |
| `MSysObjects` อ่านไม่ได้ | ODBC/DAO คืน "no read permission" — ใช้ `db.TableDefs` (DAO) หรือ `$conn.GetSchema('Tables')` (ODBC) แทน |
| `IN (subquery)` และ JOIN บนตารางใหญ่ช้ามาก | บน `buymain` (231K แถว) / `buydetails` (585K แถว) จะ time-out หรือค้าง → **ดึงข้อมูลทั้งตารางแล้วคำนวณฝั่ง client** (PowerShell hashtable / Python) |
| `SELECT TOP n ... ORDER BY` | Access คืนแถวที่มีค่าเท่ากัน (ties) เกินจำนวน n ที่ขอ อย่าพึ่ง TOP เพื่อจำกัดจำนวนแถวแน่นอน |
| `$PID` ใน PowerShell | เป็นตัวแปรระบบ (process id) อย่าตั้งชื่อตัวแปร `$pid`/`$PID` สำหรับ product id — ใช้ `$proId` |
| ตัวเลข DOUBLE | ค่าจากการคูณ/หารเก็บเป็น double มีเศษทศนิยมยาว เช่น `4.26315789473684` ต้องปัดเป็น 2 ตำแหน่ง (half-up) เมื่อแสดงผล |
| ข้อความวันที่ พ.ศ. | `buy_cancel_time`, `payment_datetime` รูปแบบ `d/M/BEyyyy  H:mm:ss` (สังเกต **เว้นวรรค 2 ช่อง** ระหว่างวันที่กับเวลา, วัน/เดือน/ชั่วโมงไม่มี 0 นำหน้า) เช่น `1/1/2563  12:15:17` → 2020-01-01 12:15:17 |
| ข้อความเวลา | `buy_timesale` = `H:mm` (ไม่มีวินาที ไม่มี 0 นำหน้าชั่วโมง) เช่น `6:27`; `log_time` = `H:mm:ss` เช่น `20:34:28` |
| Encoding | Access เก็บ Unicode; ผ่าน ODBC ได้ภาษาไทยถูกต้อง แต่ console ของ PowerShell 5.1 ต้องตั้ง `[Console]::OutputEncoding = UTF8` และ Python ต้องตั้ง `PYTHONIOENCODING=utf-8` มิฉะนั้นภาษาไทยเป็น mojibake |

### 2.4 การใช้ extractor `tools/legacy-extract/extract.ps1`

สคริปต์อ่านทุก business table ผ่าน ODBC (read-only) แล้วเขียน `<table>.jsonl` (UTF-8 ไม่มี BOM, 1 แถว = 1 JSON object) และ `manifest.json` — ไม่ต้องติดตั้งอะไรเพิ่มบน Windows ที่มี Office

```powershell
# ดึงข้อมูล (ใช้เวลาประมาณหลายนาที; buymain/buydetails เป็นส่วนใหญ่)
powershell -ExecutionPolicy Bypass -File tools\legacy-extract\extract.ps1 `
  -Mdb D:\workspace\pos\database.mdb -Password pstorenusoft -Out D:\workspace\pos\legacy-dump

# ตรวจสอบซ้ำ: นับแถวใน DB เทียบกับ manifest และจำนวนบรรทัดในไฟล์ (exit 1 ถ้าไม่ตรง)
powershell -ExecutionPolicy Bypass -File tools\legacy-extract\extract.ps1 `
  -Mdb D:\workspace\pos\database.mdb -Password pstorenusoft -Out D:\workspace\pos\legacy-dump -Verify
```

พารามิเตอร์: `-Mdb` (บังคับ), `-Out` (บังคับ), `-Password` (default `pstorenusoft`), `-Verify` (switch)

พฤติกรรมสำคัญของ extractor:

- ตารางที่มี autonumber จะ `ORDER BY` คอลัมน์นั้น (ดู `order_by` ใน manifest) เพื่อให้ลำดับแถวคงที่ — จำเป็นสำหรับการแยกบิลซ้ำใน `buydetails` (ดู §6)
- ข้าม `keyregister`, `ข้อผิดพลาดในการวาง`, `MSys*` โดยตั้งใจ
- การเข้ารหัสค่า: `NULL` → `null`; `DATETIME` → `"yyyy-MM-ddTHH:mm:ss"` (naive local time); `byte[]` (LONGBINARY) → base64 string; double → รูปแบบ `R` (round-trip) เช่น `4.26315789473684`; string escape เฉพาะ `\`, `"`, control chars (`\r\n` ปรากฏในบางค่า เช่น `expen_detail`, `user_address`)
- JSON encoder เขียนเอง (ไม่ใช้ `ConvertTo-Json` ต่อแถว เพราะช้ากว่า ~50 เท่าบนตาราง 585K แถว)
- `manifest.json` เก็บ `source_sha256` ของไฟล์ .mdb, และต่อตาราง: `name, file, rows, order_by, columns[{name,type}], sha256` ของไฟล์ jsonl

ขนาดไฟล์ dump ที่ได้ (สำหรับอ้างอิง): `buydetails.jsonl` 139.5 MB, `buymain.jsonl` 118.5 MB, `payments.jsonl` 2.5 MB, `product.jsonl` 2.6 MB, `orderdetails.jsonl` 2.4 MB, `logopencashdrawer.jsonl` 1.4 MB, ที่เหลือ < 1 MB; ตารางว่าง (`saletoday`, `promotionbill`, `promotionproduct`) เป็นไฟล์ 0 byte (sha256 ของไฟล์ว่าง = `e3b0c442...b855`)

---

## 3. รายการตาราง (Table inventory)

ไฟล์มี business table 26 ตาราง (export ทั้งหมด) + ตารางที่ไม่ export 3 ตาราง + system tables (`MSys*`)

| # | ตาราง | แถว | หน้าที่ (purpose) | PK / index (จาก DAO) | Migrate? |
|---|---|---|---|---|---|
| 1 | `company` | 1 | โปรไฟล์ร้าน + ตั้งค่า POS (หัว/ท้ายใบเสร็จ, โลโก้, COM port) | PK `company_id` | ✔ → `stores`, `store_settings` |
| 2 | `usersys` | 9 | ผู้ใช้/พนักงาน (รหัสผ่าน **plaintext**) | PK `user_user` | ✔ → `users` (ไม่เอารหัสผ่าน) |
| 3 | `brand` | 29 | **หมวดหมู่สินค้า** (ชื่อตารางทำให้เข้าใจผิดว่าเป็นยี่ห้อ) | PK `brand_id` (text) | ✔ → `product_categories` |
| 4 | `product` | 6,285 | สินค้า (ต้นทุน, ราคาขาย, สต็อก, หน่วย) | PK `pro_id` (text) | ✔ → `products`, `product_barcodes`, `units`, `stock_movements` (opening) |
| 5 | `delproducts` | 359 | สินค้าที่ถูกลบ (archive, คอลัมน์เหมือน product + autonumber) | PK `id` | ✔ → `products` (is_archived, reason `deleted`) |
| 6 | `supplier` | 48 | ผู้จำหน่าย | PK `sup_id` | ✔ → `suppliers` |
| 7 | `customer` | 1,040 | สมาชิก/ลูกค้า + ทุนเรือนหุ้น | PK `cust_id` | ✔ → `members`, `member_share_transactions` (opening) |
| 8 | `typepayments` | 4 | lookup วิธีชำระเงิน 1–4 | PK `buy_type` | ✔ (map เป็น enum `payment_method`) |
| 9 | `buymain` | 231,774 | **หัวบิลขาย** 2020-01 → 2023-02 | **ไม่มี PK**; non-unique index บน `buy_id` และ `cust_id` | ✔ → `sales`, `sale_payments` |
| 10 | `buydetails` | 585,778 | รายการสินค้าในบิลขาย | **ไม่มี PK**; autonumber `ID` | ✔ → `sale_lines` |
| 11 | `payments` | 10,351 | รับชำระลูกหนี้ (credit bill payments) 2018-11 → 2023-02 | PK `payment_id` | ✔ → `ar_payments` |
| 12 | `ordermain` | 4,256 | หัวใบรับสินค้า/สั่งซื้อ 2018-11 → 2023-02 | PK `order_id` | ✔ → `purchase_receipts` |
| 13 | `orderdetails` | 18,759 | รายการในใบรับสินค้า | PK `id` | ✔ → `purchase_receipt_lines` |
| 14 | `expenses` | 57 | บันทึกค่าใช้จ่าย | PK `expen_id` | ✔ → `expenses` |
| 15 | `expenses_type` | 7 | ประเภทค่าใช้จ่าย | PK `type_id` | ✔ → `expense_types` |
| 16 | `criteriondividend` | 45 | **เกณฑ์ปันผลรายปี** พ.ศ. 2559–2566 | PK `criteriondividend_id` | ✔ → `dividend_periods`, `dividend_criteria` |
| 17 | `temps` | 5 | ผลคำนวณการจัดสรรกำไรครั้งล่าสุด (scratch) | autonumber `id` | ✔ (บางส่วน) → `dividend_runs.totals` |
| 18 | `temps2` | 1,035 | **ใบแจ้งปันผลรายสมาชิก พ.ศ. 2565** | PK `id` | ✔ → `dividend_runs` + `dividend_member_statements` |
| 19 | `temps3` | 1,035 | **สำเนาของ `temps2` ทุกแถวเหมือนกัน** (ต่างเฉพาะ sha256 เพราะ autonumber) | PK `id` | ✘ (ซ้ำกับ temps2) |
| 20 | `chartmonth` | 24 | cache ยอดขายรายเดือนสำหรับกราฟ (พ.ศ. 2562, 2565) | autonumber `chart_id` | ✘ (แทนด้วย `monthly_sales_mv`) |
| 21 | `logopencashdrawer` | 10,637 | log การเปิดลิ้นชักเงิน 2018-11 → 2022-12 | PK `log_id` | ✔ → `cash_drawer_logs` |
| 22 | `saletoday` | 0 | เปิด/ปิดกะ (ออกแบบไว้ ไม่เคยใช้) | autonumber `saletoday_id` | ✘ (ว่าง; ระบบใหม่มี `shifts`) |
| 23 | `promotionbill` | 0 | โปรโมชันระดับบิล (ไม่เคยใช้) | autonumber `pm_id` | ✘ (ว่าง; ระบบใหม่มี `promotions`) |
| 24 | `promotionproduct` | 0 | โปรโมชันระดับสินค้า (ไม่เคยใช้) | autonumber `pm_id` | ✘ (ว่าง) |
| 25 | `barcodeforms` | 5 | แม่แบบฉลากบาร์โค้ด A4/A5/A7/A9/A10 (+ รูป preview ~100 KB) | `id` (INTEGER) | ✔ → `barcode_label_templates` (ไม่เอารูป) |
| 26 | `barcodes` | 10 | scratch สำหรับพิมพ์ฉลาก (4 คอลัมน์ต่อแถว) | `id` (INTEGER) | ✘ |
| 27 | `barcodeencode` | 1 | scratch ข้อความบาร์โค้ดที่ encode แล้ว | autonumber `id` | ✘ |
| — | `keyregister` | 1 | **ใบอนุญาตซอฟต์แวร์** (licence key) | — | ✘ **ห้าม export/พิมพ์ค่า** |
| — | `ข้อผิดพลาดในการวาง` | 4 | ตาราง "Paste Errors" ที่ Access สร้างอัตโนมัติ (ขยะ) | — | ✘ |
| — | `MSysCompactError` | 48 | ตารางระบบ (บันทึก error ตอน compact) | — | ✘ |

หมายเหตุ: `temps3` ถูก export ไว้ด้วย (อยู่ใน 26 ตาราง) เพื่อความครบถ้วน แต่ตอน migrate ใช้ `temps2` เท่านั้น

---

## 4. รายละเอียดรายตาราง (Per-table detail)

ชนิดข้อมูลในตารางด้านล่างเป็นชื่อชนิด ODBC ตาม `manifest.json`; ความสัมพันธ์กับชนิดใน Access:

| ODBC type | Access type | ขนาด (size) |
|---|---|---|
| `VARCHAR` | Text | สูงสุด 255 ตัวอักษร (ความยาวที่ตั้งไว้จริงต่อคอลัมน์ไม่ได้บันทึกไว้ในเอกสารนี้ — อ่านได้จาก DAO `Field.Size`) |
| `LONGCHAR` | Memo | ไม่จำกัด (≈ 64 K) |
| `DOUBLE` | Number (Double) | 8 bytes |
| `INTEGER` | Number (Long Integer) | 4 bytes |
| `COUNTER` | AutoNumber (Long) | 4 bytes |
| `DATETIME` | Date/Time | 8 bytes |
| `LONGBINARY` | OLE Object | binary blob |

ทุกคอลัมน์ nullable (Access default) เว้นแต่ PK/autonumber; ค่าว่างพบได้ทั้ง `NULL` และ `""` ปะปนกัน (ต้อง treat เหมือนกัน)

### 4.1 `company` — โปรไฟล์ร้านและการตั้งค่า (1 แถว)

| คอลัมน์ | ODBC type | ความหมาย | ค่า / หมายเหตุ |
|---|---|---|---|
| `company_id` | COUNTER | PK | `209` |
| `company_name` | VARCHAR | ชื่อร้าน (พิมพ์หัวใบเสร็จ) | `ร้านค้าชุมชน(ประชารัฐ)บ้านบุญเรืองเหนือ` |
| `company_add` | VARCHAR | ที่อยู่ | `หมู่ที่ 1 ตำบลบุญเรือง อำเภอเชียงของ จังหวัดเชียงราย` |
| `company_tel` | VARCHAR | โทรศัพท์ (เก็บพร้อมคำว่า "โทร.") | `โทร. 084-3716939` |
| `company_fax` | VARCHAR | ตามชื่อคือแฟกซ์ แต่ **ถูกใช้เก็บชื่อเอกสารบนใบเสร็จ** | `ใบเสร็จรับเงิน` |
| `company_textbuttom` | VARCHAR | ข้อความท้ายใบเสร็จ (receipt footer) | `*** ขอบคุณที่ใช้บริการ ***` |
| `company_closeofday` | VARCHAR | เปิดใช้ฟีเจอร์ปิดยอดสิ้นวันหรือไม่ | `NO` |
| `company_logo` | LONGBINARY | โลโก้ (≈ 4 KB, base64 ใน dump) | มีค่า |
| `company_typesoftware` | VARCHAR | ประเภทซอฟต์แวร์ | `NULL` |
| `company_typepaper` | VARCHAR | ขนาดกระดาษใบเสร็จ (58/80 mm) | `NULL` |
| `company_showtax` | VARCHAR | แสดงภาษีบนใบเสร็จ | `NULL` |
| `company_editprice` | VARCHAR | อนุญาตแก้ราคาหน้าจอขาย | `NULL` |
| `company_vattype` | VARCHAR | ชนิด VAT (รวมใน/แยกนอก) | `NULL` |
| `company_roundpoint` | VARCHAR | การปัดเศษ | `NULL` |
| `company_windowsversion` | VARCHAR | รุ่น Windows | `NULL` |
| `company_cashcomport` | VARCHAR | COM port ลิ้นชักเงิน | `NULL` |
| `company_displaycomport` | VARCHAR | COM port จอแสดงราคาลูกค้า | `NULL` |
| `company_displaymaxchartinline` | VARCHAR | จำนวนตัวอักษรต่อบรรทัดของจอลูกค้า | `NULL` |

ตัวอย่างแถว (ตัดโลโก้):

```json
{"company_id":209,"company_name":"ร้านค้าชุมชน(ประชารัฐ)บ้านบุญเรืองเหนือ","company_add":"หมู่ที่ 1 ตำบลบุญเรือง อำเภอเชียงของ จังหวัดเชียงราย","company_tel":"โทร. 084-3716939","company_fax":"ใบเสร็จรับเงิน","company_textbuttom":"*** ขอบคุณที่ใช้บริการ ***","company_closeofday":"NO","company_logo":"<base64>","company_typesoftware":null,"company_typepaper":null,"company_showtax":null,"company_editprice":null,"company_vattype":null,"company_roundpoint":null,"company_windowsversion":null,"company_cashcomport":null,"company_displaycomport":null,"company_displaymaxchartinline":null}
```

Quirks: ตั้งค่าเกือบทั้งหมดเป็น NULL (โปรแกรมใช้ default); `company_fax` ถูก repurpose เป็นชื่อเอกสาร

### 4.2 `usersys` — ผู้ใช้ระบบ (9 แถว)

| คอลัมน์ | ODBC type | ความหมาย | ค่า / หมายเหตุ |
|---|---|---|---|
| `user_id` | VARCHAR | รหัสภายใน `U001`…`U009` | ไม่ถูกอ้างจากตารางอื่น |
| `user_user` | VARCHAR | **username** (PK; ตารางอื่นอ้างคอลัมน์นี้ใน `user_user`, `log_user`, `buy_cancel_user`) | มีทั้งอังกฤษและไทย (`ยุพิน`, `อนันทร์`, `กรกมล`) |
| `user_password` | VARCHAR | รหัสผ่าน **plaintext** | **ห้าม migrate / ห้ามพิมพ์** |
| `user_name` | VARCHAR | ชื่อแสดง | |
| `user_address` | VARCHAR | ที่อยู่ (อาจมี `\r\n`) | |
| `user_phone` | VARCHAR | โทรศัพท์ | |
| `user_level` | VARCHAR | ระดับสิทธิ์ `1`, `2`, `3`, `5` | ดู mapping ด้านล่าง |
| `user_status` | VARCHAR | `Active` / `Disable` | |

รายชื่อผู้ใช้ทั้งหมดและ mapping ไปยัง role ของระบบใหม่ (ตกลงแล้ว):

| `user_id` | `user_user` | `user_name` | `user_level` | `user_status` | role ใหม่ |
|---|---|---|---|---|---|
| U001 | `admin` | Administrator | 1 | Active | `store_owner` |
| U003 | `chien` | วิเชียร เกตุประเสริฐ | 1 | Active | `store_owner` |
| U004 | `amnat` | อำนาจ ไชยราฃ | 2 | Disable | `cashier` (inactive) |
| U009 | `chananuch` | ชนานุช ทาลมดี | 2 | Active | `cashier` |
| U002 | `user1` | อำไพ ทารักษ์ | 2 | Disable | `cashier` (inactive) |
| U005 | `กรกมล` | กรกมล อุ่นคำ | 2 | Disable | `cashier` (inactive) |
| U006 | `อนันทร์` | อนันทร์ | 3 | Active | `manager` |
| U008 | `yp` | ยุพิน อุ่นคำ | 5 | Active | `cashier` |
| U007 | `ยุพิน` | ยุพิน | 5 | Active | `cashier` |

กฎ mapping `user_level`: **1 → `store_owner`, 2 → `cashier`, 3 → `manager`, 5 → `cashier`** (ไม่มีระดับ 4 ในข้อมูล) ความหมายเดิมของแต่ละระดับไม่มีเอกสาร อนุมานจากพฤติกรรม: level 1 ยกเลิกบิลได้ (`buy_cancel_user` = admin/chien), level 5 (`yp`) เป็นแคชเชียร์หลักที่ขาย/รับชำระ/รับสินค้ามากที่สุด, level 3 (`อนันทร์`) รับสินค้า 866 ครั้ง รับชำระ 2,037 ครั้ง

ตัวอย่างแถว (mask รหัสผ่าน):

```json
{"user_id":"U001","user_user":"admin","user_password":"***","user_name":"Administrator","user_address":"","user_phone":"","user_level":"1","user_status":"Active"}
{"user_id":"U008","user_user":"yp","user_password":"***","user_name":"ยุพิน อุ่นคำ","user_address":"308 ม.1 ต.บุญเรือง อ.เชียงของ\r\n จ.เชียงราย","user_phone":"0927785646","user_level":"5","user_status":"Active"}
```

Quirks: username ภาษาไทย 3 ราย; ผู้ใช้ `ยุพิน` (U007) กับ `yp` (U008) น่าจะเป็นคนเดียวกัน (ชื่อเดียวกัน) แต่เป็นคนละบัญชี — migrate แยกกันตามเดิม; ทุกบัญชีต้อง `must_reset_password = true`

### 4.3 `brand` — หมวดหมู่สินค้า (29 แถว)

| คอลัมน์ | ODBC type | ความหมาย | หมายเหตุ |
|---|---|---|---|
| `brand_id` | VARCHAR | PK (text; `0`, `01`, `010`, `1`…`41` ไม่ต่อเนื่อง) | อ้างจาก `product.brand_id` |
| `brand_name` | VARCHAR | ชื่อหมวด | `brand_id = "0"` ชื่อว่าง = ไม่ระบุหมวด |

รายการทั้งหมด (id → ชื่อ, จำนวนสินค้าใน `product`): `0` → (ว่าง) 5 · `01` เครื่องปรุงรส 69 · `010` น้ำอัดลม 33 · `1` ครีมนวดผม 86 · `2` ข้าว 21 · `3` สบู่ ครีมอาบน้ำ 292 · `4` ยาสระผม แชมพู 215 · `5` ยาสีฟัน แปรงสีฟัน 154 · `6` แป้งทาตัว 90 · `7` ซักผ้า 133 · `8` ปรับผ้านุ่ม 171 · `9` กาแฟ 102 · `10` ของเล่น 12 · `11` เวชภัณฑ์ 15 · `13` อาหารบรรจุกระป๋อง 27 · `28` โลชั่น 41 · `29` เครื่องดื่ม 259 · `30` ของใช้ 1,121 · `31` อาหาร 813 · `32` ยาสูบ 27 · `33` สุรา 77 · `34` ยา 383 · `35` ขนม 1,121 · `36` เครื่องเขียน 57 · `37` เครื่องสำอาง 522 · `38` อาหารสัตร (sic) 10 · `39` น้ำ 117 · `40` นม 272 · `41` ยาฆ่าแมลง 37 · (`brand_id = ""` ไม่มีใน brand) 3

ตัวอย่างแถว: `{"brand_id":"01","brand_name":"เครื่องปรุงรส"}`

Quirks: ชื่อตารางว่า brand แต่ใช้เป็นหมวดหมู่; id เป็น text ที่มีทั้ง `1` และ `01`/`010` — ห้ามแปลงเป็นตัวเลข; `อาหารสัตร` สะกดผิด (ควรเป็น อาหารสัตว์) — คงค่าเดิมตอน migrate

### 4.4 `product` — สินค้า (6,285 แถว)

| คอลัมน์ | ODBC type | ความหมาย | ค่า / หมายเหตุ |
|---|---|---|---|
| `pro_id` | VARCHAR | PK รหัสสินค้า/บาร์โค้ด 1–20 ตัวอักษร | 5,686 แถวยาว 13 (EAN-13); ดูการกระจายใน §10.6 |
| `brand_id` | VARCHAR | FK → `brand.brand_id` (หมวดหมู่) | 3 แถวเป็น `""` (ไม่มีใน brand) |
| `pro_name` | VARCHAR | ชื่อสินค้า | |
| `pro_model` | VARCHAR | **หน่วยนับ (unit)** ไม่ใช่รุ่น | 71 ค่า: ขวด 1,462 · ซอง 1,142 · ห่อ 675 · ถุง 555 · กล่อง 515 · อัน 342 · กระป๋อง 217 · หลอด 142 · ก้อน 127 · แพ็ค/แพ็ก/แพ๊ค/แพค (สะกด 4 แบบ) 416 … |
| `pro_color` | VARCHAR | สี — **ไม่ใช้** (ว่างทุกแถว) | drop |
| `pro_costprice` | DOUBLE | ต้นทุนล่าสุด (last cost) | |
| `pro_costpriceavg` | DOUBLE | ต้นทุนถัวเฉลี่ยเคลื่อนที่ (moving-average cost) | |
| `pro_buyprice` | DOUBLE | **ราคาขาย (sell price)** — ชื่อคอลัมน์ทำให้เข้าใจผิด | |
| `pro_buypricelevel1`…`4` | DOUBLE | ราคาขายระดับ 1–4 | **0 ทุกแถว** (ไม่เคยใช้) |
| `pro_stock` | DOUBLE | สต็อกคงเหลือ | 604 แถวติดลบ, 2,946 แถวเป็น 0 |
| `pro_barcode` | VARCHAR | บาร์โค้ดสำหรับพิมพ์ = `*` + pro_id + `*` (Code 39) | ไม่ตรงสูตร 1 แถว: `8859344700044` → `*8859344700044         *` (มีช่องว่างท้าย) |
| `pro_minlevel1` | INTEGER | จุดสั่งซื้อ (reorder level) | 5,996 แถวเป็น 2 |
| `pro_minlevel2` | INTEGER | จุดวิกฤต | เกือบทั้งหมดเป็น 1 |
| `pro_serialstatus` | VARCHAR | `YES`/`NO` ต้องบันทึก serial number ตอนขาย | `YES` 2 แถว: `8850952212332` น้ำผลไม้รวมผสมโยเกิร์ต ตราดีโด้, `8852023664750` โก๋แก่ ถั่วอบเกลือทั้งฝัก 90กรัม. (น่าจะตั้งผิด) |

ตัวอย่างแถว:

```json
{"pro_id":"*/*/*/*/*","brand_id":"30","pro_name":"สายรัด 5 ฟุต.","pro_model":"เส้น","pro_color":"","pro_costprice":11.6666,"pro_costpriceavg":7.5,"pro_buyprice":15,"pro_buypricelevel1":0,"pro_buypricelevel2":0,"pro_buypricelevel3":0,"pro_buypricelevel4":0,"pro_stock":12,"pro_barcode":"**/*/*/*/**","pro_minlevel1":2,"pro_minlevel2":1,"pro_serialstatus":"NO"}
{"pro_id":"*/*/*/*/*/","brand_id":"30","pro_name":"สายรัด 8 ฟุต.","pro_model":"เส้น","pro_color":"","pro_costprice":17,"pro_costpriceavg":7.5,"pro_buyprice":20,"pro_buypricelevel1":0,"pro_buypricelevel2":0,"pro_buypricelevel3":0,"pro_buypricelevel4":0,"pro_stock":0,"pro_barcode":"**/*/*/*/*/*","pro_minlevel1":2,"pro_minlevel2":1,"pro_serialstatus":"NO"}
```

Quirks และตัวเลข:

- มูลค่าสต็อก: Σ(`pro_stock` × `pro_costpriceavg`) เฉพาะสต็อกบวก = **฿1,226,838** (≈ ฿1.23 M ตามแผน); รวมสต็อกติดลบ = ฿982,223; ที่ราคาต้นทุนล่าสุดเฉพาะบวก = ฿1,252,970
- สินค้า 3 แถวไม่มีหมวด (`brand_id = ""`): `000000038` สบู่เสือแม่ลูก อโวคาโด้, `1234567891` เม็ดผักชี, `8850382312046` สปายแบลค ดำ
- รหัสสินค้าแปลก เช่น `*/*/*/*/*` (ร้านตั้งเองสำหรับสินค้าไม่มีบาร์โค้ด) และมีรหัส 20 ตัวอักษร 8 แถว
- หน่วยนับสะกดหลายแบบ (แพ็ค/แพ็ก/แพ๊ค/แพค) — ระบบใหม่ seed `units` จากค่า distinct โดยไม่รวมกันอัตโนมัติ (ให้ผู้ใช้ merge ภายหลัง)

### 4.5 `delproducts` — สินค้าที่ถูกลบ (359 แถว)

คอลัมน์เหมือน `product` ทุกประการ นำหน้าด้วย `id` (COUNTER, PK, 1–359) — โปรแกรมคัดลอกแถวไปเก็บก่อนลบออกจาก `product`

| คอลัมน์ | ODBC type | ความหมาย |
|---|---|---|
| `id` | COUNTER | PK ลำดับการลบ |
| `pro_id`, `brand_id`, `pro_name`, `pro_model`, `pro_color`, `pro_costprice`, `pro_costpriceavg`, `pro_buyprice`, `pro_buypricelevel1..4`, `pro_stock`, `pro_barcode`, `pro_minlevel1`, `pro_minlevel2`, `pro_serialstatus` | (เหมือน product) | snapshot ณ เวลาลบ |

ตัวอย่าง: `{"id":1,"pro_id":"8850002010109","brand_id":"30","pro_name":"ไลปอนเอฟ ชนิดเติม 550มล.","pro_model":"ถุง","pro_color":"","pro_costprice":16,"pro_costpriceavg":16,"pro_buyprice":22,...,"pro_stock":104,"pro_barcode":"*8850002010109*","pro_minlevel1":2,"pro_minlevel2":1,"pro_serialstatus":"NO"}`

Quirks: มีสต็อกค้าง ณ เวลาลบ (เช่น 104); 19 จาก 121 รหัสสินค้าที่หายไปจาก `buydetails` พบในตารางนี้; หมวดที่ถูกลบมากสุด `30` ของใช้ 129, `35` ขนม 65

### 4.6 `supplier` — ผู้จำหน่าย (48 แถว)

| คอลัมน์ | ODBC type | ความหมาย | หมายเหตุ |
|---|---|---|---|
| `sup_id` | VARCHAR | PK `0`, `0001`…`0047` | `0` = ไม่ระบุ |
| `sup_name` | VARCHAR | ชื่อ (มักเป็นชื่อเซลล์/ยี่ห้อ เช่น `เซล ยูนิลิเวอร์`, `เป๊บซี่ / โค๊ก /แฟนต้า/มิรินด้า`) | |
| `sup_address` | VARCHAR | ที่อยู่ (สั้น เช่น `เชียงราย`) | |
| `sup_phone` | VARCHAR | โทรศัพท์ | |
| `sup_fax` | VARCHAR | แฟกซ์ | ว่างทั้งหมด |
| `sup_email` | VARCHAR | อีเมล | ว่างทั้งหมด |

ตัวอย่าง: `{"sup_id":"0001","sup_name":"ร้านคงการค้า","sup_address":"เชียงราย","sup_phone":"0864309858","sup_fax":"","sup_email":""}`

รายชื่อทั้งหมดอยู่ใน §10.4

### 4.7 `customer` — สมาชิก/ลูกค้า (1,040 แถว)

| คอลัมน์ | ODBC type | ความหมาย | ค่า / หมายเหตุ |
|---|---|---|---|
| `cust_id` | VARCHAR | PK รหัสสมาชิก free-form 1–13 ตัวอักษร | `0` = ไม่ระบุ (walk-in); มักมาจากบ้านเลขที่ เช่น `101011191011`; มีตัวอักษรได้ เช่น `Wat kang` |
| `cust_name` | VARCHAR | ชื่อ (มีคำนำหน้า) | `0` → `ไม่ระบุ` |
| `cust_address` | VARCHAR | ที่อยู่ (มักสั้น `ม.1`) | |
| `cust_phone` | VARCHAR | โทรศัพท์ | มีค่าเพียง 3 แถว (`110119`, `11111`, `174`) |
| `cust_fax` | VARCHAR | แฟกซ์ | ว่าง |
| `cust_email` | VARCHAR | อีเมล | ว่างทั้งหมด |
| `cust_pricelevel` | VARCHAR | ระดับราคา 0–4 | `0` ทุกแถว |
| `cust_hunmoney` | DOUBLE | **ทุนเรือนหุ้น (share capital) หน่วยบาท** | 348 แถว > 0, Σ = ฿512,220, max ฿10,250, min ฿20; ทุกค่าเป็นพหุคูณของ 50 ยกเว้น 1 แถว (฿20) |
| `cust_datestart` | DATETIME | วันที่สมัครสมาชิก | 968 แถวมีค่า 2016-01-17 → 2023-02-05 |

ตัวอย่างแถว:

```json
{"cust_id":"0","cust_name":"ไม่ระบุ","cust_address":null,"cust_phone":null,"cust_fax":null,"cust_email":null,"cust_pricelevel":"0","cust_hunmoney":0,"cust_datestart":null}
{"cust_id":"00001","cust_name":"เทศบาลบุญเรือง","cust_address":"","cust_phone":"","cust_fax":"","cust_email":"","cust_pricelevel":"0","cust_hunmoney":0,"cust_datestart":"2022-08-17T00:00:00"}
{"cust_id":"91014","cust_name":"นายอำนาจ ไชยราช","cust_address":"ม.1","cust_phone":"","cust_fax":"","cust_email":"","cust_pricelevel":"0","cust_hunmoney":10050,"cust_datestart":"2017-01-16T00:00:00"}
```

Quirks: `cust_id` `ต100` ถูกอ้างจาก `buymain` แต่ไม่มีในตารางนี้ (ต้องสร้าง placeholder); ไม่มีประวัติการเพิ่ม/ถอนหุ้น มีแต่ยอดคงเหลือปัจจุบัน; หุ้น 1 หุ้น = ฿50 (ดู §5)

### 4.8 `typepayments` — วิธีชำระเงิน (4 แถว)

| `buy_type` | `buy_typename` | ใช้จริงใน `buymain` | enum ใหม่ |
|---|---|---|---|
| `1` | เงินสด | 224,521 บิล | `cash` |
| `2` | ลูกหนี้ (ขายเชื่อสมาชิก) | 7,250 บิล | `credit` |
| `3` | เงินโอน | 0 บิล | `transfer` |
| `4` | บัตรเครดิต | 3 บิล | `card` |

### 4.9 `buymain` — หัวบิลขาย (231,774 แถว) — **ไม่มี primary key**

| คอลัมน์ | ODBC type | ความหมาย | ค่า / หมายเหตุ |
|---|---|---|---|
| `buy_id` | VARCHAR | เลขที่บิล `N{BEyy}{MM}-{seq5}` | non-unique index; **ซ้ำ 632 เลข** (ดู §6.1) |
| `buy_date` | DATETIME | วันที่ขาย (เวลาเป็น 00:00:00 เสมอ) | 2020-01-01 → 2023-02-28 |
| `buy_pricesum` | DOUBLE | ยอดก่อน VAT | **0 ทุกแถว** (ไม่ใช้) |
| `buy_pricevat` | DOUBLE | VAT | **0 ทุกแถว** |
| `buy_pricetotal` | DOUBLE | ยอดรวมก่อนส่วนลด (gross) = Σ `buydetails.buy_sumprice` | |
| `buy_pricediscount` | DOUBLE | ส่วนลดรวม = Σ `buydetails.buy_discount` | |
| `buy_buytotal` | DOUBLE | **ยอดสุทธิ (net)** = pricetotal − pricediscount | ใช้กระทบยอด |
| `buy_type` | VARCHAR | วิธีชำระ → `typepayments` | `1` เงินสด / `2` ลูกหนี้ / `3` โอน / `4` บัตร |
| `buy_debtorstatus` | VARCHAR | สถานะลูกหนี้ `1` = ยังไม่ชำระ/ไม่ใช่บิลเชื่อ, `2` = ชำระครบแล้ว | บิลเงินสดก็เป็น `1` — ต้องดูร่วมกับ `buy_type = 2` |
| `buy_debtortotal` | DOUBLE | ยอดหนี้ตั้งต้นของบิลเชื่อ (= buy_buytotal เมื่อ type 2) | 0 สำหรับบิลเงินสด |
| `buy_debtorpaid` | DOUBLE | ยอดที่ชำระแล้วสะสม | |
| `buy_debtorpayable` | DOUBLE | ยอดค้างชำระ = debtortotal − debtorpaid | ค้างรวมปัจจุบัน 238 บิล ฿40,886 |
| `user_user` | VARCHAR | แคชเชียร์ (FK → `usersys.user_user`) | |
| `buy_status` | VARCHAR | `1` = ปกติ (230,797), `3` = ยกเลิก (977) | ไม่มีค่า `2` |
| `cust_id` | VARCHAR | สมาชิก (FK → `customer`; `0` = walk-in) | non-unique index; `ต100` ไม่มีใน customer |
| `buy_cancel_user` | VARCHAR | ผู้ยกเลิก | มีค่าเมื่อ status 3 |
| `buy_cancel_time` | VARCHAR | เวลายกเลิก **ข้อความ พ.ศ.** `d/M/BEyyyy  H:mm:ss` | เช่น `1/1/2563  12:15:17` (เว้นวรรค 2 ช่อง) |
| `buy_moneyinput` | DOUBLE | เงินที่รับมา (tendered) | 0 สำหรับบิลเชื่อ/บัตร |
| `buy_moneyreturn` | DOUBLE | เงินทอน (change) | |
| `buy_timesale` | VARCHAR | เวลาขาย **ข้อความ** `H:mm` | เช่น `6:27`; รวมกับ `buy_date` เป็น `sold_at` |
| `buy_closeofday` | VARCHAR | ปิดยอดแล้วหรือไม่ | NULL ทุกแถว |
| `buy_closeofdayuser` | VARCHAR | ผู้ปิดยอด | NULL ทุกแถว |
| `buy_closeofdaytime` | VARCHAR | เวลาปิดยอด | NULL ทุกแถว |
| `buy_comment` | VARCHAR | หมายเหตุ | `""` หรือ NULL ทุกแถว |

ตัวอย่างแถว (บิลเงินสดปกติ, บิลยกเลิก, บิลเชื่อชำระแล้ว, บิลเชื่อค้าง+ยกเลิก, บิลบัตร):

```json
{"buy_id":"N6301-00001","buy_date":"2020-01-01T00:00:00","buy_pricesum":0,"buy_pricevat":0,"buy_pricetotal":10,"buy_pricediscount":0,"buy_buytotal":10,"buy_type":"1","buy_debtorstatus":"1","buy_debtortotal":0,"buy_debtorpaid":0,"buy_debtorpayable":0,"user_user":"yp","buy_status":"1","cust_id":"101011831011","buy_cancel_user":null,"buy_cancel_time":null,"buy_moneyinput":10,"buy_moneyreturn":0,"buy_timesale":"6:27","buy_closeofday":null,"buy_closeofdayuser":null,"buy_closeofdaytime":null,"buy_comment":""}
{"buy_id":"N6301-00043","buy_date":"2020-01-01T00:00:00","buy_pricesum":0,"buy_pricevat":0,"buy_pricetotal":170,"buy_pricediscount":0,"buy_buytotal":170,"buy_type":"1","buy_debtorstatus":"1","buy_debtortotal":0,"buy_debtorpaid":0,"buy_debtorpayable":0,"user_user":"yp","buy_status":"3","cust_id":"491012","buy_cancel_user":"chien","buy_cancel_time":"1/1/2563  12:15:17","buy_moneyinput":500,"buy_moneyreturn":330,"buy_timesale":"9:08","buy_closeofday":null,"buy_closeofdayuser":null,"buy_closeofdaytime":null,"buy_comment":""}
{"buy_id":"N6301-00008","buy_date":"2020-01-01T00:00:00","buy_pricesum":0,"buy_pricevat":0,"buy_pricetotal":726,"buy_pricediscount":6,"buy_buytotal":720,"buy_type":"2","buy_debtorstatus":"2","buy_debtortotal":720,"buy_debtorpaid":720,"buy_debtorpayable":0,"user_user":"yp","buy_status":"1","cust_id":"1301012","buy_cancel_user":null,"buy_cancel_time":null,"buy_moneyinput":0,"buy_moneyreturn":0,"buy_timesale":"7:11","buy_closeofday":null,"buy_closeofdayuser":null,"buy_closeofdaytime":null,"buy_comment":""}
{"buy_id":"N6301-00060","buy_date":"2020-01-01T00:00:00","buy_pricesum":0,"buy_pricevat":0,"buy_pricetotal":820,"buy_pricediscount":0,"buy_buytotal":820,"buy_type":"2","buy_debtorstatus":"1","buy_debtortotal":820,"buy_debtorpaid":0,"buy_debtorpayable":820,"user_user":"yp","buy_status":"3","cust_id":"911012","buy_cancel_user":"admin","buy_cancel_time":"2/1/2563  14:42:36","buy_moneyinput":0,"buy_moneyreturn":0,"buy_timesale":"9:56","buy_closeofday":null,"buy_closeofdayuser":null,"buy_closeofdaytime":null,"buy_comment":""}
{"buy_id":"N6403-01298","buy_date":"2021-03-07T00:00:00","buy_pricesum":0,"buy_pricevat":0,"buy_pricetotal":397,"buy_pricediscount":0,"buy_buytotal":397,"buy_type":"4","buy_debtorstatus":"1","buy_debtortotal":0,"buy_debtorpaid":0,"buy_debtorpayable":0,"user_user":"yp","buy_status":"1","cust_id":"101011731012","buy_cancel_user":null,"buy_cancel_time":null,"buy_moneyinput":0,"buy_moneyreturn":0,"buy_timesale":"10:00","buy_closeofday":null,"buy_closeofdayuser":null,"buy_closeofdaytime":null,"buy_comment":""}
```

Quirks:

- บิลที่ยกเลิก (status 3) **ยังคงยอดเงินไว้** — รายงานยอดขายต้องกรอง `buy_status = '1'` เสมอ; บิลเชื่อที่ถูกยกเลิกยังมี `buy_debtorpayable` > 0 ค้างอยู่ (เช่น N6301-00060) — ตอน migrate ให้ `ar_status = none` เมื่อ status = cancelled
- ยอดขายที่ใช้คำนวณเฉลี่ยคืนปันผลใช้ `buy_buytotal` ของ status 1 ทั้งปี รวม walk-in (`cust_id = 0`) ด้วย
- ไม่มี autonumber → ลำดับแถวใน dump คือลำดับ physical ของ Access (โดยทั่วไปตามเวลาที่บันทึก)

### 4.10 `buydetails` — รายการในบิลขาย (585,778 แถว) — **ไม่มี primary key**

| คอลัมน์ | ODBC type | ความหมาย | ค่า / หมายเหตุ |
|---|---|---|---|
| `ID` | COUNTER | autonumber (ไม่ได้ตั้งเป็น PK) ใช้ `ORDER BY ID` ใน dump | ค่าเริ่ม 248,591 (แถวก่อนหน้าถูกลบไปพร้อมบิลก่อน 2020) |
| `buy_id` | VARCHAR | เลขที่บิล → `buymain.buy_id` | 25 แถว orphan (ไม่มีหัวบิล) |
| `pro_id` | VARCHAR | รหัสสินค้า → `product.pro_id` | 7,939 แถว / 121 รหัส ไม่มีใน product |
| `buy_costprice` | DOUBLE | snapshot ต้นทุนล่าสุด ณ เวลาขาย | |
| `buy_costpriceavg` | DOUBLE | snapshot ต้นทุนถัวเฉลี่ย ณ เวลาขาย | ใช้คำนวณกำไรขั้นต้นย้อนหลังได้ |
| `buy_buyprice` | DOUBLE | ราคาขายต่อหน่วย | 0 เมื่อเป็นของแถม |
| `buy_number` | DOUBLE | จำนวน (เป็นจำนวนเต็มเสมอ) | ติดลบ 1 แถว (`ID` 714463, −30) |
| `buy_sumprice` | DOUBLE | = buy_buyprice × buy_number (ก่อนหักส่วนลด) | |
| `buy_rownumber` | INTEGER | ลำดับบรรทัด 1..n ในบิล | รีเซ็ตเป็น 1 เมื่อขึ้นบิลใหม่ — ใช้แยกบิลซ้ำ |
| `buy_freestatus` | VARCHAR | `0` ปกติ / `1` ของแถม (free item) | `1` เพียง 1 แถว |
| `buy_serialnumber` | VARCHAR | serial number ที่บันทึกตอนขาย | มีค่า 111 แถว (มักเท่ากับบาร์โค้ด) |
| `buy_discount` | DOUBLE | ส่วนลดบรรทัด (บาท ไม่ใช่ %) | > 0 จำนวน 8,929 แถว; บางแถว NULL |

ตัวอย่างแถว (ปกติ, มีส่วนลด, ของแถม, serial, จำนวนติดลบ):

```json
{"ID":248591,"buy_id":"N6301-00001","pro_id":"8850999321004","buy_costprice":4.16,"buy_costpriceavg":4.26315789473684,"buy_buyprice":10,"buy_number":1,"buy_sumprice":10,"buy_rownumber":1,"buy_freestatus":"0","buy_serialnumber":"","buy_discount":0}
{"ID":248606,"buy_id":"N6301-00008","pro_id":"8850124034519","buy_costprice":2.8888,"buy_costpriceavg":2.88877774843563,"buy_buyprice":4,"buy_number":9,"buy_sumprice":36,"buy_rownumber":3,"buy_freestatus":"0","buy_serialnumber":"","buy_discount":6}
{"ID":341827,"buy_id":"N6306-06468","pro_id":"8850250011217","buy_costprice":25.875,"buy_costpriceavg":25.875,"buy_buyprice":0,"buy_number":1,"buy_sumprice":0,"buy_rownumber":3,"buy_freestatus":"1","buy_serialnumber":"","buy_discount":0}
{"ID":526904,"buy_id":"N6405-02436","pro_id":"8852023664750","buy_costprice":16,"buy_costpriceavg":16,"buy_buyprice":20,"buy_number":1,"buy_sumprice":20,"buy_rownumber":1,"buy_freestatus":"0","buy_serialnumber":"8852023664750","buy_discount":0}
{"ID":714463,"buy_id":"N6506-00554","pro_id":"000004","buy_costprice":3.9333,"buy_costpriceavg":3.9333,"buy_buyprice":4,"buy_number":-30,"buy_sumprice":120,"buy_rownumber":1,"buy_freestatus":"0","buy_serialnumber":"","buy_discount":null}
```

Quirks: `line_total` ที่แท้จริง = `buy_sumprice − buy_discount`; แถวจำนวนติดลบมี `buy_sumprice` เป็นบวก (120) — migrate ตามค่าเดิมและ flag ใน report; `buy_serialnumber` มีทั้ง `""` และ NULL

### 4.11 `payments` — รับชำระลูกหนี้ (10,351 แถว)

| คอลัมน์ | ODBC type | ความหมาย | หมายเหตุ |
|---|---|---|---|
| `payment_id` | COUNTER | PK (1 → 10,382 มีช่องว่าง) | |
| `buy_id` | VARCHAR | บิลเชื่อที่ชำระ → `buymain.buy_id` | 2,776 แถวอ้างบิลที่ไม่มี (ก่อน 2020) |
| `payment_date` | DATETIME | วันที่ชำระ (เวลา 00:00:00) | 2018-11-11 → 2023-02-28 |
| `cust_id` | VARCHAR | สมาชิก → `customer` | |
| `payment_debsum` | DOUBLE | ยอดหนี้ตั้งต้นของบิล (bill total) | = `buymain.buy_debtortotal` |
| `payment_debremain` | DOUBLE | ยอดค้าง **ก่อน** ชำระครั้งนี้ (balance before) | |
| `payment_pay` | DOUBLE | ยอดชำระครั้งนี้ | Σ ทั้งตาราง = ฿1,965,259 |
| `payment_total` | DOUBLE | ยอดค้าง **หลัง** ชำระ (balance after) = debremain − pay | > 0 = ชำระบางส่วน |
| `user_user` | VARCHAR | ผู้รับชำระ | |
| `payment_datetime` | VARCHAR | เวลาชำระ ข้อความ พ.ศ. `d/M/BEyyyy  H:mm:ss` | ใช้เป็น `paid_at` (แม่นกว่า payment_date) |

ตัวอย่างแถว (ชำระเต็ม, ชำระบางส่วน, แถวล่าสุด):

```json
{"payment_id":1,"buy_id":"N6111-00018","payment_date":"2018-11-11T00:00:00","cust_id":"911012","payment_debsum":520,"payment_debremain":520,"payment_pay":520,"payment_total":0,"user_user":"chien","payment_datetime":"11/11/2561  9:39:59"}
{"payment_id":101,"buy_id":"N6112-00676","payment_date":"2018-12-04T00:00:00","cust_id":"222","payment_debsum":596,"payment_debremain":596,"payment_pay":569,"payment_total":27,"user_user":"yp","payment_datetime":"4/12/2561  7:13:04"}
{"payment_id":10382,"buy_id":"N6602-04898","payment_date":"2023-02-28T00:00:00","cust_id":"10101229","payment_debsum":70,"payment_debremain":20,"payment_pay":20,"payment_total":0,"user_user":"yp","payment_datetime":"28/2/2566  18:04:57"}
```

Quirks: 1 บิลชำระได้หลายครั้ง (partial payments) — ห้ามใช้ `buy_id` เป็น unique; ไม่มีคอลัมน์วิธีชำระ (ถือว่าเงินสด)

### 4.12 `ordermain` — หัวใบรับสินค้า (4,256 แถว)

| คอลัมน์ | ODBC type | ความหมาย | หมายเหตุ |
|---|---|---|---|
| `order_id` | VARCHAR | PK `OD{BEyy}{MM}-{seq5}` | |
| `sup_id` | VARCHAR | ผู้จำหน่าย → `supplier` | `0` (ไม่ระบุ) 2,868 แถว |
| `order_date` | DATETIME | วันที่รับสินค้า | 2018-11-11 → 2023-02-27 |
| `order_pricesum` | DOUBLE | ยอดก่อน VAT | **0 ทุกแถว** |
| `order_pricevat` | DOUBLE | VAT | **0 ทุกแถว** |
| `order_pricetotal` | DOUBLE | ยอดรวม = Σ `orderdetails.order_sumprice` | Σ ทั้งตาราง = ฿8,924,959.33 |
| `user_user` | VARCHAR | ผู้บันทึก | yp 2,483 · อนันทร์ 866 · admin 574 · chien 272 · ยุพิน 61 |

ตัวอย่าง: `{"order_id":"OD6111-00001","sup_id":"0","order_date":"2018-11-11T00:00:00","order_pricesum":0,"order_pricevat":0,"order_pricetotal":160.16,"user_user":"chien"}`

Quirks: ไม่มีคอลัมน์สถานะ (ทุกใบถือว่า posted แล้ว); ไม่มีเลขที่ใบส่งของ supplier; ไม่มีเวลา

### 4.13 `orderdetails` — รายการในใบรับสินค้า (18,759 แถว)

| คอลัมน์ | ODBC type | ความหมาย | หมายเหตุ |
|---|---|---|---|
| `id` | COUNTER | PK | |
| `order_id` | VARCHAR | → `ordermain.order_id` | 368 แถว orphan |
| `pro_id` | VARCHAR | → `product.pro_id` | |
| `order_costprice` | DOUBLE | ต้นทุนต่อหน่วย | ใช้อัปเดต `pro_costprice`/`pro_costpriceavg` |
| `order_number` | DOUBLE | จำนวนรับ | |
| `order_sumprice` | DOUBLE | = costprice × number | |

ตัวอย่าง: `{"id":1,"order_id":"OD6111-00001","pro_id":"8850124065414","order_costprice":22.88,"order_number":7,"order_sumprice":160.16}`

### 4.14 `expenses` — ค่าใช้จ่าย (57 แถว)

| คอลัมน์ | ODBC type | ความหมาย | หมายเหตุ |
|---|---|---|---|
| `expen_id` | COUNTER | PK (เริ่ม 2) | |
| `expen_date` | DATETIME | วันที่ | 2018-11-14 → 2022-12-31 |
| `type_id` | VARCHAR | → `expenses_type.type_id` | `1` 54 แถว, `00001`/`00002`/`00003` อย่างละ 1 |
| `expen_detail` | LONGCHAR | รายละเอียด (memo, มี `\r\n`) | |
| `expen_total` | DOUBLE | จำนวนเงิน | Σ = ฿1,842,684 (type 1 = ฿1,839,803) |
| `user_user` | VARCHAR | ผู้บันทึก | |

ตัวอย่าง:

```json
{"expen_id":4,"expen_date":"2018-11-14T00:00:00","type_id":"00003","expen_detail":"หมีโคล่า 396\r\nไดโนเสาร์ 190","expen_total":586,"user_user":"admin"}
{"expen_id":5,"expen_date":"2019-01-31T00:00:00","type_id":"1","expen_detail":"","expen_total":27872,"user_user":"chien"}
```

Quirks: หลังปี 2018 ร้านบันทึกเป็น **ยอดรวมรายเดือน 1 แถว/เดือน** (type `1` รายจ่ายรวมประจำเดือน, ลงวันที่สิ้นเดือน) ไม่มีรายละเอียด — ไม่สามารถวิเคราะห์ค่าใช้จ่ายรายประเภทย้อนหลังได้

### 4.15 `expenses_type` — ประเภทค่าใช้จ่าย (7 แถว)

| `type_id` | `expen_type` | ใช้ใน expenses |
|---|---|---|
| `00001` | น้ำแข็ง | 1 |
| `00002` | แก๊ส | 1 |
| `00003` | ขนม | 1 |
| `1` | รายจ่ายรวมประจำเดือน | 54 |
| `2` | รายจ่ายประจำวัน | 0 |
| `3` | อาหาร | 0 |
| `4` | ของใช้ | 0 |

### 4.16 `criteriondividend` — เกณฑ์ปันผลรายปี (45 แถว)

| คอลัมน์ | ODBC type | ความหมาย | ค่า / หมายเหตุ |
|---|---|---|---|
| `criteriondividend_id` | COUNTER | PK (166 → 213 มีช่องว่าง) | |
| `criteriondividend_year` | VARCHAR | ปี พ.ศ. | `2559`…`2566` |
| `criteriondividend_name` | VARCHAR | ชื่อเกณฑ์/รายการจัดสรร | มีสะกดหลายแบบ (`ทุนสำลอง`/`ทุนสำรอง`, `สาธารณะ`/`สาธารณะประโยชน์`/`สาารณะประโยชน์`) |
| `criteriondividend_percent` | DOUBLE | **type 1**: จำนวนบาทต่อ 1 หุ้น (50 หรือ 100) · **type 2**: % ของกำไรสุทธิ | |
| `criteriondividend_type` | VARCHAR | `1` = เกณฑ์หุ้น (share rule, 1 แถว/ปี) · `2` = รายการจัดสรรกำไร (allocation) | |
| `criteriondividend_maxhun` | DOUBLE | type 1: จำนวนหุ้นสูงสุดต่อสมาชิก (cap) | **ไม่ถูกบังคับใช้ในข้อมูลจริง** (ดู §5) |
| `criteriondividend_fixnoedit` | VARCHAR | `NOTDEL` = แถวระบบ ลบไม่ได้ (HUN/AVG) · `EDIT` = แก้ไข/ลบได้ | |
| `criteriondividend_typepercent` | VARCHAR | type 2: `HUN` = กองปันหุ้น · `AVG` = กองเฉลี่ยคืน · NULL = รายการอื่น (ทุนสำรอง, กรรมการ, สาธารณะ) | |

ตัวอย่างแถว (ปี 2565 ครบชุด):

```json
{"criteriondividend_id":181,"criteriondividend_year":"2565","criteriondividend_name":"เกณฑ์หุ้น","criteriondividend_percent":50,"criteriondividend_type":"1","criteriondividend_maxhun":40,"criteriondividend_fixnoedit":"EDIT","criteriondividend_typepercent":null}
{"criteriondividend_id":182,"criteriondividend_year":"2565","criteriondividend_name":"ปันหุ้นร้อยละ","criteriondividend_percent":25,"criteriondividend_type":"2","criteriondividend_maxhun":null,"criteriondividend_fixnoedit":"NOTDEL","criteriondividend_typepercent":"HUN"}
{"criteriondividend_id":183,"criteriondividend_year":"2565","criteriondividend_name":"เฉลี่ยคืนร้อยละ","criteriondividend_percent":25,"criteriondividend_type":"2","criteriondividend_maxhun":null,"criteriondividend_fixnoedit":"NOTDEL","criteriondividend_typepercent":"AVG"}
{"criteriondividend_id":208,"criteriondividend_year":"2565","criteriondividend_name":"ทุนสำลอง","criteriondividend_percent":30,"criteriondividend_type":"2","criteriondividend_maxhun":null,"criteriondividend_fixnoedit":"EDIT","criteriondividend_typepercent":null}
{"criteriondividend_id":209,"criteriondividend_year":"2565","criteriondividend_name":"สาธารณะประโยชน์","criteriondividend_percent":10,"criteriondividend_type":"2","criteriondividend_maxhun":null,"criteriondividend_fixnoedit":"EDIT","criteriondividend_typepercent":null}
{"criteriondividend_id":210,"criteriondividend_year":"2565","criteriondividend_name":"ตอบแทนคณะกรรมการ","criteriondividend_percent":10,"criteriondividend_type":"2","criteriondividend_maxhun":null,"criteriondividend_fixnoedit":"EDIT","criteriondividend_typepercent":null}
```

สรุปต่อปี (type 2 รวม 100 % ทุกปี):

| ปี พ.ศ. | แถว | บาท/หุ้น (type 1 percent) | maxhun | HUN % | AVG % | รายการอื่น (ชื่อ %) |
|---|---|---|---|---|---|---|
| 2559 | 6 | 100 | 50 | 20 | 30 | ผลตอบแทนกรรมการ 20, บำรุงสหกรณ์ 15, หุ้นสหกรณ์ 15 |
| 2560 | 3 | 100 | 100 | 40 | 60 | — |
| 2561 | 6 | 50 | 20 | 30 | 30 | ตอบแทนกรรมการ 10, สมทบทุนร้านค้า 20, สาธารณะ 10 |
| 2562 | 6 | 50 | 40 | 25 | 25 | 1.ตอบแทนคณะกรรการ 10, ทุนสำลอง 30, สาธารณะประโยชน์ 10 |
| 2563 | 6 | 50 | 250 | 25 | 25 | สาธารณะ 10, ทุนสำลอง 30, ตอบแทนคณะกรรมการ 10 |
| 2564 | 6 | 100 | 200 | 25 | 25 | ทุนสำรอง 30, สาธารณะ 10, ตอบแทนกรรมการ 10 |
| 2565 | 6 | 50 | 40 | 25 | 25 | ทุนสำลอง 30, สาธารณะประโยชน์ 10, ตอบแทนคณะกรรมการ 10 |
| 2566 | 6 | 100 | 100 | 25 | 25 | ทุนสำลอง 30, สาารณะประโยชน์ 10, ตอบแทนกรรมการ 10 |

### 4.17 `temps` — ผลจัดสรรกำไรครั้งล่าสุด (5 แถว, scratch)

| คอลัมน์ | ODBC type | ความหมาย |
|---|---|---|
| `id` | COUNTER | 9–13 |
| `temp1` | VARCHAR | ลำดับ 1–5 |
| `temp2` | VARCHAR | ชื่อรายการจัดสรร (= `criteriondividend_name`) |
| `temp3`, `temp4`, `temp5` | VARCHAR | ไม่ใช้ (NULL) |
| `temp6` | DOUBLE | % |
| `temp7` | DOUBLE | จำนวนเงิน = กำไรสุทธิ × % |

ค่าทั้งหมด: ปันหุ้นร้อยละ 25 → 117,946.25 · เฉลี่ยคืนร้อยละ 25 → 117,946.25 · 1.ตอบแทนคณะกรรการ 10 → 47,178.5 · ทุนสำลอง 30 → 141,535.5 · สาธารณะประโยชน์ 10 → 47,178.5 ⇒ กำไรสุทธิที่ใช้ = **฿471,785**

Quirk สำคัญ: ตัวเลขนี้ **ไม่ตรง** กับใบแจ้งปันผลใน `temps2` (ซึ่งคำนวณจากกำไร ≈ ฿409,826) — `temps` เป็นแค่ผลการกดคำนวณครั้งหลังสุดบนหน้าจอ (อาจเป็นการทดลองตัวเลขปี 2565 อีกรอบ หรือปี 2566) ไม่ใช่ค่าที่อนุมัติ ใช้อ้างอิงเท่านั้น

### 4.18 `temps2` — ใบแจ้งปันผลรายสมาชิก พ.ศ. 2565 (1,035 แถว) และ `temps3` (สำเนา)

| คอลัมน์ | ODBC type | ความหมายจริง | หมายเหตุ |
|---|---|---|---|
| `id` | COUNTER | PK (22770 → 23804) | |
| `tempstr1` | VARCHAR | ลำดับที่ (seq) 1–1035 | |
| `tempstr2` | VARCHAR | ปี พ.ศ. | `2565` ทุกแถว |
| `tempstr3` | VARCHAR | รหัสสมาชิก (`cust_id`) | รวม `0` ไม่ระบุ |
| `tempstr4` | VARCHAR | ชื่อสมาชิก | |
| `tempstr5` | VARCHAR | ที่อยู่ | |
| `tempstr6`, `tempstr7` | VARCHAR | ไม่ใช้ (NULL ทุกแถว) | |
| `tempint1` | DOUBLE | **จำนวนหุ้น** = `cust_hunmoney` ÷ 50 (มีเศษทศนิยมได้) | Σ = 10,244.4 |
| `tempint2` | DOUBLE | **ยอดซื้อทั้งปี** (Σ `buy_buytotal` status 1 ปี 2022) | Σ = 5,647,465 |
| `tempint3` | DOUBLE | **เงินปันผลตามหุ้น** (share dividend) | Σ = 102,456.4 |
| `tempint4` | DOUBLE | **เงินเฉลี่ยคืน** (purchase rebate) | Σ = 102,456.6 |
| `tempint5` | DOUBLE | รวม = tempint3 + tempint4 | Σ = 204,913.0 |

ตัวอย่างแถว:

```json
{"id":22770,"tempstr1":"1","tempstr2":"2565","tempstr3":"0","tempstr4":"ไม่ระบุ","tempstr5":"","tempstr6":null,"tempstr7":null,"tempint1":0,"tempint2":289635,"tempint3":0,"tempint4":5254.57,"tempint5":5254.57}
{"id":23783,"tempstr1":"1014","tempstr2":"2565","tempstr3":"91014","tempstr4":"นายอำนาจ ไชยราช","tempstr5":"ม.1","tempstr6":null,"tempstr7":null,"tempint1":201,"tempint2":34429,"tempint3":2010.25,"tempint4":624.61,"tempint5":2634.86}
{"id":23804,"tempstr1":"1035","tempstr2":"2565","tempstr3":"Wat kang","tempstr4":"วัดบุญเรืองเหนือ  ","tempstr5":"","tempstr6":null,"tempstr7":null,"tempint1":0,"tempint2":7466,"tempint3":0,"tempint4":135.45,"tempint5":135.45}
```

Quirks: มีแถวของ walk-in (`0`) ที่ได้เฉลี่ยคืน ฿5,254.57 จากยอดซื้อ ฿289,635 — โปรแกรมเดิมไม่ได้แยก walk-in ออก (ระบบใหม่คงพฤติกรรมนี้ในตัวหาร แต่ควรให้ตัวเลือกไม่จ่ายให้ walk-in); 1,035 แถว < 1,040 สมาชิก (สมาชิกที่สมัครหลังคำนวณไม่อยู่ในรายการ); `temps3` มีข้อมูลเหมือน `temps2` ทุกแถว

### 4.19 `chartmonth` — cache กราฟยอดขายรายเดือน (24 แถว)

| คอลัมน์ | ODBC type | ความหมาย |
|---|---|---|
| `chart_id` | COUNTER | PK |
| `chart_year` | VARCHAR | ปี พ.ศ. (`2562`, `2565`) |
| `chart_monthindex` | VARCHAR | ดัชนีเดือน `0`–`11` (0 = มกราคม) |
| `chart_month` | VARCHAR | ชื่อเดือนภาษาไทย |
| `chart_type` | VARCHAR | `SALE` |
| `chart_typename` | VARCHAR | `สรุปยอดขายสินค้า` |
| `chart_value` | DOUBLE | ยอดขายเดือนนั้น (บาท) |

ค่าปี 2562: 514,011 · 479,175 · 539,913 · 703,252 · 680,667 · 626,571 · 491,572 · 470,684 · 498,352 · 165,638 · 0 · 0 (ต.ค. ไม่ครบเดือน, พ.ย.–ธ.ค. ยังไม่คำนวณ)
ค่าปี 2565: 441,656 · 433,782 · 506,846 · 651,048 · 474,828 · 500,776 · 445,808 · 416,874 · 421,699 · 371,673 · 0 · 0

ตัวอย่าง: `{"chart_id":1,"chart_year":"2562","chart_monthindex":"0","chart_month":"มกราคม","chart_type":"SALE","chart_typename":"สรุปยอดขายสินค้า","chart_value":514011}`

Quirks: ค่าปี 2562 เป็นหลักฐานเดียวที่เหลือของยอดขายปี 2019 (บิลถูกลบไปแล้ว); ไม่ migrate — ระบบใหม่คำนวณจาก `sales` ผ่าน `monthly_sales_mv`

### 4.20 `logopencashdrawer` — log เปิดลิ้นชัก (10,637 แถว)

| คอลัมน์ | ODBC type | ความหมาย |
|---|---|---|
| `log_id` | COUNTER | PK 1–10,637 |
| `log_date` | DATETIME | วันที่ (00:00:00) |
| `log_time` | VARCHAR | เวลา `H:mm:ss` |
| `log_user` | VARCHAR | username |
| `log_name` | VARCHAR | ชื่อแสดงของผู้ใช้ ณ เวลานั้น |

ตัวอย่าง: `{"log_id":1,"log_date":"2018-11-10T00:00:00","log_time":"20:34:28","log_user":"admin","log_name":"Administrator"}` … แถวสุดท้าย `{"log_id":10637,"log_date":"2022-12-05T00:00:00","log_time":"13:27:51","log_user":"admin","log_name":"Administrator"}`

จำนวนต่อผู้ใช้: yp 4,738 · อนันทร์ 2,784 · admin 2,463 · chananuch 552 · chien 66 · ยุพิน 34. ไม่มีเหตุผล/จำนวนเงิน (ระบบใหม่ใช้ `reason = no_sale` สำหรับแถว legacy)

### 4.21 `saletoday` — เปิด/ปิดกะ (0 แถว, ไม่เคยใช้)

| คอลัมน์ | ODBC type | ความหมายที่ออกแบบไว้ |
|---|---|---|
| `saletoday_id` | COUNTER | PK |
| `saletoday_date` | DATETIME | วันที่ |
| `saletoday_open_time` | VARCHAR | เวลาเปิด |
| `saletoday_open_user` | VARCHAR | ผู้เปิด |
| `saletoday_staus` (sic) | VARCHAR | สถานะ |
| `saletoday_close_time` | VARCHAR | เวลาปิด |
| `saletoday_close_user` | VARCHAR | ผู้ปิด |

### 4.22 `promotionbill` / `promotionproduct` — โปรโมชัน (0 แถว, ไม่เคยใช้)

| คอลัมน์ | ODBC type | ความหมายที่ออกแบบไว้ |
|---|---|---|
| `pm_id` | COUNTER | PK |
| `pro_id` | VARCHAR | (เฉพาะ promotionproduct) สินค้าที่ร่วมรายการ |
| `pm_number` | INTEGER | ลำดับ/จำนวน |
| `pm_comment` | VARCHAR | ชื่อ/คำอธิบาย |
| `pm_formattype` | VARCHAR | รูปแบบโปรโมชัน |
| `pm_condition` | VARCHAR | เงื่อนไข |
| `pm_count` | DOUBLE | จำนวนขั้นต่ำ / ยอดขั้นต่ำ |
| `pm_type` | VARCHAR | ชนิดส่วนลด (เงิน/เปอร์เซ็นต์) |
| `pm_typemoney` | DOUBLE | ส่วนลดเป็นเงิน |
| `pm_typepercent` | DOUBLE | ส่วนลดเป็น % |
| `pm_datestart` | DATETIME | วันเริ่ม |
| `pm_datestop` | DATETIME | วันสิ้นสุด |

### 4.23 `barcodeforms` — แม่แบบฉลากบาร์โค้ด (5 แถว)

| คอลัมน์ | ODBC type | ความหมาย | หมายเหตุ |
|---|---|---|---|
| `id` | INTEGER | ลำดับ 1–5 | |
| `barcodeform_id` | VARCHAR | รหัสแม่แบบ `A4-Blank`, `A5`, `A7`, `A9`, `A10` | |
| `barcodeform_name` | VARCHAR | ชื่อ เช่น `(A4) 25x50mm ไม่มีช่อง 4 คอลัมน์ 11 แถว` | |
| `barcodeform_columns` | DOUBLE | จำนวนคอลัมน์ | 3–4 |
| `barcodeform_rows` | DOUBLE | จำนวนแถว | 8–14 |
| `barcodeform_pageleft`, `_pagetop`, `_pagewidth` | DOUBLE | ตำแหน่ง/ความกว้างหน้า หน่วย **twips** (1 mm ≈ 56.7 twips) | |
| `barcodeform_barwidth`, `_barheight` | DOUBLE | ขนาดฉลาก (twips) เช่น 2835 × 1417 = 50 × 25 mm | |
| `barcodeform_margintop`, `_marginbuttom` (sic), `_marginleft`, `_marginright` | DOUBLE | ระยะขอบ (twips) | |
| `barcodeform_fontsize_barcode`, `_proid`, `_proname`, `_proprice` | VARCHAR | ขนาดฟอนต์ (pt เป็นข้อความ) | |
| `barcodeform_fontname_barcode` | VARCHAR | ฟอนต์บาร์โค้ด | `Code 128` ทุกแถว |
| `barcodeform_fontname_text` | VARCHAR | ฟอนต์ข้อความ | `Tahoma` |
| `barcodeform_visable_barcode`, `_proid`, `_proname`, `_proprice` (sic) | VARCHAR | แสดง/ซ่อน `True`/`False` | |
| `barcodeform_image` | LONGBINARY | รูป preview (~100 KB/แถว) | ไม่ migrate |

ตัวอย่าง (ตัดรูป): `{"id":1,"barcodeform_id":"A4-Blank","barcodeform_name":"(A4) 25x50mm ไม่มีช่อง 4 คอลัมน์ 11 แถว","barcodeform_columns":4,"barcodeform_rows":11,"barcodeform_pageleft":0,"barcodeform_pagetop":0,"barcodeform_pagewidth":0,"barcodeform_barwidth":2835,"barcodeform_barheight":1417,"barcodeform_margintop":0,"barcodeform_marginbuttom":159,"barcodeform_marginleft":50,"barcodeform_marginright":159,"barcodeform_fontsize_barcode":"36","barcodeform_fontsize_proid":"9","barcodeform_fontsize_proname":"11","barcodeform_fontsize_proprice":"12","barcodeform_fontname_barcode":"Code 128","barcodeform_fontname_text":"Tahoma","barcodeform_visable_barcode":"True",...}`

ทั้ง 5 แม่แบบ: `A4-Blank` 4×11 (50×25 mm) · `A5` 4×14 (38×13 mm, ซ่อนชื่อ/ราคา) · `A7` 4×10 (38×19 mm) · `A9` 3×10 (50×19 mm) · `A10` 3×8 (50×25 mm)

Quirk: แม่แบบใช้ฟอนต์ `Code 128` ขณะที่ `pro_barcode` ห่อด้วย `*` แบบ Code 39 — ระบบใหม่สร้างบาร์โค้ดจาก `sku` โดยตรง

### 4.24 `barcodes` (10 แถว) และ `barcodeencode` (1 แถว) — scratch การพิมพ์ฉลาก

`barcodes`: `id` (INTEGER) + คอลัมน์ชุดละ 4 (`barcode_1..4` ข้อความบาร์โค้ดที่ encode แล้วสำหรับฟอนต์ Code 128 เช่น `Í  È5mÎ`, `barpro_id_1..4`, `barpro_name_1..4`, `barpro_price_1..4`) = 1 แถวของฉลาก 4 คอลัมน์ที่กำลังจะพิมพ์ (ตัวอย่างค้างอยู่: สินค้า `00005` แก้วพลาสติก ราคา 5)
`barcodeencode`: `id` (COUNTER = 30) + `encodeallbar` (LONGCHAR ข้อความบาร์โค้ด encode แล้วคั่นด้วย `\r\n`) — ไม่ migrate ทั้งสองตาราง

---

## 5. สูตรปันผล (Dividend math, verified on BE 2565)

ตรวจสอบโดยคำนวณย้อนกลับจาก `temps2` (1,035 แถว) เทียบ `criteriondividend` ปี 2565 และ `buymain` ปี 2022 — ตรงทุกแถว

### 5.1 นิยาม (Definitions)

| สัญลักษณ์ | ความหมาย | แหล่งข้อมูล | ค่าปี 2565 |
|---|---|---|---|
| `baht_per_share` | ราคาต่อหุ้น | `criteriondividend` type 1 `percent` | 50 |
| `shares_m` | จำนวนหุ้นของสมาชิก m = `cust_hunmoney` ÷ baht_per_share (**ไม่ปัด** มีเศษได้) | `customer` | เช่น 10,050 ÷ 50 = 201 |
| `purchases_m` | ยอดซื้อสุทธิของสมาชิก m ทั้งปี = Σ `buy_buytotal` where `buy_status = 1` and ปีของ `buy_date` = ปีที่คำนวณ | `buymain` | Σ ทุกคน = 5,647,465 (รวม walk-in 289,635) |
| `net_profit` | กำไรสุทธิที่คณะกรรมการกรอก | (ไม่เก็บในตาราง — อนุมานย้อนกลับ) | ≈ 409,826 |
| `pool_HUN` | กองปันหุ้น = net_profit × HUN % | `criteriondividend` HUN | 25 % → 102,456.4 (Σ จริงจาก temps2) |
| `pool_AVG` | กองเฉลี่ยคืน = net_profit × AVG % | `criteriondividend` AVG | 25 % → 102,456.6 |
| `rate_share` | เงินปันผลต่อหุ้น = pool_HUN ÷ Σ shares | | 102,456.4 ÷ 10,244.4 = **10.00125** |
| `rebate_rate` | เฉลี่ยคืนต่อบาทที่ซื้อ = pool_AVG ÷ Σ purchases | | 102,456.6 ÷ 5,647,465 = **0.018142** |

### 5.2 สูตรต่อสมาชิก (Per-member formula)

```
share_dividend_m = round(shares_m × rate_share, 2)
rebate_m         = round(purchases_m × rebate_rate, 2)
total_m          = share_dividend_m + rebate_m
```

### 5.3 ตัวอย่างสมาชิก 91014 (นายอำนาจ ไชยราช)

| ขั้นตอน | คำนวณ | ผล | ค่าใน temps2 |
|---|---|---|---|
| หุ้น | 10,050 ÷ 50 | 201 | `tempint1` = 201 |
| ปันผลตามหุ้น | 201 × 10.00125 | 2,010.25 | `tempint3` = 2,010.25 |
| เฉลี่ยคืน | 34,429 × 0.018142 | 624.61 | `tempint4` = 624.61 |
| รวม | 2,010.25 + 624.61 | **2,634.86** | `tempint5` = 2,634.86 |

### 5.4 ข้อสังเกตที่ต้องคงไว้ในระบบใหม่ (Behaviours to preserve)

1. **`maxhun` (cap 40 หุ้นในปี 2565) ไม่ถูกบังคับใช้** — สมาชิก 91014 ถือ 201 หุ้น และได้ปันผลเต็ม 201 หุ้น (มีสมาชิกถือสูงสุด 10,250 ÷ 50 = 205 หุ้น) → engine ใหม่มี `apply_cap = false` เป็นค่าเริ่มต้น
2. **หุ้นมีเศษทศนิยม** (Σ = 10,244.4 ไม่ใช่จำนวนเต็ม; มีสมาชิกถือ ฿20 = 0.4 หุ้น) → เก็บเป็น NUMERIC(14,4)
3. **ตัวหารเฉลี่ยคืนรวม walk-in** (`cust_id = 0`) และแถว walk-in ได้รับเฉลี่ยคืนด้วยในตาราง — ระบบใหม่ต้อง reproduce ได้ (option แยกต่างหากว่าจะจ่ายจริงหรือไม่)
4. บิลที่ยกเลิก (status 3) ไม่นับ; บิลเชื่อที่ยังไม่ชำระ **นับ** (ใช้ยอดขาย ไม่ใช่ยอดรับเงิน)
5. ปัดเศษ 2 ตำแหน่ง (half-up) ต่อสมาชิก ⇒ Σ share dividend (102,456.4) และ Σ rebate (102,456.6) ต่างจากกอง 102,456.5 เล็กน้อย — ยอมรับได้
6. `temps` (471,785 × 25 % = 117,946.25) เป็นการคำนวณคนละครั้ง ไม่ใช่ค่าที่ใช้ออกใบแจ้ง 2565 — อย่านำมา reconcile กับ `temps2`

เกณฑ์ยอมรับของ engine ใหม่: ป้อน criteria 2565 + net_profit 409,826 + `customer.cust_hunmoney` + ยอดขาย 2022 แล้วต้องได้ 1,035 แถวตรงกับ `temps2` ทุกค่า (อัตรา 10.00125 และ 0.018142)

---

## 6. ปัญหาคุณภาพข้อมูล (Data-quality issues) และกฎการ migrate

| # | ปัญหา | จำนวน | กฎการ migrate |
|---|---|---|---|
| 6.1 | **เลขที่บิลซ้ำ** `buy_id` ทั้งหมดขึ้นต้น `N6512-*`: counter รีเซ็ตเมื่อ 2022-12-07 แล้วออกเลขซ้ำกับบิลวันที่ 1–6 ธ.ค. 2022 | 632 เลขซ้ำ = 1,264 หัวบิล; ในนั้น 67 คู่เป็น **แถวซ้ำกันทุกคอลัมน์** (exact duplicates) | แยกบิลด้วยลำดับ `buydetails.ID` + `buy_rownumber` รีเซ็ตเป็น 1 → บิลชุดที่ 2 ได้ `legacy_dup_seq = 1` (UNIQUE `(store_id, doc_no, legacy_dup_seq)`); ลบ 67 หัวบิลที่ซ้ำทุกคอลัมน์ (เหลือ 231,707 sales); ตัวอย่าง `N6512-00001` มี 2 บิล (2022-12-01 ฿300 admin 6 บรรทัด / 2022-12-07 ฿7 chien 1 บรรทัด) |
| 6.2 | `(buy_id, buy_rownumber)` ซ้ำ | 916 คู่ | ผลพวงจาก 6.1 — แก้ด้วยการ segment ตาม ID |
| 6.3 | รายการขายไม่มีหัวบิล (orphan lines) | 25 แถว | เขียนลง `legacy_orphans` (source `buydetails`) ไม่สร้าง sale |
| 6.4 | รายการขายอ้างสินค้าที่ไม่มีใน `product` | 7,939 แถว / 121 รหัส (19 พบใน `delproducts`, 102 หายไป) | สร้าง `products` placeholder `is_archived = true, archived_reason = placeholder_orphan` (ชื่อจาก delproducts ถ้ามี มิฉะนั้นใช้รหัส) แล้วผูก line ตามปกติ |
| 6.5 | รายการรับสินค้าไม่มีหัวใบ (orphan receipt lines) | 368 แถว | `legacy_orphans` (source `orderdetails`) |
| 6.6 | การรับชำระอ้างบิลที่ถูกลบ (ก่อน 2020-01-01) | 2,776 แถว | นำเข้า `ar_payments` โดย `sale_id = NULL` และเก็บ `legacy_bill_no = buy_id` (จะ re-link ได้ถ้าพบ backup ปี 2018–2019) |
| 6.7 | สมาชิก `ต100` ถูกอ้างใน `buymain` แต่ไม่มีใน `customer` | 1 รหัส | สร้าง `members` placeholder `member_code = 'ต100'`, `status = inactive`, note ระบุ placeholder |
| 6.8 | สต็อกติดลบ | 604 สินค้า (อีก 2,946 เป็น 0) | migrate ค่าเดิมเป็น `stock_movements` type `opening` (qty อาจติดลบ) — แก้ด้วย stock take หลัง go-live |
| 6.9 | สินค้าไม่มีหมวด (`brand_id = ""`) | 3 สินค้า | `category_id = NULL` |
| 6.10 | บาร์โค้ดไม่ตรงสูตร `*pro_id*` | 1 สินค้า (`8859344700044`) | ตัด `*` และ trim ช่องว่าง → ได้เท่ากับ sku |
| 6.11 | วันเวลาเป็นข้อความ พ.ศ. | `buy_cancel_time` (977), `payment_datetime` (10,351) | parser `d/M/yyyy  H:mm:ss` → ปี − 543 → timestamptz Asia/Bangkok |
| 6.12 | เวลาเป็นข้อความ | `buy_timesale` (`H:mm`), `log_time` (`H:mm:ss`) | รวมกับคอลัมน์ DATETIME → `sold_at`, `occurred_at` |
| 6.13 | รหัสผ่าน plaintext | 9 ผู้ใช้ | ไม่ migrate; ตั้ง `password_hash` แบบสุ่ม + `must_reset_password = true` |
| 6.14 | จำนวนติดลบในรายการขาย | 1 แถว (`ID` 714463, −30) | migrate ตามเดิม + รายงานใน reconcile report |
| 6.15 | ค่า NULL ปนกับ `""` | หลายคอลัมน์ text | normalize `""` → NULL ยกเว้นคอลัมน์ที่ต้องมีค่า |
| 6.16 | หน่วยนับสะกดหลายแบบ (แพ็ค/แพ็ก/แพ๊ค/แพค) | 71 ค่า distinct | seed `units` ตามค่าเดิมทั้งหมด ไม่ merge อัตโนมัติ |
| 6.17 | บิลเชื่อที่ยกเลิกแต่ยังมียอดค้าง | (รวมอยู่ใน 977 บิลยกเลิก) | `status = cancelled` ⇒ `ar_status = none`, ยอด AR = 0 |
| 6.18 | ยอดหนี้คงค้างปัจจุบัน | 238 บิล ฿40,886 | migrate เป็น `ar_status = unpaid/partial` ตาม `buy_debtorpaid` |
| 6.19 | ตารางซ้ำ/ขยะ | `temps3` = `temps2`, `ข้อผิดพลาดในการวาง`, `MSysCompactError` | ไม่ migrate |

---

## 7. ตัวเลขสำหรับกระทบยอด (Reconciliation numbers)

ตัวเลขที่ `cmd/migrate-legacy --reconcile` ต้องได้ตรง (exit 1 ถ้าไม่ตรง) และการรันซ้ำต้องเป็น no-op

### 7.1 จำนวนแถวต้นทาง (Source row counts — จาก manifest)

company 1 · usersys 9 · brand 29 · product 6,285 · delproducts 359 · supplier 48 · customer 1,040 · typepayments 4 · **buymain 231,774** · **buydetails 585,778** · payments 10,351 · ordermain 4,256 · orderdetails 18,759 · expenses 57 · expenses_type 7 · criteriondividend 45 · temps 5 · temps2 1,035 · temps3 1,035 · chartmonth 24 · logopencashdrawer 10,637 · saletoday 0 · promotionbill 0 · promotionproduct 0 · barcodeforms 5 · barcodes 10 · barcodeencode 1

### 7.2 ยอดขาย (Sales)

| รายการ | ค่า |
|---|---|
| หัวบิลทั้งหมด | 231,774 → **231,707** `sales` หลังตัด 67 exact duplicates |
| รายการขายทั้งหมด | 585,778 (→ `sale_lines` 585,753 + orphan 25) |
| ปี 2020: จำนวนบิล / Σ `buy_buytotal` (ทุกสถานะ) | 78,258 / ฿7,058,279 |
| ปี 2021 | 71,701 / ฿7,101,581.5 |
| ปี 2022 | 71,050 / ฿5,777,556 |
| ปี 2023 (ถึง 28 ก.พ.) | 10,765 / ฿942,417 |
| ปี 2022 เฉพาะ `buy_status = 1` Σ `buy_buytotal` | **฿5,647,465** (= Σ `temps2.tempint2`) |
| `buy_status` | `1` 230,797 · `3` 977 |
| `buy_type` | `1` 224,521 · `2` 7,250 · `3` 0 · `4` 3 |
| บิลเชื่อค้างชำระ (`buy_type = 2`, `buy_debtorpayable > 0`, status 1) | 238 บิล ฿40,886 |
| รายการที่มีส่วนลด / serial / ของแถม / จำนวนติดลบ | 8,929 / 111 / 1 / 1 |
| เลขที่บิลซ้ำ | 632 (`N6512-*`) |

### 7.3 ตารางอื่น (Other tables)

| รายการ | ค่า |
|---|---|
| payments | 10,351 แถว; 2,776 ไม่มีบิล (`sale_id NULL`); Σ `payment_pay` = ฿1,965,259 |
| ใบรับสินค้า / รายการ | 4,256 / 18,759 (orphan lines 368); Σ `order_pricetotal` = ฿8,924,959.33; `sup_id = 0` 2,868 ใบ |
| สมาชิก | 1,040 (+1 placeholder `ต100`) |
| ทุนเรือนหุ้น | ฿512,220 จาก 348 สมาชิก (max ฿10,250) |
| สินค้า | 6,285 active + 359 archived (deleted) + 121 placeholder = 6,765 `products` |
| หมวดหมู่ / หน่วย / supplier | 29 / 71 / 48 |
| มูลค่าสต็อก (Σ stock × avg cost, stock > 0) | ฿1,226,838 |
| ค่าใช้จ่าย | 57 แถว Σ ฿1,842,684 |
| log ลิ้นชัก | 10,637 |
| เกณฑ์ปันผล | 45 แถว → 8 periods (2559–2566), 45 criteria |
| ใบแจ้งปันผล 2565 | 1 run (final, source `legacy_import`) + 1,035 statements; Σ shares 10,244.4 · Σ purchases 5,647,465 · Σ share dividend 102,456.4 · Σ rebate 102,456.6 · Σ total 204,913.0 |
| ผู้ใช้ | 9 (5 active, 4 disabled — เดิม `user_status = Disable` 3 ราย + ดูตาราง §4.2) |

หมายเหตุ: ใน §4.2 มี `Disable` 3 ราย (amnat, user1, กรกมล) และ `Active` 6 ราย

---

## 8. การจับคู่ตารางเก่า→ใหม่ (Legacy → new PostgreSQL mapping)

Schema ใหม่อยู่ที่ `backend/migrations/0001–0007_*.up.sql` ทุกตารางมี `id uuid`, `store_id`, `created_at/updated_at` และ `legacy_id text` + partial UNIQUE `(store_id, legacy_id)` เพื่อ upsert แบบ idempotent

### 8.1 `company` → `stores` + `store_settings`

| legacy | new | หมายเหตุ |
|---|---|---|
| `company_id` | `stores.legacy_id` | `stores.code` = `BBR` (กำหนดตอน seed) |
| `company_name` | `stores.name` | |
| `company_add` | `stores.address` | |
| `company_tel` | `stores.phone` | ตัดคำว่า `โทร.` ออก |
| `company_fax` | `stores.receipt_header` | ค่า `ใบเสร็จรับเงิน` (ชื่อเอกสาร) |
| `company_textbuttom` | `stores.receipt_footer` | |
| `company_logo` | `stores.logo` (bytea) | |
| `company_closeofday` | `store_settings.settings.close_of_day` (bool) | `NO` → false |
| `company_typepaper` | `settings.paper_width` | NULL → default 80 |
| `company_showtax`, `company_vattype`, `company_roundpoint`, `company_editprice` | `settings.show_tax`, `vat_type`, `rounding`, `allow_price_edit` | NULL → default |
| `company_cashcomport`, `company_displaycomport`, `company_displaymaxchartinline` | `settings.drawer_port`, `display_port`, `display_cols` | NULL → default |
| `company_typesoftware`, `company_windowsversion` | **drop** | ข้อมูลของโปรแกรมเดิม ไม่มีความหมายบนเว็บ |

### 8.2 `usersys` → `users`

| legacy | new | หมายเหตุ |
|---|---|---|
| `user_user` | `users.username`, `users.legacy_id` | unique per store (lower-case) |
| `user_password` | **drop** | plaintext; `password_hash` = random + `must_reset_password = true` |
| `user_name` | `users.display_name` | |
| `user_phone` | `users.phone` | |
| `user_address` | **drop** | ไม่มีคอลัมน์ในระบบใหม่ (ไม่จำเป็น) |
| `user_level` | `users.role` + `users.legacy_level` | 1→`store_owner`, 2→`cashier`, 3→`manager`, 5→`cashier` |
| `user_status` | `users.is_active` | `Active` → true, `Disable` → false |
| `user_id` | **drop** | ไม่ถูกอ้างจากที่ใด (เก็บ `user_user` แทน) |

### 8.3 `brand` → `product_categories`; `product.pro_model` → `units`

| legacy | new |
|---|---|
| `brand_id` | `product_categories.legacy_id` |
| `brand_name` | `product_categories.name` (`brand_id = 0` ชื่อว่าง → ชื่อ `ไม่ระบุ`) |
| distinct `product.pro_model` (71 ค่า) | `units.name` |

### 8.4 `product` / `delproducts` → `products`, `product_barcodes`, `price_tiers`, `stock_movements`

| legacy | new | หมายเหตุ |
|---|---|---|
| `pro_id` | `products.sku`, `products.legacy_id` | delproducts ใช้ `legacy_id = 'del:' + id` ถ้ารหัสชนกับ product |
| `brand_id` | `products.category_id` | via `product_categories.legacy_id`; `""` → NULL |
| `pro_name` | `products.name` | |
| `pro_model` | `products.unit_id` | via `units.name` |
| `pro_costprice` | `products.cost_last` | |
| `pro_costpriceavg` | `products.cost_avg` | |
| `pro_buyprice` | `products.sell_price` | |
| `pro_buypricelevel1..4` | `price_tiers(tier 1..4, price)` | สร้างเฉพาะเมื่อ > 0 (ปัจจุบันไม่มี) |
| `pro_stock` | `products.stock_on_hand` + `stock_movements(move_type = opening, qty_delta = pro_stock, balance_after = pro_stock, unit_cost = pro_costpriceavg)` | |
| `pro_barcode` | `product_barcodes.barcode` (`is_primary = true`) | ตัด `*` และ trim; ข้ามถ้าเท่ากับ sku อยู่แล้ว? — **ไม่ข้าม**: ทุกสินค้าต้องมี primary barcode = sku |
| `pro_minlevel1`, `pro_minlevel2` | `products.min_level1`, `min_level2` | |
| `pro_serialstatus` | `products.is_serial` | `YES` → true |
| `pro_color` | **drop** | ว่างทุกแถว |
| `delproducts.id` | `products.archived_at` (ลำดับ) | `is_archived = true`, `archived_reason = 'deleted'`, `is_active = false` |
| (รหัสที่หายไป 121) | `products` placeholder | `archived_reason = 'placeholder_orphan'` |

### 8.5 `supplier` → `suppliers`

`sup_id` → `legacy_id` + `code` · `sup_name` → `name` · `sup_address` → `address` · `sup_phone` → `phone` · `sup_fax` → `fax` · `sup_email` → `email`; `sup_id = 0` (ไม่ระบุ) → ไม่สร้างแถว (receipt ใช้ `supplier_id = NULL`)

### 8.6 `customer` → `members`, `member_share_transactions`

| legacy | new | หมายเหตุ |
|---|---|---|
| `cust_id` | `members.member_code`, `members.legacy_id` | `0` → `is_walkin = true` |
| `cust_name` | `members.name` | |
| `cust_address` | `members.address` | |
| `cust_phone` | `members.phone` | |
| `cust_email` | `members.email` | (ว่างทั้งหมด) |
| `cust_fax` | **drop** | ว่างทั้งหมด |
| `cust_pricelevel` | `members.price_tier` | `0` ทุกแถว |
| `cust_hunmoney` | `members.share_capital` + `member_share_transactions(tx_type = opening, amount, balance_after, occurred_at = cust_datestart หรือวัน import)` | สร้าง tx เฉพาะเมื่อ > 0 (348 แถว) |
| `cust_datestart` | `members.joined_at` (date) | |

### 8.7 `buymain` → `sales`, `sale_payments`

| legacy | new | หมายเหตุ |
|---|---|---|
| `buy_id` | `sales.doc_no`; `legacy_id = buy_id` หรือ `buy_id + '#1'` สำหรับบิลซ้ำ | `legacy_dup_seq` 0/1 |
| `buy_date` + `buy_timesale` | `sales.sold_at` (timestamptz Asia/Bangkok) | เวลาว่าง → 00:00 |
| `buy_pricetotal` | `sales.gross` | |
| `buy_pricediscount` | `sales.discount` (`bill_discount = 0`) | |
| `buy_pricevat` | `sales.vat` | 0 |
| `buy_buytotal` | `sales.net` | |
| `buy_moneyinput` / `buy_moneyreturn` | `sales.tendered` / `sales.change_amount` | |
| `buy_type` | `sales.legacy_tender` + 1 แถว `sale_payments(method, amount = net)` | 1 cash · 2 credit · 3 transfer · 4 card |
| `buy_debtorstatus`, `buy_debtortotal`, `buy_debtorpaid`, `buy_debtorpayable` | `sales.ar_status`, `ar_total`, `ar_paid`, `ar_balance` | type ≠ 2 → `none`; type 2: payable = 0 → `paid`, paid = 0 → `unpaid`, มิฉะนั้น `partial`; cancelled → `none` |
| `user_user` | `sales.cashier_id` (via `users.legacy_id`) + `cashier_name` | |
| `cust_id` | `sales.member_id` | `0` → member walk-in |
| `buy_status` | `sales.status` | `1` → `completed`, `3` → `cancelled` |
| `buy_cancel_user` / `buy_cancel_time` | `sales.cancelled_by(_name)` / `cancelled_at` (BE parser) | |
| `buy_comment` | `sales.note` | (ว่าง) |
| `buy_pricesum`, `buy_closeofday`, `buy_closeofdayuser`, `buy_closeofdaytime` | **drop** | ว่าง/0 ทุกแถว; ระบบใหม่ใช้ `shifts` แทน close-of-day |

### 8.8 `buydetails` → `sale_lines`

| legacy | new | หมายเหตุ |
|---|---|---|
| `ID` | `sale_lines.legacy_id` | |
| `buy_id` (+ segmentation) | `sale_lines.sale_id` | |
| `buy_rownumber` | `sale_lines.line_no` | UNIQUE `(sale_id, line_no)` |
| `pro_id` | `sale_lines.product_id` + `sku` | placeholder ถ้าไม่พบ |
| (`product.pro_name`) | `sale_lines.description` | snapshot ชื่อสินค้าตอน import |
| `buy_number` | `sale_lines.qty` | |
| `buy_buyprice` | `sale_lines.unit_price` | |
| `buy_discount` | `sale_lines.discount` | NULL → 0 |
| `buy_sumprice − buy_discount` | `sale_lines.line_total` | |
| `buy_costprice` / `buy_costpriceavg` | `sale_lines.cost_last` / `cost_avg` | |
| `buy_freestatus` | `sale_lines.is_free` | `1` → true |
| `buy_serialnumber` | `sale_lines.serial_no` | `""` → NULL |

### 8.9 `payments` → `ar_payments`

| legacy | new | หมายเหตุ |
|---|---|---|
| `payment_id` | `ar_payments.legacy_id` | |
| `buy_id` | `ar_payments.sale_id` (via sales.legacy_id) + `legacy_bill_no` | ไม่พบ → `sale_id NULL` (2,776) |
| `cust_id` | `ar_payments.member_id` | |
| `payment_debsum` | `bill_total` | |
| `payment_debremain` | `balance_before` | |
| `payment_pay` | `amount` | |
| `payment_total` | `balance_after` | |
| `payment_datetime` (fallback `payment_date`) | `paid_at` | BE parser |
| `user_user` | `received_by(_name)` | |
| — | `method = cash` | legacy ไม่เก็บ |

### 8.10 `ordermain` / `orderdetails` → `purchase_receipts` / `purchase_receipt_lines`

| legacy | new | หมายเหตุ |
|---|---|---|
| `order_id` | `purchase_receipts.doc_no`, `legacy_id` | |
| `sup_id` | `supplier_id` | `0` → NULL |
| `order_date` | `received_at` | |
| `order_pricetotal` | `total` (และ `subtotal`) | `vat = 0` |
| `user_user` | `received_by(_name)` | |
| `order_pricesum`, `order_pricevat` | **drop** | 0 ทุกแถว |
| — | `status = posted` | orphan lines → `legacy_orphans` |
| `orderdetails.id` | `purchase_receipt_lines.legacy_id`; `line_no` = ลำดับภายในใบ | |
| `pro_id` | `product_id`, `sku` | |
| `order_costprice` / `order_number` / `order_sumprice` | `unit_cost` / `qty` / `total` | |

หมายเหตุ: ไม่สร้าง `stock_movements` ย้อนหลังจากใบรับสินค้า/ยอดขายเก่า — สต็อกตั้งต้นใช้ `pro_stock` (opening) เท่านั้น เพื่อไม่ให้ยอดคงเหลือเพี้ยน

### 8.11 `expenses_type` / `expenses` → `expense_types` / `expenses`

`type_id` → `expense_types.legacy_id`, `expen_type` → `name` · `expen_id` → `expenses.legacy_id`, `expen_date` → `expensed_at`, `type_id` → `type_id`, `expen_detail` → `note`, `expen_total` → `amount`, `user_user` → `created_by(_name)`, `paid_from = cash`

### 8.12 `logopencashdrawer` → `cash_drawer_logs`

`log_id` → `legacy_id` · `log_date` + `log_time` → `occurred_at` · `log_user` → `user_id` (via users.legacy_id) · `log_name` → `user_name` · `reason = no_sale`, `amount = 0`, `shift_id = NULL`

### 8.13 `criteriondividend` → `dividend_periods` + `dividend_criteria`

| legacy | new | หมายเหตุ |
|---|---|---|
| distinct `criteriondividend_year` | `dividend_periods(be_year, legacy_year, starts_on = 1 Jan (BE−543), ends_on = 31 Dec, status)` | 2565 → `paid` (มี statements), 2566 → `draft`, ปีก่อน → `closed` (ไม่มี statements เหลือ) |
| `criteriondividend_id` | `dividend_criteria.legacy_id` | |
| `criteriondividend_type` | `kind` | `1` → `share_rule`, `2` → `allocation` |
| `criteriondividend_name` | `name` | คงการสะกดเดิม |
| `criteriondividend_percent` | type 1 → `baht_per_share`; type 2 → `percent` | |
| `criteriondividend_maxhun` | `max_shares` (`apply_cap = false`) | |
| `criteriondividend_typepercent` | `pool_code` | `HUN`/`AVG`/NULL → `OTHER` |
| `criteriondividend_fixnoedit` | `is_locked` | `NOTDEL` → true |
| `dividend_periods.net_profit` (2565) | 409,826 | อนุมานย้อนกลับ (pool ÷ 25 %) |

### 8.14 `temps2` (+ `temps`) → `dividend_runs` + `dividend_member_statements`

| legacy | new |
|---|---|
| (ทั้งตาราง) | 1 `dividend_runs(period 2565, run_no 1, is_final = true, source = 'legacy_import', member_count = 1035, totals = {total_shares: 10244.4, total_purchases: 5647465, rate_per_share: 10.00125, rebate_rate: 0.018142, pool_hun: 102456.4, pool_avg: 102456.6})` |
| `tempstr1` | `statements.seq_no` |
| `tempstr3` | `statements.member_code` (+ `member_id` via members) |
| `tempstr4` / `tempstr5` | `member_name` / `member_address` |
| `tempint1` | `shares` (และ `shares_effective` เท่ากัน เพราะไม่ cap) ; `share_capital = tempint1 × 50` |
| `tempint2` | `purchases` |
| `tempint3` / `tempint4` / `tempint5` | `share_dividend` / `rebate` / `total` |
| `tempstr2`, `tempstr6`, `tempstr7` | **drop** (ปีอยู่ที่ period; 6/7 ว่าง) |
| `temps.*` | เก็บเป็น `dividend_runs.inputs.legacy_temps` (JSON) เพื่ออ้างอิงเท่านั้น |

### 8.15 `barcodeforms` → `barcode_label_templates`

`barcodeform_id` → `code`, `legacy_id` · `barcodeform_name` → `name` · `paper` = ตัวอักษรหน้าใน code (`A4`, `A5`…) · `barcodeform_columns/rows` → `columns_n/rows_n` · ขนาด/ระยะขอบ (twips → mm ÷ 56.7) → `dims` JSON · ฟอนต์ → `fonts` JSON · `visable_*` → `visible` JSON · `barcodeform_image` **drop**

### 8.16 ตารางที่ไม่ migrate

`typepayments` (เป็น enum), `temps3` (ซ้ำ), `chartmonth` (คำนวณใหม่ได้จาก `sales` → `monthly_sales_mv`), `saletoday`/`promotionbill`/`promotionproduct` (ว่าง — schema ใหม่ `shifts`, `promotions` รองรับ), `barcodes`/`barcodeencode` (scratch), `keyregister` (licence), `ข้อผิดพลาดในการวาง`, `MSys*`

---

## 9. ฟังก์ชันของระบบเดิม (Legacy functional inventory) และสิ่งที่ระบบใหม่เพิ่ม

### 9.1 ฟังก์ชันที่ระบบเดิมมี (ต้องครอบคลุมทั้งหมด)

| กลุ่ม | ฟังก์ชัน | หลักฐานในข้อมูล |
|---|---|---|
| ขายหน้าร้าน (POS) | สแกนบาร์โค้ด/ค้นหาสินค้า, แก้จำนวน, ส่วนลดรายบรรทัด (บาท), ของแถม, บันทึก serial, เลือกสมาชิกบนบิล, 4 วิธีชำระ, รับเงิน/เงินทอน, ยกเลิกบิลพร้อมบันทึกผู้ยกเลิก+เวลา, พิมพ์ซ้ำใบเสร็จ, เปิดลิ้นชัก (log) | `buymain`, `buydetails`, `logopencashdrawer` |
| ลูกหนี้ (AR) | ขายเชื่อสมาชิก, รับชำระบางส่วนหลายครั้ง, ยอดค้างต่อบิล | `buy_type = 2`, `payments` |
| สินค้า | หมวดหมู่, หน่วยนับ, ต้นทุนล่าสุด/ถัวเฉลี่ย, ราคาขาย, สต็อก, จุดสั่งซื้อ 2 ระดับ, flag serial, archive สินค้าที่ลบ, พิมพ์ฉลากบาร์โค้ด 5 แม่แบบ | `product`, `delproducts`, `barcodeforms` |
| รับสินค้า | ใบรับสินค้า (มี/ไม่มี supplier) อัปเดตต้นทุนและสต็อก | `ordermain`, `orderdetails` |
| ผู้จำหน่าย | ทะเบียน supplier | `supplier` |
| สมาชิก | ทะเบียนสมาชิก + ทุนเรือนหุ้น + วันที่สมัคร, ระดับราคา (ไม่ใช้) | `customer` |
| ค่าใช้จ่าย | บันทึกค่าใช้จ่ายตามประเภท | `expenses`, `expenses_type` |
| ปันผลประจำปี | ตั้งเกณฑ์ต่อปี (บาท/หุ้น, cap, % จัดสรร), คำนวณกอง, ออกใบแจ้งรายสมาชิก | `criteriondividend`, `temps`, `temps2` |
| ผู้ใช้ | ระดับสิทธิ์ 1/2/3/5, เปิด/ปิดใช้งาน | `usersys` |
| รายงาน | กราฟยอดขายรายเดือน | `chartmonth` |
| ตั้งค่า | ข้อมูลร้าน/หัวท้ายใบเสร็จ/โลโก้, VAT, ปัดเศษ, กระดาษ, COM port ลิ้นชัก/จอลูกค้า | `company` |
| ออกแบบไว้แต่ไม่ใช้ | ปิดยอดสิ้นวัน/กะ, โปรโมชันระดับบิล/สินค้า, ราคาขาย 4 ระดับ, ระดับราคาสมาชิก | `saletoday`, `promotion*`, `pro_buypricelevel*`, `cust_pricelevel` |

### 9.2 สิ่งที่ระบบใหม่เพิ่ม (Gap analysis / additions)

- multi-tenant (หลายร้านใน URL เดียว, RLS ต่อ `store_id`) และ UI สองภาษา ไทย/อังกฤษ
- หลายบาร์โค้ดต่อสินค้า (`product_barcodes` + `pack_qty`)
- stock ledger (`stock_movements`), ปรับสต็อก, ตรวจนับสต็อก (แก้สต็อกติดลบ 604 รายการหลัง go-live), แจ้งเตือนสินค้าใกล้หมด
- คืนสินค้า/คืนเงิน (`sale_returns`), พักบิล (`held_bills`), หลายวิธีชำระต่อบิล (`sale_payments`), QR
- เปิด/ปิดกะพร้อมนับเงินและผลต่าง (`shifts`), log ลิ้นชักมีเหตุผล/จำนวนเงิน
- โปรโมชันใช้งานได้จริง (`promotions`)
- สมุดหุ้นสมาชิก (`member_share_transactions`), LINE LIFF (บัตรสมาชิก, ประวัติซื้อ, ประมาณการปันผล), การผูก LINE ด้วย link code
- dividend engine แบบมี state (draft → simulated → approved → paid), เก็บทุก run, จ่ายปันผล (`dividend_payouts`), export
- รายงาน: ยอดขายรายวัน, ความเคลื่อนไหวสินค้า, กำไรขั้นต้นจาก cost snapshot, อายุลูกหนี้, สินค้าไม่เคลื่อนไหว, ยอดซื้อต่อ supplier, ค่าใช้จ่าย, กราฟรายเดือน (`monthly_sales_mv`), export CSV ทุกหน้า
- AI ถาม-ตอบ NL→SQL (T-LLM, read-only role, SQL guard, `ai_query_logs`)
- audit log ทุก mutation, refresh-token auth, รหัสผ่าน argon2id, บังคับเปลี่ยนรหัสผ่านครั้งแรก
- migration แบบ idempotent + reconcile report (`legacy_import_runs`, `legacy_orphans`), backup pg_dump รายคืน

---

## 10. ภาคผนวก (Appendix)

### 10.1 Index จาก DAO (Index list)

| ตาราง | Primary key | Index อื่น | หมายเหตุ |
|---|---|---|---|
| `company` | `company_id` | | |
| `usersys` | `user_user` | | |
| `brand` | `brand_id` | | text |
| `product` | `pro_id` | | text |
| `delproducts` | `id` | | |
| `supplier` | `sup_id` | | |
| `customer` | `cust_id` | | |
| `typepayments` | `buy_type` | | |
| `buymain` | **ไม่มี** | non-unique บน `buy_id`, non-unique บน `cust_id` | จึงมีเลขที่บิลซ้ำได้ |
| `buydetails` | **ไม่มี** | (autonumber `ID` ไม่ได้เป็น index) | |
| `payments` | `payment_id` | | |
| `ordermain` | `order_id` | | |
| `orderdetails` | `id` | | |
| `expenses` | `expen_id` | | |
| `expenses_type` | `type_id` | | |
| `criteriondividend` | `criteriondividend_id` | | |
| `temps2` / `temps3` | `id` | | |
| `logopencashdrawer` | `log_id` | | |
| `temps`, `chartmonth`, `saletoday`, `promotionbill`, `promotionproduct`, `barcodeforms`, `barcodes`, `barcodeencode` | autonumber/`id` (สถานะ PK ไม่ได้บันทึกไว้ในเซสชันสำรวจ) | | ตรวจได้ด้วยสคริปต์ §2.2 หากจำเป็น |

### 10.2 `typepayments` (วิธีชำระ)

`1` เงินสด (cash) · `2` ลูกหนี้ (credit) · `3` เงินโอน (transfer) · `4` บัตรเครดิต (card)

### 10.3 `expenses_type` (ประเภทค่าใช้จ่าย)

`00001` น้ำแข็ง · `00002` แก๊ส · `00003` ขนม · `1` รายจ่ายรวมประจำเดือน · `2` รายจ่ายประจำวัน · `3` อาหาร · `4` ของใช้

### 10.4 รายชื่อ supplier ทั้งหมด (48)

`0` ไม่ระบุ · `0001` ร้านคงการค้า · `0002` ร้านกำไรทิพย์ · `0003` เซล ยูนิลิเวอร์ · `0004` ร้าน ว.พาณิช · `0005` เซล ดาวนี่ · `0006` ร้าน เพ็ญ · `0007` โรงเหล้า บ้านต้นปล้อง · `0008` เซลตะวันแดง · `0009` สหพัฒน์ แจ๋ว · `0010` เซล มอคโคน่า · `0011` เซล เนสกาแฟ · `0012` จอย · `0013` ยาเสือแม่ลูก · `0014` ดีน่า+ดัชมิลค์ · `0015` ลุงปันเกลือ+น้ำส้มมังกรคู่ · `0016` ไทยเดนมาร์ก(นมวัวแดง) · `0017` เชลล์ นิรันดร์ · `0018` ยำยำ/เบอร์ดี้/รสดี/อายิโนะ · `0019` พันการค้า · `0020` น้าลักษณ์ · `0021` เซลล์ไทยเบฟ(เบียร์ช้าง) · `0022` พี่อมรรัตน์ · `0023` ฟาร์มเฮ้าส์ · `0024` สุราห้วยปล้อง · `0025` ชิตพล บ้านขนม · `0026` ธูปจริญญา+ด้าย · `0027` อมรรัตน์ แคบหมู ถั่วอบ · `0028` รถส่งยา · `0029` สุบินพาณิช บุหรี่/ยาสูบ · `0030` แลคตาซอย · `0031` ขนมปังจอนนี่ · `0032` ขนม เลย์/ตะวัน/ซันไบร์ท · `0033` ไฮยีน · `0034` บีทาเก้น / ยาคูลท์ · `0035` นีเวีย · `0036` วงมาร์เก็ตติ้ง · `0037` บีทาเก้น · `0038` ดูเม็ก ดูโกร · `0039` ยากำจัดแมลง เชนไดร์/ซิลท้อกซ์/คินโช · `0040` กุนเชียง หมูหยองตราเจ้าสัว · `0041` เป๊บซี่ / โค๊ก /แฟนต้า/มิรินด้า · `0042` จอห์นสัน · `0043` ยันฮี · `0044` เดอ เบล แมนซั่ม/กระทิงแดง/สปอนเซอร์ · `0045` ข้าวตราฉัตร · `0046` โอวัลติน · `0047` เลย์

### 10.5 การกระจายทุนเรือนหุ้น (Share-capital distribution, 348 ผู้ถือหุ้น, Σ ฿512,220)

| ช่วง (บาท) | จำนวนสมาชิก |
|---|---|
| = 50 (1 หุ้น) | 75 |
| 51–100 | 11 (รวม 1 รายถือ ฿20) |
| 101–500 | 119 |
| 501–1,000 | 46 |
| 1,001–5,000 | 61 |
| > 5,000 | 36 (สูงสุด ฿10,250; มี 15 รายถือ ฿10,050 พอดี) |

ค่าที่พบบ่อย: 50 (75 ราย), 150 (40), 250 (32), 550 (20), 500 (17), 200 (16), 10,050 (15), 1,050 (14), 100 (10), 1,000 (10) — สังเกตว่ายอดมักลงท้ายด้วย 50 (น่าจะเป็นค่าสมัคร ฿50 + หุ้นเพิ่มเป็นร้อย)

### 10.6 การกระจายความยาว `pro_id` (6,285 สินค้า)

| ความยาว | จำนวน | หมายเหตุ |
|---|---|---|
| 1 | 7 | |
| 2 | 17 | |
| 3 | 14 | |
| 4 | 19 | |
| 5 | 25 | |
| 6 | 75 | |
| 7 | 50 | |
| 8 | 150 | EAN-8 บางส่วน |
| 9 | 27 | |
| 10 | 150 | รหัสภายในแบบ `0000000073` |
| 11 | 11 | |
| 12 | 12 | UPC-A |
| **13** | **5,686** | EAN-13 (90.5 %) |
| 14 | 33 | |
| 15 | 1 | |
| 20 | 8 | ยาวสุด |

### 10.7 หน่วยนับ (`pro_model`) 20 อันดับแรก จาก 71 ค่า

ขวด 1,462 · ซอง 1,142 · ห่อ 675 · ถุง 555 · กล่อง 515 · อัน 342 · กระป๋อง 217 · หลอด 142 · ก้อน 127 · แพ็ค 125 · แพ็ก 125 · กระปุก 104 · แพ๊ค 96 · แพค 70 · ถ้วย 63 · แผง 58 · ใบ 48 · ลัง 45 · ชิ้น 45 · แท่ง 39

### 10.8 จุดสั่งซื้อ (`pro_minlevel1`, `pro_minlevel2`)

(2, 1) 5,996 · (1, 1) 117 · (3, 1) 94 · (1, 2) 27 · (5, 1) 9 · อื่น ๆ เล็กน้อย — ค่า default ของโปรแกรมคือ 2/1

### 10.9 กิจกรรมต่อผู้ใช้ (User activity counts)

| ผู้ใช้ | รับชำระ (`payments`) | รับสินค้า (`ordermain`) | เปิดลิ้นชัก (`log`) |
|---|---|---|---|
| `yp` | 4,298 | 2,483 | 4,738 |
| `admin` | 3,198 | 574 | 2,463 |
| `อนันทร์` | 2,037 | 866 | 2,784 |
| `chananuch` | 661 | 0 | 552 |
| `chien` | 152 | 272 | 66 |
| `ยุพิน` | 5 | 61 | 34 |

### 10.10 ความยาว `cust_id` (1,040 สมาชิก)

1: 8 · 2: 71 · 3: 111 · 4: 4 · 5: 27 · 6: 245 · 7: 195 · 8: 62 · 9: 20 · 10: 158 · 11: 102 · 12: 35 · 13: 2 — ไม่มีรูปแบบตายตัว ต้องเก็บเป็น text เสมอ

### 10.11 สรุปการอ้างอิงคีย์ข้ามตาราง (Implicit foreign keys — ไม่มี constraint จริงใน Access)

| จาก | ไป | หมายเหตุ |
|---|---|---|
| `product.brand_id` | `brand.brand_id` | 3 แถวไม่พบ |
| `buymain.cust_id`, `payments.cust_id` | `customer.cust_id` | `ต100` ไม่พบ |
| `buymain.user_user`, `buymain.buy_cancel_user`, `payments.user_user`, `ordermain.user_user`, `expenses.user_user`, `logopencashdrawer.log_user` | `usersys.user_user` | |
| `buymain.buy_type` | `typepayments.buy_type` | |
| `buydetails.buy_id`, `payments.buy_id` | `buymain.buy_id` | ไม่ unique; orphan 25 / 2,776 |
| `buydetails.pro_id`, `orderdetails.pro_id` | `product.pro_id` | 121 รหัสไม่พบ (19 ใน delproducts) |
| `orderdetails.order_id` | `ordermain.order_id` | orphan 368 |
| `ordermain.sup_id` | `supplier.sup_id` | `0` = ไม่ระบุ |
| `expenses.type_id` | `expenses_type.type_id` | |
| `temps2.tempstr3` | `customer.cust_id` | |

---

*เอกสารนี้สร้างจากการสำรวจเมื่อ 2026-09-02; ถ้าไฟล์ `database.mdb` เปลี่ยน (sha256 ไม่ตรงกับ §1.2) ต้องรัน `extract.ps1` ใหม่และทบทวนตัวเลขใน §6–§7*
