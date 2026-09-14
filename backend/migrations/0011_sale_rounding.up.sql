-- Cash rounding (ตั้งค่า → ใบเสร็จ → ปัดเศษเงินสด, legacy company_roundpoint).
--
-- The adjustment is kept on the bill rather than folded silently into net, so a report can always
-- show gross - discount + rounding = net and the dividend engine can tell the two apart.
ALTER TABLE sales ADD COLUMN rounding NUMERIC(14,2) NOT NULL DEFAULT 0;
