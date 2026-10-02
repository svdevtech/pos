DROP INDEX IF EXISTS sales_client_ref_uq;

ALTER TABLE sales DROP COLUMN IF EXISTS client_ref;
