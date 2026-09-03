-- 0003_members: co-op members (customers) and share-capital ledger
CREATE TYPE member_status AS ENUM ('active', 'inactive', 'suspended');
CREATE TYPE share_tx_type AS ENUM ('opening', 'deposit', 'withdraw', 'adjust', 'dividend_reinvest');

CREATE TABLE members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  member_code     text NOT NULL,                       -- legacy cust_id; '0' = walk-in
  name            text NOT NULL,
  address         text,
  phone           text,
  email           text,
  national_id     text,
  line_user_id    text,
  line_display    text,
  share_capital   numeric(14,2) NOT NULL DEFAULT 0,    -- legacy cust_hunmoney (฿)
  joined_at       date,
  price_tier      smallint NOT NULL DEFAULT 0 CHECK (price_tier BETWEEN 0 AND 4),
  is_walkin       boolean NOT NULL DEFAULT false,
  status          member_status NOT NULL DEFAULT 'active',
  note            text,
  legacy_id       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, member_code)
);
CREATE UNIQUE INDEX members_legacy_uq ON members (store_id, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX members_line_uq ON members (store_id, line_user_id) WHERE line_user_id IS NOT NULL;
CREATE INDEX members_phone_idx ON members (store_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX members_name_trgm ON members USING gin (name gin_trgm_ops);
CREATE TRIGGER trg_members_updated BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE member_share_transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  tx_type       share_tx_type NOT NULL,
  amount        numeric(14,2) NOT NULL,                -- signed: deposit +, withdraw -
  balance_after numeric(14,2) NOT NULL,
  note          text,
  ref_type      text,
  ref_id        uuid,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX member_share_tx_member_idx ON member_share_transactions (member_id, occurred_at);

-- one-time linking codes shown in the back office so a member can link LINE in LIFF
CREATE TABLE member_link_codes (
  code        text PRIMARY KEY,
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
