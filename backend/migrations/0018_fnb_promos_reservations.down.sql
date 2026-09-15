DROP TABLE IF EXISTS fnb_reservations;
ALTER TABLE order_items DROP COLUMN IF EXISTS promo_id, DROP COLUMN IF EXISTS promo_name, DROP COLUMN IF EXISTS list_price;
DROP TABLE IF EXISTS menu_promos;
