-- A till sends the same cart twice when its confirm button is activated twice within a few
-- milliseconds (a bouncing mouse switch, a key repeat) — บ้านแก่นใต้ got three duplicate bills
-- that way. Each cart now carries an id of its own, and the database refuses to write the same
-- one twice, so a second attempt can be answered with the bill that already exists.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_ref text;

CREATE UNIQUE INDEX IF NOT EXISTS sales_client_ref_uq ON sales (store_id, client_ref) WHERE client_ref IS NOT NULL;
