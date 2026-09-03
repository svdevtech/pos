-- 0001_core: extensions, tenancy primitives, stores, users, auth, audit, document sequences
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Tenancy helpers
-- The API sets `SET LOCAL app.current_store_id = '<uuid>'` inside every transaction.
-- Platform-admin and migration paths set `SET LOCAL app.bypass_rls = 'on'`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_store_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_store_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
$$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('platform_admin', 'store_owner', 'manager', 'cashier', 'viewer');
CREATE TYPE locale_code AS ENUM ('th', 'en');

-- ---------------------------------------------------------------------------
-- Stores (tenants)
-- ---------------------------------------------------------------------------
CREATE TABLE stores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,                 -- short code typed at login, e.g. BBR
  name            text NOT NULL,
  name_en         text,
  address         text,
  phone           text,
  tax_id          text,
  receipt_header  text,                                 -- legacy company_textbuttom / receipt title
  receipt_footer  text,
  logo            bytea,
  default_locale  locale_code NOT NULL DEFAULT 'th',
  timezone        text NOT NULL DEFAULT 'Asia/Bangkok',
  is_active       boolean NOT NULL DEFAULT true,
  legacy_id       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_stores_updated BEFORE UPDATE ON stores FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE store_settings (
  store_id    uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,       -- vat_type, rounding, paper_width, drawer_port, display_port, allow_price_edit, receipt_locale ...
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Users / auth
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            uuid REFERENCES stores(id) ON DELETE CASCADE,   -- NULL = platform admin
  username            text NOT NULL,
  password_hash       text NOT NULL,
  display_name        text NOT NULL,
  phone               text,
  role                user_role NOT NULL DEFAULT 'cashier',
  locale              locale_code NOT NULL DEFAULT 'th',
  is_active           boolean NOT NULL DEFAULT true,
  must_reset_password boolean NOT NULL DEFAULT false,
  last_login_at       timestamptz,
  legacy_id           text,
  legacy_level        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- username unique per store; platform admins unique globally
CREATE UNIQUE INDEX users_store_username_uq ON users (COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(username));
CREATE UNIQUE INDEX users_store_legacy_uq ON users (store_id, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  user_agent  text,
  ip          text
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  store_id    uuid REFERENCES stores(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_name  text,
  action      text NOT NULL,          -- e.g. sale.cancel, product.update
  entity      text NOT NULL,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_store_time_idx ON audit_logs (store_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (store_id, entity, entity_id);

-- ---------------------------------------------------------------------------
-- Document number sequences (per store, per doc type, per period e.g. BE yyMM '6602')
-- ---------------------------------------------------------------------------
CREATE TABLE doc_sequences (
  store_id  uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  doc_type  text NOT NULL,   -- sale | receipt | return | adjustment | stocktake | arpay
  period    text NOT NULL,
  last_seq  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, doc_type, period)
);

-- next_doc_seq atomically increments and returns the next sequence number
CREATE OR REPLACE FUNCTION next_doc_seq(p_store uuid, p_type text, p_period text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
  INSERT INTO doc_sequences (store_id, doc_type, period, last_seq)
  VALUES (p_store, p_type, p_period, 1)
  ON CONFLICT (store_id, doc_type, period)
  DO UPDATE SET last_seq = doc_sequences.last_seq + 1
  RETURNING last_seq INTO v;
  RETURN v;
END $$;
