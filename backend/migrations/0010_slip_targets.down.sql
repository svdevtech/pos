DROP INDEX IF EXISTS payment_slips_unassigned_idx;
DROP INDEX IF EXISTS payment_slips_ar_idx;
ALTER TABLE payment_slips DROP CONSTRAINT IF EXISTS payment_slips_one_target;
DELETE FROM payment_slips WHERE sale_id IS NULL;
ALTER TABLE payment_slips DROP COLUMN IF EXISTS ar_doc_no;
ALTER TABLE payment_slips DROP COLUMN IF EXISTS ar_payment_id;
ALTER TABLE payment_slips ALTER COLUMN sale_id SET NOT NULL;
