-- 0006_dividends: annual dividend (ปันผล) periods, criteria, runs, member statements, payouts
CREATE TYPE dividend_period_status AS ENUM ('draft', 'simulated', 'approved', 'paid', 'closed');
CREATE TYPE dividend_criterion_kind AS ENUM ('share_rule', 'allocation');
CREATE TYPE dividend_pool AS ENUM ('HUN', 'AVG', 'OTHER');   -- HUN = share dividend pool, AVG = purchase rebate pool

CREATE TABLE dividend_periods (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  be_year       integer NOT NULL,                    -- Buddhist year e.g. 2565
  starts_on     date NOT NULL,
  ends_on       date NOT NULL,
  net_profit    numeric(14,2) NOT NULL DEFAULT 0,
  status        dividend_period_status NOT NULL DEFAULT 'draft',
  approved_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at   timestamptz,
  note          text,
  legacy_year   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, be_year)
);
CREATE TRIGGER trg_dividend_periods_updated BEFORE UPDATE ON dividend_periods FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dividend_criteria (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  period_id       uuid NOT NULL REFERENCES dividend_periods(id) ON DELETE CASCADE,
  kind            dividend_criterion_kind NOT NULL,
  name            text NOT NULL,
  name_en         text,
  percent         numeric(8,4) NOT NULL DEFAULT 0,    -- allocation % of net profit
  baht_per_share  numeric(14,2),                      -- share_rule: ฿ per 1 share (legacy percent of type 1)
  max_shares      numeric(14,4),                      -- share_rule: cap per member (legacy maxhun); NULL = no cap
  apply_cap       boolean NOT NULL DEFAULT false,     -- legacy data ignores the cap
  pool_code       dividend_pool NOT NULL DEFAULT 'OTHER',
  is_locked       boolean NOT NULL DEFAULT false,     -- legacy NOTDEL
  sort_order      integer NOT NULL DEFAULT 0,
  legacy_id       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dividend_criteria_period_idx ON dividend_criteria (period_id);
CREATE UNIQUE INDEX dividend_criteria_legacy_uq ON dividend_criteria (store_id, legacy_id) WHERE legacy_id IS NOT NULL;

CREATE TABLE dividend_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  period_id     uuid NOT NULL REFERENCES dividend_periods(id) ON DELETE CASCADE,
  run_no        integer NOT NULL,
  inputs        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- criteria + net_profit snapshot
  totals        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- total_shares, total_purchases, rate_per_share, rebate_rate, pools, allocations
  member_count  integer NOT NULL DEFAULT 0,
  is_final      boolean NOT NULL DEFAULT false,
  computed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  source        text NOT NULL DEFAULT 'engine',       -- engine | legacy_import
  UNIQUE (period_id, run_no)
);

CREATE TABLE dividend_member_statements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  run_id          uuid NOT NULL REFERENCES dividend_runs(id) ON DELETE CASCADE,
  member_id       uuid REFERENCES members(id) ON DELETE SET NULL,
  member_code     text NOT NULL,
  member_name     text NOT NULL,
  member_address  text,
  share_capital   numeric(14,2) NOT NULL DEFAULT 0,
  shares          numeric(14,4) NOT NULL DEFAULT 0,
  shares_effective numeric(14,4) NOT NULL DEFAULT 0,
  purchases       numeric(14,2) NOT NULL DEFAULT 0,
  share_dividend  numeric(14,2) NOT NULL DEFAULT 0,
  rebate          numeric(14,2) NOT NULL DEFAULT 0,
  total           numeric(14,2) NOT NULL DEFAULT 0,
  seq_no          integer,
  UNIQUE (run_id, member_code)
);
CREATE INDEX dividend_statements_member_idx ON dividend_member_statements (store_id, member_id);

CREATE TABLE dividend_payouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  statement_id  uuid NOT NULL REFERENCES dividend_member_statements(id) ON DELETE CASCADE,
  amount        numeric(14,2) NOT NULL,
  method        payment_method NOT NULL DEFAULT 'cash',
  paid_at       timestamptz NOT NULL DEFAULT now(),
  paid_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  note          text
);
CREATE INDEX dividend_payouts_statement_idx ON dividend_payouts (statement_id);
