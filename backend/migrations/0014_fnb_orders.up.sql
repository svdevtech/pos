-- F&B phase 0: orders. An order is what a table or a counter customer asked for; it is not a
-- bill — a bill (sales) is cut when the order is paid, and one order may be split into several.
--
-- Tables and the floor plan come in phase 1; until then a dine-in order carries the table's
-- code as text so the kitchen ticket can say where it goes.

CREATE TABLE orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  -- counts up per store per day; the number the kitchen and the queue screen call out
  order_no        int  NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('counter', 'dine_in', 'takeaway', 'delivery', 'self_order')),
  table_code      text,
  guests          int,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'closed', 'void')),
  service_charge  numeric(14,2) NOT NULL DEFAULT 0,
  note            text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz
);
CREATE INDEX orders_store_open_idx ON orders (store_id, status, created_at);
CREATE INDEX orders_store_day_idx  ON orders (store_id, created_at DESC);

-- One line of an order. Name and price are snapshots: the menu may change tomorrow, the ticket
-- must not. `cost` is what the recipe took off stock, priced at average cost, when it was made.
CREATE TABLE order_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id  uuid REFERENCES menu_items(id) ON DELETE SET NULL,
  station_id    uuid REFERENCES kitchen_stations(id) ON DELETE SET NULL,
  name          text NOT NULL,
  qty           numeric(12,3) NOT NULL CHECK (qty > 0),
  unit_price    numeric(14,2) NOT NULL DEFAULT 0,
  cost          numeric(14,2) NOT NULL DEFAULT 0,
  seat          int,
  course        int  NOT NULL DEFAULT 1,
  note          text,
  status        text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'preparing', 'ready', 'served', 'void')),
  -- stock was taken for this line (so a void knows whether to give it back or write it off)
  deducted      boolean NOT NULL DEFAULT false,
  sort          int  NOT NULL DEFAULT 0,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  ready_at      timestamptz,
  served_at     timestamptz
);
CREATE INDEX order_items_order_idx   ON order_items (order_id, sort);
CREATE INDEX order_items_station_idx ON order_items (store_id, station_id, status);

CREATE TABLE order_item_modifiers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_item_id  uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  modifier_id    uuid REFERENCES modifiers(id) ON DELETE SET NULL,
  name           text NOT NULL,
  price_delta    numeric(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX order_item_modifiers_item_idx ON order_item_modifiers (order_item_id);

-- Who did what to an order and when: the kitchen's timing reports and any dispute come from here.
CREATE TABLE order_events (
  id        bigserial PRIMARY KEY,
  store_id  uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_id  uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id   uuid REFERENCES order_items(id) ON DELETE CASCADE,
  kind      text NOT NULL,
  detail    jsonb,
  by_user   uuid REFERENCES users(id) ON DELETE SET NULL,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events (order_id, at);

-- a bill can come from an order (and an order can be split into several bills)
ALTER TABLE sales ADD COLUMN order_id uuid REFERENCES orders(id) ON DELETE SET NULL;
CREATE INDEX sales_order_idx ON sales (order_id) WHERE order_id IS NOT NULL;

-- same tenant isolation as every other store-scoped table (see 0007)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders', 'order_items', 'order_item_modifiers', 'order_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass_rls() OR store_id = app_current_store_id()) WITH CHECK (app_bypass_rls() OR store_id = app_current_store_id())',
      t);
  END LOOP;
END $$;
