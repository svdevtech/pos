-- 0005_inventory: purchase receipts, stock ledger, adjustments, stock takes, expenses
CREATE TYPE receipt_status AS ENUM ('draft', 'posted', 'cancelled', 'legacy_orphan');
CREATE TYPE stock_move_type AS ENUM ('opening', 'sale', 'sale_cancel', 'return', 'receipt', 'receipt_cancel', 'adjustment', 'stocktake', 'transfer_in', 'transfer_out');
CREATE TYPE stocktake_status AS ENUM ('open', 'finalized', 'cancelled');

CREATE TABLE purchase_receipts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  doc_no        text NOT NULL,                        -- OD6602-00005
  supplier_id   uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_ref  text,                                 -- supplier invoice no.
  received_at   timestamptz NOT NULL DEFAULT now(),
  received_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  received_by_name text,
  subtotal      numeric(14,2) NOT NULL DEFAULT 0,
  vat           numeric(14,2) NOT NULL DEFAULT 0,
  total         numeric(14,2) NOT NULL DEFAULT 0,
  status        receipt_status NOT NULL DEFAULT 'posted',
  note          text,
  legacy_id     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, doc_no)
);
CREATE INDEX purchase_receipts_time_idx ON purchase_receipts (store_id, received_at DESC);
CREATE INDEX purchase_receipts_supplier_idx ON purchase_receipts (store_id, supplier_id);
CREATE TRIGGER trg_purchase_receipts_updated BEFORE UPDATE ON purchase_receipts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE purchase_receipt_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  receipt_id  uuid NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  line_no     integer NOT NULL,
  product_id  uuid REFERENCES products(id) ON DELETE SET NULL,
  sku         text,
  description text,
  qty         numeric(12,3) NOT NULL,
  unit_cost   numeric(14,4) NOT NULL,
  total       numeric(14,2) NOT NULL,
  legacy_id   text,
  UNIQUE (receipt_id, line_no)
);
CREATE INDEX purchase_receipt_lines_product_idx ON purchase_receipt_lines (store_id, product_id);

CREATE TABLE stock_movements (
  id            bigserial PRIMARY KEY,
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  move_type     stock_move_type NOT NULL,
  qty_delta     numeric(12,3) NOT NULL,
  unit_cost     numeric(14,4),
  balance_after numeric(12,3) NOT NULL,
  ref_type      text,
  ref_id        uuid,
  note          text,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_product_time_idx ON stock_movements (store_id, product_id, occurred_at DESC);
CREATE INDEX stock_movements_ref_idx ON stock_movements (ref_type, ref_id);

CREATE TABLE stock_adjustments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  doc_no       text NOT NULL,
  reason       text NOT NULL,                        -- damaged, expired, correction, ...
  note         text,
  adjusted_at  timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (store_id, doc_no)
);

CREATE TABLE stock_adjustment_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id  uuid NOT NULL REFERENCES stock_adjustments(id) ON DELETE CASCADE,
  product_id     uuid NOT NULL REFERENCES products(id),
  qty_delta      numeric(12,3) NOT NULL,
  unit_cost      numeric(14,4),
  note           text
);

CREATE TABLE stock_takes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  doc_no        text NOT NULL,
  status        stocktake_status NOT NULL DEFAULT 'open',
  note          text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finalized_at  timestamptz,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (store_id, doc_no)
);

CREATE TABLE stock_take_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_take_id uuid NOT NULL REFERENCES stock_takes(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES products(id),
  system_qty    numeric(12,3) NOT NULL,
  counted_qty   numeric(12,3),
  note          text,
  UNIQUE (stock_take_id, product_id)
);

CREATE TABLE expense_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name        text NOT NULL,
  name_en     text,
  is_active   boolean NOT NULL DEFAULT true,
  legacy_id   text,
  UNIQUE (store_id, name)
);
CREATE UNIQUE INDEX expense_types_legacy_uq ON expense_types (store_id, legacy_id) WHERE legacy_id IS NOT NULL;

CREATE TABLE expenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  type_id       uuid REFERENCES expense_types(id) ON DELETE SET NULL,
  expensed_at   date NOT NULL,
  amount        numeric(14,2) NOT NULL,
  note          text,
  paid_from     payment_method NOT NULL DEFAULT 'cash',
  shift_id      uuid REFERENCES shifts(id) ON DELETE SET NULL,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by_name text,
  legacy_id     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX expenses_legacy_uq ON expenses (store_id, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX expenses_time_idx ON expenses (store_id, expensed_at DESC);
