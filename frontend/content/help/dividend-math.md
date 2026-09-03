# สูตรคำนวณปันผลประจำปี / Annual dividend math

Implemented in `backend/internal/usecase/dividenduc/engine.go` (`Compute`, `Verify`).
The engine is a pure function over `decimal` values — no I/O — so the same code serves
simulation, approval, and verification of legacy-imported runs.

---

## 1. นิยาม / Definitions

| สัญลักษณ์ / Symbol | ความหมาย (TH) | Meaning (EN) | ที่มา / Source |
|---|---|---|---|
| `net_profit` | กำไรสุทธิที่คณะกรรมการกรอก | Net profit entered by the board | `dividend_periods.net_profit` |
| `baht_per_share` | ราคาต่อหุ้น (บาท) | Baht per share | criterion `share_rule.baht_per_share` |
| `max_shares`, `apply_cap` | เพดานหุ้นต่อคน (ใช้เมื่อ `apply_cap = true` เท่านั้น) | Per-member cap, only enforced when `apply_cap` | criterion `share_rule` |
| `pct_HUN` | % ของกำไรสุทธิที่จัดสรรเป็น **ปันผลตามหุ้น** | % of net profit allocated to the **share-dividend pool** | allocation rows with `pool_code = HUN` |
| `pct_AVG` | % ของกำไรสุทธิที่จัดสรรเป็น **เฉลี่ยคืน** | % of net profit allocated to the **purchase-rebate pool** | allocation rows with `pool_code = AVG` |
| `pct_i` | % ของรายการจัดสรรอื่น (ทุนสำรอง, ตอบแทนกรรมการ, สาธารณะประโยชน์ …) | % of every other allocation (reserves, board, public benefit …) | allocation rows with `pool_code = OTHER` |
| `share_capital_m` | ทุนเรือนหุ้นของสมาชิก m ณ เวลาคำนวณ | Member m's share capital at run time | `members.share_capital` (snapshot into the statement) |
| `purchases_m` | ยอดซื้อสุทธิของสมาชิก m ในงวด | Member m's net purchases during the period | Σ `sales.net` where `status = 'completed'` and `sold_at ∈ [starts_on, ends_on + 1 day)` in Asia/Bangkok |

กฎการรวมสมาชิก / Membership rules:

* ทุกสมาชิกที่มีอยู่ ณ เวลาคำนวณจะมีบรรทัดในใบแจ้ง (แม้หุ้น = 0 และยอดซื้อ = 0) — ตรงกับ `temps2` เดิม
  *Every member existing at run time gets a statement row (even 0 shares / 0 purchases) — matches legacy `temps2`.*
* บิลที่ไม่ระบุสมาชิก (`member_id IS NULL`) ถูกรวมเข้าแถว walk-in (`members.is_walkin`, รหัส `0`)
  *Sales without a member are attributed to the store's walk-in row (`members.is_walkin`, code `0`).*
* แถว walk-in **นับในตัวหาร Σ purchases และได้รับเฉลี่ยคืนเหมือนสมาชิกทั่วไป** (พฤติกรรมเดิม) แต่ถูกติดธง `is_walkin = true`
  เพื่อให้ UI แสดงเป็น "ยังไม่จัดสรร" และ API ไม่ยอมให้บันทึกการจ่ายให้แถวนี้
  *The walk-in row **is part of Σ purchases and receives a computed rebate** (legacy parity) but is flagged `is_walkin` so
  the UI can show it as unallocated; the payout endpoint refuses it.*
* บิลเชื่อที่ยังไม่ชำระ **นับ** (ใช้ยอดขาย ไม่ใช่ยอดรับเงิน); บิลที่ยกเลิก/คืนทั้งบิล ไม่นับ
  *Unpaid credit bills **count** (sales, not cash received); cancelled / fully refunded bills do not.*

---

## 2. สูตร / Formulas

```
shares_m           = share_capital_m / baht_per_share                  (ไม่ปัดเศษ — 4 dp; fractional)
shares_eff_m       = min(shares_m, max_shares)   if apply_cap
                   = shares_m                     otherwise

pool_HUN           = net_profit × pct_HUN / 100
pool_AVG           = net_profit × pct_AVG / 100
allocation_i       = round2(net_profit × pct_i / 100)                  (ทุนสำรอง ฯลฯ / reserves etc.)

rate_per_share     = pool_HUN / Σ shares_eff_m          (= 0 when Σ shares_eff = 0)
rebate_rate        = pool_AVG / Σ purchases_m           (= 0 when Σ purchases = 0)
                     — both kept at 12 decimal places

share_dividend_m   = round2(shares_eff_m × rate_per_share)
rebate_m           = round2(purchases_m × rebate_rate)
total_m            = share_dividend_m + rebate_m
```

`round2` = ปัดเศษ 2 ตำแหน่งแบบ half-up ต่อสมาชิก (`decimal.Round(2)`); ผลรวมจึงอาจต่างจากกองเงินไม่กี่สตางค์ ซึ่งยอมรับได้ตามระบบเดิม
*`round2` is half-up to 2 dp per member, so Σ over members may differ from the pool by a few satang — the legacy system accepted this.*

Run totals stored in `dividend_runs.totals`: `total_shares`, `total_shares_effective`, `total_purchases`, `rate_per_share`,
`rebate_rate`, `pool_hun`, `pool_avg`, `allocations[]`, `sum_share_dividend`, `sum_rebate`, `sum_total`, `member_count`,
`walkin_purchases`, `walkin_rebate`.

Validation (`DIVIDEND_CRITERIA_INVALID`): exactly one `share_rule` with `baht_per_share > 0`; `max_shares > 0` when `apply_cap`;
allocation percents ≥ 0 and Σ ≤ 100.

---

## 3. ตัวอย่างจริง พ.ศ. 2565 / Worked example, BE 2565

เกณฑ์ / Criteria: `baht_per_share = 50`, `max_shares = 40` (**`apply_cap = false`** — ระบบเดิมไม่บังคับใช้ / legacy ignored it),
HUN 25 %, AVG 25 %, ทุนสำรอง 30 %, ตอบแทนกรรมการ 10 %, สาธารณะประโยชน์ 10 %.

| ขั้นตอน / Step | คำนวณ / Computation | ผล / Result |
|---|---|---|
| net_profit (อนุมานย้อนกลับ / inferred) | | **409,826.40** |
| pool_HUN | 409,826.40 × 25 / 100 | 102,456.60 |
| pool_AVG | 409,826.40 × 25 / 100 | 102,456.60 |
| Σ shares | Σ `cust_hunmoney` / 50 (1,035 rows, fractional) | **10,244.4** |
| Σ purchases | Σ `buy_buytotal`, `buy_status = 1`, ปี 2022 (รวม walk-in 289,635) | **5,647,465** |
| rate_per_share | 102,456.60 / 10,244.4 | **10.00123** (legacy reference quotes ≈ 10.00125 = 2,010.25 / 201 back-derived; both round every member to the same satang) |
| rebate_rate | 102,456.60 / 5,647,465 | **0.018142** (0.01814205…) |

สมาชิก 91014 (นายอำนาจ ไชยราช) / Member 91014:

| | คำนวณ / Computation | ผล / Result | `temps2` |
|---|---|---|---|
| หุ้น / shares | 10,050 / 50 | 201 | `tempint1 = 201` |
| ปันผลตามหุ้น / share dividend | round2(201 × 10.00125) | **2,010.25** | `tempint3 = 2,010.25` |
| เฉลี่ยคืน / rebate | round2(34,429 × 0.018142) | **624.61** | `tempint4 = 624.61` |
| รวม / total | 2,010.25 + 624.61 | **2,634.86** | `tempint5 = 2,634.86` |

กรณีอื่นที่ต้องได้ / Other cases the unit test pins down (`engine_test.go`):

* หุ้นมีเศษ / fractional shares: ฿20 → 0.4 หุ้น → ปันผล 4.00
* สมาชิกไม่มีหุ้น / zero-share member: ได้เฉพาะเฉลี่ยคืน (walk-in ฿289,635 → 5,254.57)
* เพดานหุ้น / cap: เมื่อ `apply_cap = true`, `max_shares = 40` สมาชิก 201 หุ้นได้ปันผลเพียง 40 หุ้น (`shares` ยังเก็บ 201, `shares_effective = 40`)
* ตัวหารเป็นศูนย์ / zero denominators: อัตรา = 0, ทุกคนได้ 0

---

## 4. การตรวจสอบย้อนกลับ / Verification (`Verify`)

`Verify(inputs, storedStatements)` คำนวณใหม่จาก snapshot ของ run (`dividend_runs.inputs`: net_profit + criteria (+ members))
แล้วเทียบกับ statements ที่เก็บไว้ทีละคอลัมน์ (`shares`, `shares_effective`, `purchases`, `share_dividend`, `rebate`, `total`)
รายงาน `max_abs_diff` ต่อคอลัมน์, จำนวนแถวที่ไม่ตรง, รหัสสมาชิกที่หาย/เกิน และ 10 แถวที่ต่างมากที่สุด
ถ้า snapshot ไม่มีรายชื่อสมาชิก (run ที่ import จากระบบเดิม) จะสร้างจาก `share_capital` + `purchases` ในใบแจ้งแทน

*`Verify` recomputes a run from its inputs snapshot and reports the max absolute difference per column, mismatched rows,
missing/extra member codes and the 10 worst rows. For legacy-imported runs (no member snapshot) the member list is rebuilt from
the stored statements' `share_capital` + `purchases`.* Endpoint: `GET /api/v1/dividends/runs/{id}/verify`.

เกณฑ์ยอมรับ / Acceptance: BE 2565 criteria + net_profit 409,826.40 + `customer.cust_hunmoney` + 2022 sales ⇒ 1,035 rows
equal to `temps2` in every column (`ok = true`, all `max_abs_diff` = 0).

---

## 5. วงจรสถานะ / Lifecycle

```
draft ──simulate──▶ simulated ──simulate──▶ simulated (new run_no)
                    simulated ──approve───▶ approved  (latest run is_final, criteria locked, approved_by/at)
                    approved  ──payouts / mark-paid──▶ paid
                    paid      ──close─────▶ closed
```

* แก้ไข criteria / net_profit ได้เฉพาะ `draft`, `simulated` มิฉะนั้น `DIVIDEND_LOCKED`
  *Criteria / net profit are editable only in `draft` / `simulated`; otherwise `DIVIDEND_LOCKED`.*
* การเปลี่ยนสถานะที่ไม่อนุญาต → `DIVIDEND_BAD_TRANSITION {from, to}`; อนุมัติโดยไม่มี run → `DIVIDEND_NO_RUN`
* การจ่าย (`POST /statements/{id}/payouts`) ทำได้เฉพาะงวด `approved` / `paid` บน run ที่ `is_final`
  (`DIVIDEND_NOT_APPROVED`), ห้ามเกินยอดคงเหลือ (`DIVIDEND_PAYOUT_EXCEEDS {remaining}`); `method = "share_reinvest"`
  ถูกเก็บเป็น `payment_method = 'other'` และเพิ่ม `member_share_transactions` ชนิด `dividend_reinvest` พร้อมปรับ `members.share_capital`
* เมื่อทุกใบแจ้งที่ต้องจ่าย (ไม่รวม walk-in และยอด 0) ถูกจ่ายครบ งวดที่ `approved` จะกลายเป็น `paid` อัตโนมัติ
* ทุกการเปลี่ยนสถานะเขียน audit log (`dividend.period.create|update`, `dividend.criteria.replace`, `dividend.simulate`,
  `dividend.approve`, `dividend.mark_paid`, `dividend.close`, `dividend.payout`).
