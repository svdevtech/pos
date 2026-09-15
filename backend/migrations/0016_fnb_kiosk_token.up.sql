-- Two addresses per table. The code customers scan (token) is replaced every time the table is
-- closed, so a photo of it taken during one meal cannot order at the next; the tablet fixed to
-- the table keeps one address for good (kiosk_token) and is told the new customer code over its
-- stream, so it never needs reloading.
ALTER TABLE table_tokens ADD COLUMN kiosk_token text;
UPDATE table_tokens SET kiosk_token = 'k' || replace(gen_random_uuid()::text, '-', '') WHERE kiosk_token IS NULL;
ALTER TABLE table_tokens ALTER COLUMN kiosk_token SET NOT NULL;
ALTER TABLE table_tokens ADD CONSTRAINT table_tokens_kiosk_token_key UNIQUE (kiosk_token);
