-- 0002_catalog: categories, units, suppliers, products, barcodes, price tiers, label templates
CREATE TABLE product_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name        text NOT NULL,
  name_en     text,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  legacy_id   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, name)
);
CREATE UNIQUE INDEX product_categories_legacy_uq ON product_categories (store_id, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER trg_product_categories_updated BEFORE UPDATE ON product_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE units (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name        text NOT NULL,
  name_en     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, name)
);

CREATE TABLE suppliers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code        text,
  name        text NOT NULL,
  address     text,
  phone       text,
  fax         text,
  email       text,
  tax_id      text,
  note        text,
  is_active   boolean NOT NULL DEFAULT true,
  legacy_id   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_legacy_uq ON suppliers (store_id, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX suppliers_name_trgm ON suppliers USING gin (name gin_trgm_ops);
CREATE TRIGGER trg_suppliers_updated BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sku             text NOT NULL,                        -- legacy pro_id (usually the EAN)
  name            text NOT NULL,
  name_en         text,
  category_id     uuid REFERENCES product_categories(id) ON DELETE SET NULL,
  unit_id         uuid REFERENCES units(id) ON DELETE SET NULL,
  cost_last       numeric(14,4) NOT NULL DEFAULT 0,     -- legacy pro_costprice
  cost_avg        numeric(14,4) NOT NULL DEFAULT 0,     -- legacy pro_costpriceavg (moving average)
  sell_price      numeric(14,2) NOT NULL DEFAULT 0,     -- legacy pro_buyprice
  stock_on_hand   numeric(12,3) NOT NULL DEFAULT 0,
  min_level1      numeric(12,3) NOT NULL DEFAULT 0,     -- reorder warning
  min_level2      numeric(12,3) NOT NULL DEFAULT 0,     -- critical
  is_serial       boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  is_archived     boolean NOT NULL DEFAULT false,
  archived_reason text,                                 -- deleted | placeholder_orphan
  archived_at     timestamptz,
  image_url       text,
  note            text,
  legacy_id       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, sku)
);
CREATE UNIQUE INDEX products_legacy_uq ON products (store_id, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE INDEX products_category_idx ON products (store_id, category_id);
CREATE INDEX products_low_stock_idx ON products (store_id) WHERE is_active AND NOT is_archived;
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_barcodes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  barcode     text NOT NULL,
  is_primary  boolean NOT NULL DEFAULT false,
  pack_qty    numeric(12,3) NOT NULL DEFAULT 1,         -- barcode of a pack of N units
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, barcode)
);
CREATE INDEX product_barcodes_product_idx ON product_barcodes (product_id);

CREATE TABLE price_tiers (
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tier        smallint NOT NULL CHECK (tier BETWEEN 1 AND 4),
  price       numeric(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, tier)
);

CREATE TABLE barcode_label_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  paper       text NOT NULL DEFAULT 'A4',
  columns_n   integer NOT NULL DEFAULT 4,
  rows_n      integer NOT NULL DEFAULT 11,
  dims        jsonb NOT NULL DEFAULT '{}'::jsonb,      -- mm: page_left, page_top, page_width, bar_width, bar_height, margins
  fonts       jsonb NOT NULL DEFAULT '{}'::jsonb,
  visible     jsonb NOT NULL DEFAULT '{}'::jsonb,      -- barcode, sku, name, price flags
  legacy_id   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, code)
);
