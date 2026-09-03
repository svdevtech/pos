-- 0007_misc_rls: AI query logs, legacy import bookkeeping, monthly sales view, row-level security
CREATE TABLE ai_query_logs (
  id            bigserial PRIMARY KEY,
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  question      text NOT NULL,
  generated_sql text,
  row_count     integer,
  duration_ms   integer,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_query_logs_store_idx ON ai_query_logs (store_id, created_at DESC);

CREATE TABLE legacy_import_runs (
  id            bigserial PRIMARY KEY,
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  stage         text NOT NULL,
  source_sha256 text,
  file          text,
  file_sha256   text,
  rows_in       integer NOT NULL DEFAULT 0,
  rows_out      integer NOT NULL DEFAULT 0,
  rows_skipped  integer NOT NULL DEFAULT 0,
  dry_run       boolean NOT NULL DEFAULT false,
  report        jsonb,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

CREATE TABLE legacy_orphans (
  id          bigserial PRIMARY KEY,
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  source      text NOT NULL,          -- buydetails | orderdetails | payments | buymain
  reason      text NOT NULL,
  legacy_key  text,
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX legacy_orphans_store_idx ON legacy_orphans (store_id, source);

-- monthly sales summary (legacy chartmonth), refreshed by the reports service
CREATE MATERIALIZED VIEW monthly_sales_mv AS
SELECT store_id,
       date_trunc('month', sold_at AT TIME ZONE 'Asia/Bangkok')::date AS month,
       count(*)      AS bills,
       sum(gross)    AS gross,
       sum(discount) AS discount,
       sum(net)      AS net
FROM sales
WHERE status = 'completed'
GROUP BY store_id, 2
WITH NO DATA;
CREATE UNIQUE INDEX monthly_sales_mv_uq ON monthly_sales_mv (store_id, month);

-- ---------------------------------------------------------------------------
-- Row-level security on every table that carries store_id.
-- Policy: rows visible/writable only when store_id matches the transaction GUC,
-- unless app.bypass_rls = 'on' (platform admin / migration).
-- FORCE so that the table owner (the app role) is also subject to the policy.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'store_id' AND tb.table_type = 'BASE TABLE'
      AND c.table_name <> 'users'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass_rls() OR store_id = app_current_store_id()) WITH CHECK (app_bypass_rls() OR store_id = app_current_store_id())',
      t.table_name);
  END LOOP;
END $$;

-- users: platform admins (store_id NULL) are visible only in bypass mode; store users scoped as usual
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (app_bypass_rls() OR store_id = app_current_store_id())
  WITH CHECK (app_bypass_rls() OR store_id = app_current_store_id());

-- stores: a tenant can read its own store row; platform admin sees all
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stores
  USING (app_bypass_rls() OR id = app_current_store_id())
  WITH CHECK (app_bypass_rls() OR id = app_current_store_id());
