DROP TABLE IF EXISTS recipe_lines, recipes, menu_item_modifier_groups, modifiers, modifier_groups, menu_items, menu_categories, kitchen_stations;
ALTER TABLE stores DROP COLUMN IF EXISTS kind;
DROP TYPE IF EXISTS store_kind;
-- the three stock_move_type values stay: PostgreSQL cannot remove a label from an enum, and they
-- are harmless while unused
