-- 0010: a slip photograph can now belong to a debt payment, or to nothing yet.
--
-- Money arrives by transfer for two different things: a bill at the till, and a member paying off
-- credit. And the cashier often photographs the slip before knowing which record it belongs to
-- (the customer shows the phone, the queue moves on), so a slip is allowed to wait unmatched until
-- somebody assigns it.
ALTER TABLE payment_slips ALTER COLUMN sale_id DROP NOT NULL;
ALTER TABLE payment_slips ADD COLUMN ar_payment_id uuid REFERENCES ar_payments(id) ON DELETE SET NULL;
-- one "รับชำระหนี้" writes a row per bill it settles, all sharing a document number; the slip
-- belongs to the receipt as a whole, so the number is what groups it
ALTER TABLE payment_slips ADD COLUMN ar_doc_no text;

ALTER TABLE payment_slips ADD CONSTRAINT payment_slips_one_target
  CHECK (num_nonnulls(sale_id, ar_payment_id) <= 1);

CREATE INDEX payment_slips_ar_idx ON payment_slips (store_id, ar_doc_no) WHERE ar_doc_no IS NOT NULL;
CREATE INDEX payment_slips_unassigned_idx ON payment_slips (store_id, captured_at DESC)
  WHERE sale_id IS NULL AND ar_payment_id IS NULL;
