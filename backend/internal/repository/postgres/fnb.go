package postgres

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
)

// FnbRepo is the menu, recipes and orders of a restaurant / café store (migrations 0013, 0014).
type FnbRepo struct{}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

func (FnbRepo) Stations(ctx context.Context, storeID uuid.UUID) ([]domain.KitchenStation, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT id, store_id, name, COALESCE(name_en,''), output, COALESCE(printer_name,''), sort, is_active
		FROM kitchen_stations WHERE store_id=$1 ORDER BY sort, name`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.KitchenStation{}
	for rows.Next() {
		var s domain.KitchenStation
		if err := rows.Scan(&s.ID, &s.StoreID, &s.Name, &s.NameEn, &s.Output, &s.PrinterName, &s.Sort, &s.IsActive); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (FnbRepo) UpsertStation(ctx context.Context, s *domain.KitchenStation) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	_, err := Q(ctx).Exec(ctx, `INSERT INTO kitchen_stations (id, store_id, name, name_en, output, printer_name, sort, is_active)
		VALUES ($1,$2,$3,NULLIF($4,''),$5,NULLIF($6,''),$7,$8)
		ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, name_en=EXCLUDED.name_en, output=EXCLUDED.output, printer_name=EXCLUDED.printer_name,
			sort=EXCLUDED.sort, is_active=EXCLUDED.is_active, updated_at=now()`,
		s.ID, s.StoreID, s.Name, s.NameEn, s.Output, s.PrinterName, s.Sort, s.IsActive)
	return err
}

func (FnbRepo) Categories(ctx context.Context, storeID uuid.UUID) ([]domain.MenuCategory, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT id, store_id, name, COALESCE(name_en,''), sort, is_active FROM menu_categories WHERE store_id=$1 ORDER BY sort, name`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.MenuCategory{}
	for rows.Next() {
		var c domain.MenuCategory
		if err := rows.Scan(&c.ID, &c.StoreID, &c.Name, &c.NameEn, &c.Sort, &c.IsActive); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (FnbRepo) UpsertCategory(ctx context.Context, c *domain.MenuCategory) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	_, err := Q(ctx).Exec(ctx, `INSERT INTO menu_categories (id, store_id, name, name_en, sort, is_active) VALUES ($1,$2,$3,NULLIF($4,''),$5,$6)
		ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, name_en=EXCLUDED.name_en, sort=EXCLUDED.sort, is_active=EXCLUDED.is_active, updated_at=now()`,
		c.ID, c.StoreID, c.Name, c.NameEn, c.Sort, c.IsActive)
	return err
}

// MenuItems returns the items with their option groups and recipe attached.
func (r FnbRepo) MenuItems(ctx context.Context, storeID uuid.UUID, activeOnly bool) ([]domain.MenuItem, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT id, store_id, category_id, product_id, station_id, name, COALESCE(name_en,''), price::text, COALESCE(image_url,''), channels, sort, is_active
		FROM menu_items WHERE store_id=$1 AND ($2 = false OR is_active) ORDER BY sort, name`, storeID, activeOnly)
	if err != nil {
		return nil, err
	}
	out := []domain.MenuItem{}
	for rows.Next() {
		var m domain.MenuItem
		var price string
		if err := rows.Scan(&m.ID, &m.StoreID, &m.CategoryID, &m.ProductID, &m.StationID, &m.Name, &m.NameEn, &price, &m.ImageURL, &m.Channels, &m.Sort, &m.IsActive); err != nil {
			rows.Close()
			return nil, err
		}
		m.Price = dec(price)
		m.ModifierGroupIDs = []uuid.UUID{}
		out = append(out, m)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return out, nil
	}
	byID := map[uuid.UUID]int{}
	for i := range out {
		byID[out[i].ID] = i
	}
	// option groups per item
	g, err := Q(ctx).Query(ctx, `SELECT menu_item_id, group_id FROM menu_item_modifier_groups WHERE store_id=$1 ORDER BY sort`, storeID)
	if err != nil {
		return nil, err
	}
	for g.Next() {
		var item, group uuid.UUID
		if err := g.Scan(&item, &group); err != nil {
			g.Close()
			return nil, err
		}
		if i, ok := byID[item]; ok {
			out[i].ModifierGroupIDs = append(out[i].ModifierGroupIDs, group)
		}
	}
	g.Close()
	if err := g.Err(); err != nil {
		return nil, err
	}
	// recipes
	recipes, err := r.recipes(ctx, storeID)
	if err != nil {
		return nil, err
	}
	for i := range out {
		if rc, ok := recipes[out[i].ID]; ok {
			rcCopy := rc
			out[i].Recipe = &rcCopy
		}
	}
	return out, nil
}

func (r FnbRepo) recipes(ctx context.Context, storeID uuid.UUID) (map[uuid.UUID]domain.Recipe, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT id, store_id, menu_item_id, yield_qty::text, COALESCE(note,'') FROM recipes WHERE store_id=$1`, storeID)
	if err != nil {
		return nil, err
	}
	byItem := map[uuid.UUID]domain.Recipe{}
	byID := map[uuid.UUID]uuid.UUID{} // recipe id → menu item id
	for rows.Next() {
		var rc domain.Recipe
		var y string
		if err := rows.Scan(&rc.ID, &rc.StoreID, &rc.MenuItemID, &y, &rc.Note); err != nil {
			rows.Close()
			return nil, err
		}
		rc.YieldQty = dec(y)
		rc.Lines = []domain.RecipeLine{}
		byItem[rc.MenuItemID] = rc
		byID[rc.ID] = rc.MenuItemID
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	lines, err := r.recipeLines(ctx, storeID, "recipe_id IS NOT NULL")
	if err != nil {
		return nil, err
	}
	for _, l := range lines {
		if l.RecipeID == nil {
			continue
		}
		item, ok := byID[*l.RecipeID]
		if !ok {
			continue
		}
		rc := byItem[item]
		rc.Lines = append(rc.Lines, l)
		byItem[item] = rc
	}
	return byItem, nil
}

func (FnbRepo) recipeLines(ctx context.Context, storeID uuid.UUID, where string) ([]domain.RecipeLine, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT l.id, l.recipe_id, l.modifier_id, l.ingredient_product_id, p.name, l.qty::text, l.unit_id, COALESCE(u.name,''),
			l.factor_to_stock::text, l.waste_pct::text, l.mode, l.replaces_product_id, l.sort
		FROM recipe_lines l JOIN products p ON p.id = l.ingredient_product_id LEFT JOIN units u ON u.id = l.unit_id
		WHERE l.store_id=$1 AND `+where+` ORDER BY l.sort, l.id`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.RecipeLine{}
	for rows.Next() {
		var l domain.RecipeLine
		var qty, factor, waste string
		if err := rows.Scan(&l.ID, &l.RecipeID, &l.ModifierID, &l.IngredientProductID, &l.IngredientName, &qty, &l.UnitID, &l.UnitName, &factor, &waste, &l.Mode, &l.ReplacesProductID, &l.Sort); err != nil {
			return nil, err
		}
		l.Qty, l.FactorToStock, l.WastePct = dec(qty), dec(factor), dec(waste)
		out = append(out, l)
	}
	return out, rows.Err()
}

// ModifierGroups returns every group with its options and each option's ingredient lines.
func (r FnbRepo) ModifierGroups(ctx context.Context, storeID uuid.UUID) ([]domain.ModifierGroup, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT id, store_id, name, COALESCE(name_en,''), min_select, max_select, sort, is_active FROM modifier_groups WHERE store_id=$1 ORDER BY sort, name`, storeID)
	if err != nil {
		return nil, err
	}
	out := []domain.ModifierGroup{}
	idx := map[uuid.UUID]int{}
	for rows.Next() {
		var g domain.ModifierGroup
		if err := rows.Scan(&g.ID, &g.StoreID, &g.Name, &g.NameEn, &g.MinSelect, &g.MaxSelect, &g.Sort, &g.IsActive); err != nil {
			rows.Close()
			return nil, err
		}
		g.Modifiers = []domain.Modifier{}
		idx[g.ID] = len(out)
		out = append(out, g)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	m, err := Q(ctx).Query(ctx, `SELECT id, store_id, group_id, name, COALESCE(name_en,''), price_delta::text, is_default, sort, is_active FROM modifiers WHERE store_id=$1 ORDER BY sort, name`, storeID)
	if err != nil {
		return nil, err
	}
	modIdx := map[uuid.UUID][2]int{}
	for m.Next() {
		var mod domain.Modifier
		var delta string
		if err := m.Scan(&mod.ID, &mod.StoreID, &mod.GroupID, &mod.Name, &mod.NameEn, &delta, &mod.IsDefault, &mod.Sort, &mod.IsActive); err != nil {
			m.Close()
			return nil, err
		}
		mod.PriceDelta = dec(delta)
		mod.Lines = []domain.RecipeLine{}
		gi, ok := idx[mod.GroupID]
		if !ok {
			continue
		}
		modIdx[mod.ID] = [2]int{gi, len(out[gi].Modifiers)}
		out[gi].Modifiers = append(out[gi].Modifiers, mod)
	}
	m.Close()
	if err := m.Err(); err != nil {
		return nil, err
	}
	lines, err := r.recipeLines(ctx, storeID, "modifier_id IS NOT NULL")
	if err != nil {
		return nil, err
	}
	for _, l := range lines {
		if l.ModifierID == nil {
			continue
		}
		if at, ok := modIdx[*l.ModifierID]; ok {
			out[at[0]].Modifiers[at[1]].Lines = append(out[at[0]].Modifiers[at[1]].Lines, l)
		}
	}
	return out, nil
}

func (FnbRepo) UpsertMenuItem(ctx context.Context, m *domain.MenuItem) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	if m.Channels == nil {
		m.Channels = []string{"counter", "dine_in", "takeaway", "delivery", "self_order"}
	}
	_, err := Q(ctx).Exec(ctx, `INSERT INTO menu_items (id, store_id, category_id, product_id, station_id, name, name_en, price, image_url, channels, sort, is_active)
		VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,''),$8,NULLIF($9,''),$10,$11,$12)
		ON CONFLICT (id) DO UPDATE SET category_id=EXCLUDED.category_id, product_id=EXCLUDED.product_id, station_id=EXCLUDED.station_id, name=EXCLUDED.name,
			name_en=EXCLUDED.name_en, price=EXCLUDED.price, image_url=EXCLUDED.image_url, channels=EXCLUDED.channels, sort=EXCLUDED.sort, is_active=EXCLUDED.is_active, updated_at=now()`,
		m.ID, m.StoreID, m.CategoryID, m.ProductID, m.StationID, m.Name, m.NameEn, m.Price, m.ImageURL, m.Channels, m.Sort, m.IsActive)
	if err != nil {
		return err
	}
	if _, err := Q(ctx).Exec(ctx, `DELETE FROM menu_item_modifier_groups WHERE menu_item_id=$1`, m.ID); err != nil {
		return err
	}
	for i, g := range m.ModifierGroupIDs {
		if _, err := Q(ctx).Exec(ctx, `INSERT INTO menu_item_modifier_groups (store_id, menu_item_id, group_id, sort) VALUES ($1,$2,$3,$4)`, m.StoreID, m.ID, g, i); err != nil {
			return err
		}
	}
	return nil
}

// UpsertModifierGroup writes the group and replaces its options and their ingredient lines.
func (r FnbRepo) UpsertModifierGroup(ctx context.Context, g *domain.ModifierGroup) error {
	if g.ID == uuid.Nil {
		g.ID = uuid.New()
	}
	_, err := Q(ctx).Exec(ctx, `INSERT INTO modifier_groups (id, store_id, name, name_en, min_select, max_select, sort, is_active) VALUES ($1,$2,$3,NULLIF($4,''),$5,$6,$7,$8)
		ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, name_en=EXCLUDED.name_en, min_select=EXCLUDED.min_select, max_select=EXCLUDED.max_select, sort=EXCLUDED.sort, is_active=EXCLUDED.is_active, updated_at=now()`,
		g.ID, g.StoreID, g.Name, g.NameEn, g.MinSelect, g.MaxSelect, g.Sort, g.IsActive)
	if err != nil {
		return err
	}
	keep := make([]uuid.UUID, 0, len(g.Modifiers))
	for i := range g.Modifiers {
		m := &g.Modifiers[i]
		if m.ID == uuid.Nil {
			m.ID = uuid.New()
		}
		m.GroupID, m.StoreID = g.ID, g.StoreID
		keep = append(keep, m.ID)
		if _, err := Q(ctx).Exec(ctx, `INSERT INTO modifiers (id, store_id, group_id, name, name_en, price_delta, is_default, sort, is_active) VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8,$9)
			ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, name_en=EXCLUDED.name_en, price_delta=EXCLUDED.price_delta, is_default=EXCLUDED.is_default, sort=EXCLUDED.sort, is_active=EXCLUDED.is_active, updated_at=now()`,
			m.ID, m.StoreID, m.GroupID, m.Name, m.NameEn, m.PriceDelta, m.IsDefault, m.Sort, m.IsActive); err != nil {
			return err
		}
		if err := r.replaceLines(ctx, g.StoreID, "modifier_id", m.ID, m.Lines); err != nil {
			return err
		}
	}
	// options dropped from the group go away with their lines (order lines keep their own snapshot)
	if _, err := Q(ctx).Exec(ctx, `DELETE FROM modifiers WHERE group_id=$1 AND NOT (id = ANY($2))`, g.ID, keep); err != nil {
		return err
	}
	return nil
}

func (r FnbRepo) UpsertRecipe(ctx context.Context, rc *domain.Recipe) error {
	if rc.ID == uuid.Nil {
		rc.ID = uuid.New()
	}
	if err := Q(ctx).QueryRow(ctx, `INSERT INTO recipes (id, store_id, menu_item_id, yield_qty, note) VALUES ($1,$2,$3,$4,NULLIF($5,''))
		ON CONFLICT (menu_item_id) DO UPDATE SET yield_qty=EXCLUDED.yield_qty, note=EXCLUDED.note, updated_at=now() RETURNING id`,
		rc.ID, rc.StoreID, rc.MenuItemID, rc.YieldQty, rc.Note).Scan(&rc.ID); err != nil {
		return err
	}
	return r.replaceLines(ctx, rc.StoreID, "recipe_id", rc.ID, rc.Lines)
}

func (FnbRepo) replaceLines(ctx context.Context, storeID uuid.UUID, owner string, ownerID uuid.UUID, lines []domain.RecipeLine) error {
	if _, err := Q(ctx).Exec(ctx, `DELETE FROM recipe_lines WHERE `+owner+`=$1`, ownerID); err != nil {
		return err
	}
	for i := range lines {
		l := &lines[i]
		if l.ID == uuid.Nil {
			l.ID = uuid.New()
		}
		mode := l.Mode
		if mode == "" {
			mode = "add"
		}
		factor := l.FactorToStock
		if factor.IsZero() {
			factor = decimal.NewFromInt(1)
		}
		var recipeID, modifierID *uuid.UUID
		if owner == "recipe_id" {
			recipeID = &ownerID
		} else {
			modifierID = &ownerID
		}
		if _, err := Q(ctx).Exec(ctx, `INSERT INTO recipe_lines (id, store_id, recipe_id, modifier_id, ingredient_product_id, qty, unit_id, factor_to_stock, waste_pct, mode, replaces_product_id, sort)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
			l.ID, storeID, recipeID, modifierID, l.IngredientProductID, l.Qty, l.UnitID, factor, l.WastePct, mode, l.ReplacesProductID, i); err != nil {
			return err
		}
	}
	return nil
}

// IngredientCosts is the average cost of each product, for pricing a recipe deduction.
func (FnbRepo) IngredientCosts(ctx context.Context, storeID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]decimal.Decimal, error) {
	out := map[uuid.UUID]decimal.Decimal{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := Q(ctx).Query(ctx, `SELECT id, cost_avg::text FROM products WHERE store_id=$1 AND id = ANY($2)`, storeID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var c string
		if err := rows.Scan(&id, &c); err != nil {
			return nil, err
		}
		out[id] = dec(c)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Table tokens
// ---------------------------------------------------------------------------

// TableTokenRow is one table's two addresses: Token is what customers scan and changes every
// time the table is closed; KioskToken is the fixed tablet's and never changes.
type TableTokenRow struct {
	StoreID    uuid.UUID
	TableCode  string
	Token      string
	KioskToken string
	IsActive   bool
}

// EnsureTableToken returns the table's tokens, making them if it has none; rotate replaces the
// customer code and leaves the kiosk one alone, so the tablet on the table stays put.
func (FnbRepo) EnsureTableToken(ctx context.Context, storeID uuid.UUID, tableCode string, rotate bool) (*TableTokenRow, error) {
	r := TableTokenRow{StoreID: storeID}
	q := `INSERT INTO table_tokens (store_id, table_code, token, kiosk_token) VALUES ($1,$2,$3,$4)
		ON CONFLICT (store_id, table_code) DO UPDATE SET table_code=EXCLUDED.table_code
		RETURNING table_code, token, kiosk_token, is_active`
	if rotate {
		q = `INSERT INTO table_tokens (store_id, table_code, token, kiosk_token) VALUES ($1,$2,$3,$4)
		ON CONFLICT (store_id, table_code) DO UPDATE SET token=EXCLUDED.token, is_active=true, created_at=now()
		RETURNING table_code, token, kiosk_token, is_active`
	}
	err := Q(ctx).QueryRow(ctx, q, storeID, tableCode, newToken(), "k"+newToken()).Scan(&r.TableCode, &r.Token, &r.KioskToken, &r.IsActive)
	return &r, err
}

func (FnbRepo) TableTokens(ctx context.Context, storeID uuid.UUID) ([]TableTokenRow, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT table_code, token, kiosk_token, is_active FROM table_tokens WHERE store_id=$1 ORDER BY length(table_code), table_code`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TableTokenRow{}
	for rows.Next() {
		r := TableTokenRow{StoreID: storeID}
		if err := rows.Scan(&r.TableCode, &r.Token, &r.KioskToken, &r.IsActive); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// TableByToken resolves a public token, the customer's or the kiosk's; kiosk says which one it
// was. Must run with RLS bypassed: nobody is signed in yet.
func (FnbRepo) TableByToken(ctx context.Context, token string) (row *TableTokenRow, kiosk bool, err error) {
	var r TableTokenRow
	err = Q(ctx).QueryRow(ctx, `SELECT store_id, table_code, token, kiosk_token, is_active, kiosk_token=$1
		FROM table_tokens WHERE (token=$1 OR kiosk_token=$1) AND is_active`, token).Scan(&r.StoreID, &r.TableCode, &r.Token, &r.KioskToken, &r.IsActive, &kiosk)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, domain.ErrNotFound
	}
	return &r, kiosk, err
}

// newToken is 20 random bytes, URL-safe: long enough that a QR cannot be guessed, short enough
// to scan on a phone at arm's length.
func newToken() string {
	b := make([]byte, 20)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

// NextOrderNo counts up per store per local day, starting at 1 each morning.
func (FnbRepo) NextOrderNo(ctx context.Context, storeID uuid.UUID, at time.Time) (int, error) {
	day := at.In(bangkok).Format("2006-01-02")
	var n int
	err := Q(ctx).QueryRow(ctx, `SELECT COALESCE(max(order_no),0)+1 FROM orders WHERE store_id=$1 AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = $2::date`, storeID, day).Scan(&n)
	return n, err
}

func (FnbRepo) InsertOrder(ctx context.Context, o *domain.Order) error {
	return Q(ctx).QueryRow(ctx, `INSERT INTO orders (store_id, order_no, channel, table_code, guests, status, service_charge, note, created_by)
		VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,0),$6,$7,NULLIF($8,''),$9) RETURNING id, created_at`,
		o.StoreID, o.OrderNo, string(o.Channel), o.TableCode, o.Guests, string(o.Status), o.ServiceCharge, o.Note, o.CreatedBy).Scan(&o.ID, &o.CreatedAt)
}

func (FnbRepo) InsertOrderItem(ctx context.Context, it *domain.OrderItem) error {
	if err := Q(ctx).QueryRow(ctx, `INSERT INTO order_items (store_id, order_id, menu_item_id, station_id, name, qty, unit_price, cost, seat, course, note, status, deducted, sort)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULLIF($9,0),$10,NULLIF($11,''),$12,$13,$14) RETURNING id, sent_at`,
		it.StoreID, it.OrderID, it.MenuItemID, it.StationID, it.Name, it.Qty, it.UnitPrice, it.Cost, it.Seat, it.Course, it.Note, string(it.Status), it.Deducted, it.Sort).Scan(&it.ID, &it.SentAt); err != nil {
		return err
	}
	for i := range it.Modifiers {
		m := &it.Modifiers[i]
		m.OrderItemID = it.ID
		if err := Q(ctx).QueryRow(ctx, `INSERT INTO order_item_modifiers (store_id, order_item_id, modifier_id, name, price_delta) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
			it.StoreID, it.ID, m.ModifierID, m.Name, m.PriceDelta).Scan(&m.ID); err != nil {
			return err
		}
	}
	return nil
}

func (FnbRepo) InsertEvent(ctx context.Context, storeID, orderID uuid.UUID, itemID *uuid.UUID, kind string, detail any, by *uuid.UUID) error {
	_, err := Q(ctx).Exec(ctx, `INSERT INTO order_events (store_id, order_id, item_id, kind, detail, by_user) VALUES ($1,$2,$3,$4,$5,$6)`, storeID, orderID, itemID, kind, detail, by)
	return err
}

func (FnbRepo) SetItemDeducted(ctx context.Context, itemID uuid.UUID, cost decimal.Decimal) error {
	_, err := Q(ctx).Exec(ctx, `UPDATE order_items SET deducted=true, cost=$2 WHERE id=$1`, itemID, cost)
	return err
}

// SetItemStatus moves a line and stamps the time the kitchen finished or the waiter served it.
func (FnbRepo) SetItemStatus(ctx context.Context, storeID, itemID uuid.UUID, status domain.ItemStatus) error {
	tag, err := Q(ctx).Exec(ctx, `UPDATE order_items SET status=$3,
			ready_at = CASE WHEN $3 = 'ready' THEN now() ELSE ready_at END,
			served_at = CASE WHEN $3 = 'served' THEN now() ELSE served_at END
		WHERE store_id=$1 AND id=$2`, storeID, itemID, string(status))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrOrderNotFound
	}
	return nil
}

func (FnbRepo) SetOrderStatus(ctx context.Context, storeID, id uuid.UUID, status domain.OrderStatus) error {
	tag, err := Q(ctx).Exec(ctx, `UPDATE orders SET status=$3, closed_at = CASE WHEN $3 IN ('closed','void') THEN now() ELSE closed_at END WHERE store_id=$1 AND id=$2`, storeID, id, string(status))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrOrderNotFound
	}
	return nil
}

const orderCols = `o.id, o.store_id, o.order_no, o.channel, COALESCE(o.table_code,''), COALESCE(o.guests,0), o.status, o.sale_id, o.service_charge::text, COALESCE(o.note,''), o.created_by, o.created_at, o.closed_at`

func scanOrder(row pgx.Row) (*domain.Order, error) {
	var o domain.Order
	var channel, status, sc string
	if err := row.Scan(&o.ID, &o.StoreID, &o.OrderNo, &channel, &o.TableCode, &o.Guests, &status, &o.SaleID, &sc, &o.Note, &o.CreatedBy, &o.CreatedAt, &o.ClosedAt); err != nil {
		return nil, err
	}
	o.Channel, o.Status, o.ServiceCharge = domain.OrderChannel(channel), domain.OrderStatus(status), dec(sc)
	o.Items = []domain.OrderItem{}
	return &o, nil
}

func (r FnbRepo) GetOrder(ctx context.Context, storeID, id uuid.UUID) (*domain.Order, error) {
	o, err := scanOrder(Q(ctx).QueryRow(ctx, `SELECT `+orderCols+` FROM orders o WHERE o.store_id=$1 AND o.id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrOrderNotFound
	}
	if err != nil {
		return nil, err
	}
	items, err := r.itemsFor(ctx, storeID, []uuid.UUID{id})
	if err != nil {
		return nil, err
	}
	o.Items = items[id]
	if o.Items == nil {
		o.Items = []domain.OrderItem{}
	}
	return o, nil
}

// ListOrdersForTable is the table's live orders: open or paid, not yet closed.
func (r FnbRepo) ListOrdersForTable(ctx context.Context, storeID uuid.UUID, tableCode string) ([]domain.Order, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT `+orderCols+` FROM orders o WHERE o.store_id=$1 AND o.table_code=$2 AND o.status IN ('open','paid') ORDER BY o.created_at`, storeID, tableCode)
	if err != nil {
		return nil, err
	}
	out := []domain.Order{}
	ids := []uuid.UUID{}
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, *o)
		ids = append(ids, o.ID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	items, err := r.itemsFor(ctx, storeID, ids)
	if err != nil {
		return nil, err
	}
	for i := range out {
		if its, ok := items[out[i].ID]; ok {
			out[i].Items = its
		}
	}
	return out, nil
}

// ListOrders returns orders newest-last, with their lines. openOnly leaves out closed and void ones.
func (r FnbRepo) ListOrders(ctx context.Context, storeID uuid.UUID, openOnly bool, since time.Time, limit int) ([]domain.Order, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT `+orderCols+` FROM orders o WHERE o.store_id=$1 AND o.created_at >= $2 AND ($3 = false OR o.status IN ('open','paid'))
		ORDER BY o.created_at LIMIT $4`, storeID, since, openOnly, limit)
	if err != nil {
		return nil, err
	}
	out := []domain.Order{}
	ids := []uuid.UUID{}
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, *o)
		ids = append(ids, o.ID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	items, err := r.itemsFor(ctx, storeID, ids)
	if err != nil {
		return nil, err
	}
	for i := range out {
		if its, ok := items[out[i].ID]; ok {
			out[i].Items = its
		}
	}
	return out, nil
}

func (FnbRepo) itemsFor(ctx context.Context, storeID uuid.UUID, orderIDs []uuid.UUID) (map[uuid.UUID][]domain.OrderItem, error) {
	out := map[uuid.UUID][]domain.OrderItem{}
	if len(orderIDs) == 0 {
		return out, nil
	}
	rows, err := Q(ctx).Query(ctx, `SELECT id, store_id, order_id, menu_item_id, station_id, name, qty::text, unit_price::text, cost::text, COALESCE(seat,0), course, COALESCE(note,''), status, deducted, sort, sent_at, ready_at, served_at
		FROM order_items WHERE store_id=$1 AND order_id = ANY($2) ORDER BY order_id, sort, sent_at`, storeID, orderIDs)
	if err != nil {
		return nil, err
	}
	itemIdx := map[uuid.UUID][2]int{}
	for rows.Next() {
		var it domain.OrderItem
		var qty, price, cost, status string
		if err := rows.Scan(&it.ID, &it.StoreID, &it.OrderID, &it.MenuItemID, &it.StationID, &it.Name, &qty, &price, &cost, &it.Seat, &it.Course, &it.Note, &status, &it.Deducted, &it.Sort, &it.SentAt, &it.ReadyAt, &it.ServedAt); err != nil {
			rows.Close()
			return nil, err
		}
		it.Qty, it.UnitPrice, it.Cost, it.Status = dec(qty), dec(price), dec(cost), domain.ItemStatus(status)
		it.Modifiers = []domain.OrderItemModifier{}
		itemIdx[it.ID] = [2]int{0, len(out[it.OrderID])}
		out[it.OrderID] = append(out[it.OrderID], it)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	m, err := Q(ctx).Query(ctx, `SELECT m.id, m.order_item_id, m.modifier_id, m.name, m.price_delta::text, i.order_id
		FROM order_item_modifiers m JOIN order_items i ON i.id = m.order_item_id WHERE m.store_id=$1 AND i.order_id = ANY($2) ORDER BY m.id`, storeID, orderIDs)
	if err != nil {
		return nil, err
	}
	defer m.Close()
	for m.Next() {
		var mod domain.OrderItemModifier
		var delta string
		var orderID uuid.UUID
		if err := m.Scan(&mod.ID, &mod.OrderItemID, &mod.ModifierID, &mod.Name, &delta, &orderID); err != nil {
			return nil, err
		}
		mod.PriceDelta = dec(delta)
		its := out[orderID]
		for i := range its {
			if its[i].ID == mod.OrderItemID {
				its[i].Modifiers = append(its[i].Modifiers, mod)
				break
			}
		}
	}
	return out, m.Err()
}
