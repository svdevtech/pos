-- 0008: units get an active flag (they are "deleted" by deactivating), and products can be
-- converted between packing units (1 ลัง -> 12 ขวด) with an audited document.

ALTER TABLE units ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- conversion rule: one unit of from_product yields `factor` of to_product
CREATE TABLE product_conversions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  from_product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  to_product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  factor          numeric(12,3) NOT NULL CHECK (factor > 0),
  is_active       boolean NOT NULL DEFAULT true,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, from_product_id, to_product_id),
  CHECK (from_product_id <> to_product_id)
);
CREATE INDEX product_conversions_from_idx ON product_conversions (store_id, from_product_id) WHERE is_active;

-- the posted document: breaking N packs into N*factor units
CREATE TABLE stock_conversions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  doc_no          text NOT NULL,
  from_product_id uuid NOT NULL REFERENCES products(id),
  to_product_id   uuid NOT NULL REFERENCES products(id),
  from_qty        numeric(12,3) NOT NULL CHECK (from_qty > 0),
  to_qty          numeric(12,3) NOT NULL CHECK (to_qty > 0),
  factor          numeric(12,3) NOT NULL CHECK (factor > 0),
  unit_cost       numeric(14,4) NOT NULL DEFAULT 0,  -- cost carried to one produced unit
  total_cost      numeric(14,4) NOT NULL DEFAULT 0,
  note            text,
  converted_at    timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (store_id, doc_no)
);
CREATE INDEX stock_conversions_store_idx ON stock_conversions (store_id, converted_at DESC);

-- same tenant isolation as every other store-scoped table (see 0007)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_conversions', 'stock_conversions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass_rls() OR store_id = app_current_store_id()) WITH CHECK (app_bypass_rls() OR store_id = app_current_store_id())',
      t);
  END LOOP;
END $$;
