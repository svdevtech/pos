-- 0009: photographs of transfer/QR slips, kept with the sale they pay for.
--
-- The image lives in the row (not on disk) so it travels with the store backup and with an export
-- to another server: a slip is the evidence a payment happened, losing it is worse than the space.
CREATE TABLE payment_slips (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sale_id      uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method       text NOT NULL,                    -- qr | transfer | card | other
  amount       numeric(14,2) NOT NULL DEFAULT 0, -- what the slip is meant to cover
  image        bytea NOT NULL,
  mime         text NOT NULL DEFAULT 'image/jpeg',
  size_bytes   integer NOT NULL DEFAULT 0,
  note         text,
  captured_at  timestamptz NOT NULL DEFAULT now(),
  captured_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  verified_at  timestamptz,
  verified_by  uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX payment_slips_sale_idx ON payment_slips (store_id, sale_id);
CREATE INDEX payment_slips_unverified_idx ON payment_slips (store_id, captured_at DESC) WHERE verified_at IS NULL;

ALTER TABLE payment_slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_slips FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_slips
  USING (app_bypass_rls() OR store_id = app_current_store_id())
  WITH CHECK (app_bypass_rls() OR store_id = app_current_store_id());
