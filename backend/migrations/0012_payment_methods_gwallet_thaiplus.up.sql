-- Three payment rails the co-op shops actually take, all of them state welfare schemes that settle
-- to the shop's own account rather than into the till: G-Wallet (เป๋าตัง), Thai Plus (ไทยพลัส) and
-- the state welfare card (บัตรสวัสดิการแห่งรัฐ). บ้านบุญเรืองเหนือ has been tallying all three by
-- hand on paper every evening.
--
-- ALTER TYPE ... ADD VALUE is allowed inside a transaction on PostgreSQL 12+ as long as the new
-- label is not used in the same transaction, which is why nothing below references them.
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'gwallet';
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'thaiplus';
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'welfare';
