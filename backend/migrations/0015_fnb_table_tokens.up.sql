-- A table's QR code. The token is what the customer's phone (or the tablet fixed to the table)
-- carries in its URL: /t/<token>. It names the store and the table, nothing more, and can be
-- regenerated at any time — the old code on a printed card then simply stops working.
CREATE TABLE table_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  table_code  text NOT NULL,
  token       text NOT NULL UNIQUE,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, table_code)
);

DO $$
BEGIN
  ALTER TABLE table_tokens ENABLE ROW LEVEL SECURITY;
  ALTER TABLE table_tokens FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON table_tokens;
  CREATE POLICY tenant_isolation ON table_tokens USING (app_bypass_rls() OR store_id = app_current_store_id()) WITH CHECK (app_bypass_rls() OR store_id = app_current_store_id());
END $$;
