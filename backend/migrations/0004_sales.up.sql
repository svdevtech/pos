-- 0004_sales: shifts, drawer log, held bills, sales, lines, tenders, returns, AR payments, promotions
CREATE TYPE shift_status AS ENUM ('open', 'closed');
CREATE TYPE drawer_reason AS ENUM ('sale', 'no_sale', 'paid_in', 'paid_out', 'shift_open', 'shift_close');
CREATE TYPE sale_status AS ENUM ('completed', 'cancelled', 'refunded', 'partial_refund');
CREATE TYPE ar_status AS ENUM ('none', 'unpaid', 'partial', 'paid');
CREATE TYPE payment_method AS ENUM ('cash', 'credit', 'transfer', 'card', 'qr', 'other');
CREATE TYPE promo_scope AS ENUM ('bill', 'product');
CREATE TYPE discount_type AS ENUM ('amount', 'percent');

CREATE TABLE shifts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  cashier_id     uuid NOT NULL REFERENCES users(id),
  terminal       text NOT NULL DEFAULT 'POS1',
  opened_at      timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz,
  closed_by      uuid REFERENCES users(id),
  opening_float  numeric(14,2) NOT NULL DEFAULT 0,
  cash_sales     numeric(14,2) NOT NULL DEFAULT 0,
  cash_in        numeric(14,2) NOT NULL DEFAULT 0,
  cash_out       numeric(14,2) NOT NULL DEFAULT 0,
  expected_cash  numeric(14,2),
  counted_cash   numeric(14,2),
  variance       numeric(14,2),
  status         shift_status NOT NULL DEFAULT 'open',
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shifts_store_open_idx ON shifts (store_id, status, opened_at DESC);

CREATE TABLE cash_drawer_logs (
  id          bigserial PRIMARY KEY,
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  shift_id    uuid REFERENCES shifts(id) ON DELETE SET NULL,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  user_name   text,
  reason      drawer_reason NOT NULL DEFAULT 'no_sale',
  amount      numeric(14,2) NOT NULL DEFAULT 0,
  note        text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  legacy_id   text
);
CREATE INDEX cash_drawer_logs_store_time_idx ON cash_drawer_logs (store_id, occurred_at DESC);

CREATE TABLE held_bills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  cashier_id  uuid NOT NULL REFERENCES users(id),
  label       text,
  member_id   uuid REFERENCES members(id) ON DELETE SET NULL,
  cart        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '1 day'
);
CREATE INDEX held_bills_store_idx ON held_bills (store_id, created_at DESC);

CREATE TABLE sales (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  doc_no           text NOT NULL,                       -- N6602-05115
  legacy_dup_seq   smallint NOT NULL DEFAULT 0,         -- >0 only for the Dec-2022 duplicated legacy numbers
  sold_at          timestamptz NOT NULL DEFAULT now(),
  cashier_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  cashier_name     text,
  member_id        uuid REFERENCES members(id) ON DELETE SET NULL,
  shift_id         uuid REFERENCES shifts(id) ON DELETE SET NULL,
  gross            numeric(14,2) NOT NULL DEFAULT 0,    -- Σ line totals before discount
  discount         numeric(14,2) NOT NULL DEFAULT 0,    -- Σ line discounts + bill discount
  bill_discount    numeric(14,2) NOT NULL DEFAULT 0,
  vat              numeric(14,2) NOT NULL DEFAULT 0,
  net              numeric(14,2) NOT NULL DEFAULT 0,    -- amount due
  tendered         numeric(14,2) NOT NULL DEFAULT 0,
  change_amount    numeric(14,2) NOT NULL DEFAULT 0,
  status           sale_status NOT NULL DEFAULT 'completed',
  cancelled_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  cancelled_by_name text,
  cancelled_at     timestamptz,
  cancel_reason    text,
  ar_status        ar_status NOT NULL DEFAULT 'none',
  ar_total         numeric(14,2) NOT NULL DEFAULT 0,
  ar_paid          numeric(14,2) NOT NULL DEFAULT 0,
  ar_balance       numeric(14,2) NOT NULL DEFAULT 0,
  note             text,
  legacy_tender    smallint,                            -- legacy buy_type 1..4
  legacy_id        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, doc_no, legacy_dup_seq)
);
CREATE INDEX sales_store_time_idx ON sales (store_id, sold_at DESC);
CREATE INDEX sales_member_time_idx ON sales (store_id, member_id, sold_at);
CREATE INDEX sales_ar_idx ON sales (store_id, ar_status) WHERE ar_status IN ('unpaid', 'partial');
CREATE INDEX sales_shift_idx ON sales (shift_id);
CREATE TRIGGER trg_sales_updated BEFORE UPDATE ON sales FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sale_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sale_id      uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  line_no      integer NOT NULL,
  product_id   uuid REFERENCES products(id) ON DELETE SET NULL,
  sku          text,
  description  text NOT NULL,
  qty          numeric(12,3) NOT NULL,
  unit_price   numeric(14,2) NOT NULL,
  discount     numeric(14,2) NOT NULL DEFAULT 0,
  line_total   numeric(14,2) NOT NULL,                  -- qty*unit_price - discount
  cost_last    numeric(14,4) NOT NULL DEFAULT 0,        -- snapshot at time of sale
  cost_avg     numeric(14,4) NOT NULL DEFAULT 0,
  is_free      boolean NOT NULL DEFAULT false,
  serial_no    text,
  promotion_id uuid,
  legacy_id    text,
  UNIQUE (sale_id, line_no)
);
CREATE INDEX sale_lines_product_idx ON sale_lines (store_id, product_id);
CREATE INDEX sale_lines_sale_idx ON sale_lines (sale_id);

CREATE TABLE sale_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sale_id     uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method      payment_method NOT NULL,
  amount      numeric(14,2) NOT NULL,
  reference   text,                                     -- transfer ref / card slip
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_payments_sale_idx ON sale_payments (sale_id);
CREATE INDEX sale_payments_store_method_idx ON sale_payments (store_id, method, created_at);

CREATE TABLE sale_returns (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  doc_no         text NOT NULL,
  sale_id        uuid NOT NULL REFERENCES sales(id),
  returned_at    timestamptz NOT NULL DEFAULT now(),
  processed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  refund_method  payment_method NOT NULL DEFAULT 'cash',
  refund_amount  numeric(14,2) NOT NULL DEFAULT 0,
  restock        boolean NOT NULL DEFAULT true,
  reason         text,
  UNIQUE (store_id, doc_no)
);

CREATE TABLE sale_return_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id     uuid NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  sale_line_id  uuid NOT NULL REFERENCES sale_lines(id),
  product_id    uuid REFERENCES products(id) ON DELETE SET NULL,
  qty           numeric(12,3) NOT NULL,
  unit_price    numeric(14,2) NOT NULL,
  amount        numeric(14,2) NOT NULL
);

-- accounts-receivable (ลูกหนี้) payments; sale_id NULL for legacy payments whose bill was purged
CREATE TABLE ar_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  doc_no          text,
  member_id       uuid REFERENCES members(id) ON DELETE SET NULL,
  sale_id         uuid REFERENCES sales(id) ON DELETE SET NULL,
  legacy_bill_no  text,
  bill_total      numeric(14,2) NOT NULL DEFAULT 0,
  balance_before  numeric(14,2) NOT NULL DEFAULT 0,
  amount          numeric(14,2) NOT NULL,
  balance_after   numeric(14,2) NOT NULL DEFAULT 0,
  method          payment_method NOT NULL DEFAULT 'cash',
  paid_at         timestamptz NOT NULL DEFAULT now(),
  received_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  received_by_name text,
  note            text,
  legacy_id       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ar_payments_legacy_uq ON ar_payments (store_id, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX ar_payments_member_idx ON ar_payments (store_id, member_id, paid_at DESC);
CREATE INDEX ar_payments_sale_idx ON ar_payments (sale_id);

CREATE TABLE promotions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name           text NOT NULL,
  scope          promo_scope NOT NULL,
  product_id     uuid REFERENCES products(id) ON DELETE CASCADE,
  min_qty        numeric(12,3) NOT NULL DEFAULT 0,     -- product scope: buy at least N
  min_amount     numeric(14,2) NOT NULL DEFAULT 0,     -- bill scope: bill >= amount
  discount_type  discount_type NOT NULL DEFAULT 'amount',
  discount_value numeric(14,2) NOT NULL DEFAULT 0,
  free_qty       numeric(12,3) NOT NULL DEFAULT 0,     -- buy N get free_qty
  starts_at      timestamptz,
  ends_at        timestamptz,
  is_active      boolean NOT NULL DEFAULT true,
  legacy_id      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX promotions_active_idx ON promotions (store_id, is_active, starts_at, ends_at);
CREATE TRIGGER trg_promotions_updated BEFORE UPDATE ON promotions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
