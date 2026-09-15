-- The dining room, per store: zones (indoor, terrace, bar) and the tables in them, with a
-- position in metres so both floor plans draw the room to scale. A table is known to orders and
-- QR tokens by its code, so renaming a zone or moving a table never touches an order.
CREATE TABLE fnb_zones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name        text NOT NULL,
  name_en     text,
  color       text NOT NULL DEFAULT '#2b3d55',
  sort        int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fnb_tables (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  zone_id     uuid REFERENCES fnb_zones(id) ON DELETE SET NULL,
  code        text NOT NULL,
  seats       int NOT NULL DEFAULT 4,
  x           numeric(6,2) NOT NULL DEFAULT 1,
  y           numeric(6,2) NOT NULL DEFAULT 1,
  shape       text NOT NULL DEFAULT 'square' CHECK (shape IN ('round','square','long')),
  rotation    int NOT NULL DEFAULT 0,
  sort        int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, code)
);

-- The bill an order was paid on. One bill may settle several orders on a table, so the link
-- lives on the order (sales.order_id, from 0014, keeps pointing at the first of them).
ALTER TABLE orders ADD COLUMN sale_id uuid REFERENCES sales(id) ON DELETE SET NULL;
CREATE INDEX orders_sale_idx ON orders (sale_id) WHERE sale_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fnb_zones','fnb_tables'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (app_bypass_rls() OR store_id = app_current_store_id()) WITH CHECK (app_bypass_rls() OR store_id = app_current_store_id())', t);
  END LOOP;
END $$;
