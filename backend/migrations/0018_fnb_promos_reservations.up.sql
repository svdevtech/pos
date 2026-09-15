-- Time-of-day promotions on the menu (happy hour), what a line was worth before one applied,
-- and the reservation book / walk-in waitlist.
CREATE TABLE menu_promos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name          text NOT NULL,
  -- percent off, baht off, or a fixed price while the promotion runs
  kind          text NOT NULL CHECK (kind IN ('percent','amount','price')),
  value         numeric(14,2) NOT NULL DEFAULT 0,
  category_id   uuid REFERENCES menu_categories(id) ON DELETE CASCADE,
  menu_item_id  uuid REFERENCES menu_items(id) ON DELETE CASCADE,
  -- 0 = Sunday … 6 = Saturday
  days          int[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  start_time    time NOT NULL DEFAULT '00:00',
  end_time      time NOT NULL DEFAULT '23:59',
  starts_on     date,
  ends_on       date,
  is_active     boolean NOT NULL DEFAULT true,
  sort          int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX menu_promos_store_idx ON menu_promos (store_id, is_active);

ALTER TABLE order_items
  ADD COLUMN promo_id   uuid REFERENCES menu_promos(id) ON DELETE SET NULL,
  ADD COLUMN promo_name text,
  ADD COLUMN list_price numeric(14,2);

CREATE TABLE fnb_reservations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('reservation','waitlist')),
  name        text NOT NULL,
  phone       text,
  party_size  int NOT NULL DEFAULT 2,
  -- the booked time, or when a walk-in party joined the waitlist
  at          timestamptz NOT NULL DEFAULT now(),
  table_code  text,
  note        text,
  status      text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','waiting','seated','cancelled','no_show')),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fnb_reservations_store_at_idx ON fnb_reservations (store_id, at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['menu_promos','fnb_reservations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (app_bypass_rls() OR store_id = app_current_store_id()) WITH CHECK (app_bypass_rls() OR store_id = app_current_store_id())', t);
  END LOOP;
END $$;
