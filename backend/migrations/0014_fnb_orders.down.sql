DROP INDEX IF EXISTS sales_order_idx;
ALTER TABLE sales DROP COLUMN IF EXISTS order_id;
DROP TABLE IF EXISTS order_events, order_item_modifiers, order_items, orders;
