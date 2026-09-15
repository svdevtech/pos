-- F&B phase 0: a store can be a restaurant/café, and a menu item carries a recipe that is
-- deducted from ingredient stock when the dish is made (docs/FNB_POS_PLAN.md §9).
--
-- Nothing here changes behaviour for a retail store: kind defaults to 'retail' and every new
-- table stays empty until an F&B store fills it.

CREATE TYPE store_kind AS ENUM ('retail', 'fnb');
ALTER TABLE stores ADD COLUMN kind store_kind NOT NULL DEFAULT 'retail';

-- recipe: ingredients taken when a dish is made · production: a batch (stock, syrup) made from
-- ingredients · waste: something made and thrown away. Added, never used, in this transaction.
ALTER TYPE stock_move_type ADD VALUE IF NOT EXISTS 'recipe';
ALTER TYPE stock_move_type ADD VALUE IF NOT EXISTS 'production';
ALTER TYPE stock_move_type ADD VALUE IF NOT EXISTS 'waste';

-- Where a dish is made and how the station is told: a screen, a printer, or both.
CREATE TABLE kitchen_stations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name          text NOT NULL,
  name_en       text,
  output        text NOT NULL DEFAULT 'kds' CHECK (output IN ('kds', 'printer', 'both')),
  printer_name  text,
  sort          int  NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, name)
);

CREATE TABLE menu_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name        text NOT NULL,
  name_en     text,
  sort        int  NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, name)
);

-- A menu item is what the customer orders. It may point at a product (a bottled drink sold as-is,
-- so stock is the product itself) or carry a recipe instead (a latte: stock is the beans and milk).
CREATE TABLE menu_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  category_id   uuid REFERENCES menu_categories(id) ON DELETE SET NULL,
  product_id    uuid REFERENCES products(id) ON DELETE SET NULL,
  station_id    uuid REFERENCES kitchen_stations(id) ON DELETE SET NULL,
  name          text NOT NULL,
  name_en       text,
  price         numeric(14,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  image_url     text,
  -- which order channels may see it; a counter-only pastry is not on the dine-in menu
  channels      text[] NOT NULL DEFAULT ARRAY['counter', 'dine_in', 'takeaway', 'delivery', 'self_order'],
  sort          int  NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX menu_items_store_cat_idx ON menu_items (store_id, category_id, sort);

-- "ขนาด", "ความหวาน", "นม": a question asked when the item is ordered.
CREATE TABLE modifier_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name        text NOT NULL,
  name_en     text,
  min_select  int NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select  int NOT NULL DEFAULT 1 CHECK (max_select >= 1),
  sort        int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, name),
  CHECK (min_select <= max_select)
);

CREATE TABLE modifiers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  group_id     uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name         text NOT NULL,
  name_en      text,
  price_delta  numeric(14,2) NOT NULL DEFAULT 0,
  is_default   boolean NOT NULL DEFAULT false,
  sort         int NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, name)
);

CREATE TABLE menu_item_modifier_groups (
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  menu_item_id  uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  group_id      uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  sort          int NOT NULL DEFAULT 0,
  PRIMARY KEY (menu_item_id, group_id)
);

-- One recipe per menu item. yield_qty is how many sell units the recipe makes: 1 for a latte, 10
-- for a pot of soup that fills ten bowls.
CREATE TABLE recipes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  menu_item_id  uuid NOT NULL UNIQUE REFERENCES menu_items(id) ON DELETE CASCADE,
  yield_qty     numeric(12,3) NOT NULL DEFAULT 1 CHECK (yield_qty > 0),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- An ingredient line belongs to a recipe (the dish) or to a modifier (an extra shot, oat milk).
-- qty is in `unit`; factor_to_stock converts it to the unit the ingredient's stock is counted in
-- (200 ml of milk stocked in litres → qty 200, factor 0.001). A `replace` line on a modifier takes
-- the place of the recipe's line for replaces_product_id (oat milk instead of fresh milk).
CREATE TABLE recipe_lines (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id               uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  recipe_id              uuid REFERENCES recipes(id) ON DELETE CASCADE,
  modifier_id            uuid REFERENCES modifiers(id) ON DELETE CASCADE,
  ingredient_product_id  uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty                    numeric(12,4) NOT NULL CHECK (qty >= 0),
  unit_id                uuid REFERENCES units(id) ON DELETE SET NULL,
  factor_to_stock        numeric(14,6) NOT NULL DEFAULT 1 CHECK (factor_to_stock > 0),
  waste_pct              numeric(6,3) NOT NULL DEFAULT 0 CHECK (waste_pct >= 0 AND waste_pct <= 100),
  mode                   text NOT NULL DEFAULT 'add' CHECK (mode IN ('add', 'replace')),
  replaces_product_id    uuid REFERENCES products(id) ON DELETE SET NULL,
  sort                   int NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(recipe_id, modifier_id) = 1),
  CHECK (mode = 'add' OR replaces_product_id IS NOT NULL)
);
CREATE INDEX recipe_lines_recipe_idx ON recipe_lines (recipe_id);
CREATE INDEX recipe_lines_modifier_idx ON recipe_lines (modifier_id);

-- same tenant isolation as every other store-scoped table (see 0007)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['kitchen_stations', 'menu_categories', 'menu_items', 'modifier_groups', 'modifiers',
                           'menu_item_modifier_groups', 'recipes', 'recipe_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass_rls() OR store_id = app_current_store_id()) WITH CHECK (app_bypass_rls() OR store_id = app_current_store_id())',
      t);
  END LOOP;
END $$;
