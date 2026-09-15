package fnbuc

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

// StockLedger is the one stock write this module makes: a recipe's ingredients off the shelf.
type StockLedger interface {
	Apply(ctx context.Context, storeID, productID uuid.UUID, moveType string, qtyDelta decimal.Decimal, unitCost *decimal.Decimal, refType string, refID *uuid.UUID, note string, by *uuid.UUID) (decimal.Decimal, error)
}

type Service struct {
	db     *postgres.DB
	stock  StockLedger
	repo   postgres.FnbRepo
	stores postgres.StoreRepo
	hub    *hub
}

func New(db *postgres.DB, stock StockLedger) *Service {
	return &Service{db: db, stock: stock, hub: newHub()}
}

type Actor struct {
	UserID uuid.UUID
	Name   string
}

func (a Actor) idPtr() *uuid.UUID {
	if a.UserID == uuid.Nil {
		return nil
	}
	id := a.UserID
	return &id
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

// MenuView is everything the till needs to take an order, in one round trip.
type MenuView struct {
	Stations       []domain.KitchenStation `json:"stations"`
	Categories     []domain.MenuCategory   `json:"categories"`
	Items          []domain.MenuItem       `json:"items"`
	ModifierGroups []domain.ModifierGroup  `json:"modifier_groups"`
	// ตั้งค่า fnb.deduct_on, so the screen can say when stock moves.
	DeductOn string `json:"deduct_on"`
}

func (s *Service) Menu(ctx context.Context, storeID uuid.UUID, activeOnly bool) (*MenuView, error) {
	var out MenuView
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		if out.Stations, err = s.repo.Stations(ctx, storeID); err != nil {
			return err
		}
		if out.Categories, err = s.repo.Categories(ctx, storeID); err != nil {
			return err
		}
		if out.Items, err = s.repo.MenuItems(ctx, storeID, activeOnly); err != nil {
			return err
		}
		if out.ModifierGroups, err = s.repo.ModifierGroups(ctx, storeID); err != nil {
			return err
		}
		settings, _ := s.stores.GetSettings(ctx, storeID)
		out.DeductOn = deductOn(settings)
		return nil
	})
	return &out, err
}

func deductOn(settings domain.StoreSettings) string {
	if v, ok := settings["fnb"].(map[string]any); ok {
		if d, ok := v["deduct_on"].(string); ok && (d == domain.DeductOnSend || d == domain.DeductOnReady || d == domain.DeductOnPay) {
			return d
		}
	}
	return domain.DeductOnSend
}

func (s *Service) SaveStation(ctx context.Context, storeID uuid.UUID, st domain.KitchenStation) (*domain.KitchenStation, error) {
	st.StoreID = storeID
	if strings.TrimSpace(st.Name) == "" {
		return nil, domain.ErrValidation.With("field", "name")
	}
	if st.Output != domain.StationKDS && st.Output != domain.StationPrinter && st.Output != domain.StationBoth {
		st.Output = domain.StationKDS
	}
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error { return s.repo.UpsertStation(ctx, &st) })
	return &st, err
}

func (s *Service) SaveCategory(ctx context.Context, storeID uuid.UUID, c domain.MenuCategory) (*domain.MenuCategory, error) {
	c.StoreID = storeID
	if strings.TrimSpace(c.Name) == "" {
		return nil, domain.ErrValidation.With("field", "name")
	}
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error { return s.repo.UpsertCategory(ctx, &c) })
	return &c, err
}

func (s *Service) SaveMenuItem(ctx context.Context, storeID uuid.UUID, m domain.MenuItem) (*domain.MenuItem, error) {
	m.StoreID = storeID
	if strings.TrimSpace(m.Name) == "" {
		return nil, domain.ErrValidation.With("field", "name")
	}
	if m.Price.IsNegative() {
		return nil, domain.ErrValidation.With("field", "price")
	}
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		if err := s.repo.UpsertMenuItem(ctx, &m); err != nil {
			return err
		}
		if m.Recipe != nil {
			m.Recipe.StoreID, m.Recipe.MenuItemID = storeID, m.ID
			if !m.Recipe.YieldQty.IsPositive() {
				m.Recipe.YieldQty = decimal.NewFromInt(1)
			}
			return s.repo.UpsertRecipe(ctx, m.Recipe)
		}
		return nil
	})
	return &m, err
}

func (s *Service) SaveModifierGroup(ctx context.Context, storeID uuid.UUID, g domain.ModifierGroup) (*domain.ModifierGroup, error) {
	g.StoreID = storeID
	if strings.TrimSpace(g.Name) == "" {
		return nil, domain.ErrValidation.With("field", "name")
	}
	if g.MaxSelect < 1 {
		g.MaxSelect = 1
	}
	if g.MinSelect < 0 || g.MinSelect > g.MaxSelect {
		return nil, domain.ErrValidation.With("field", "min_select")
	}
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error { return s.repo.UpsertModifierGroup(ctx, &g) })
	return &g, err
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

type LineInput struct {
	MenuItemID  uuid.UUID       `json:"menu_item_id"`
	Qty         decimal.Decimal `json:"qty"`
	ModifierIDs []uuid.UUID     `json:"modifier_ids"`
	Seat        int             `json:"seat,omitempty"`
	Course      int             `json:"course,omitempty"`
	Note        string          `json:"note,omitempty"`
}

type CreateOrderInput struct {
	Channel   domain.OrderChannel `json:"channel"`
	TableCode string              `json:"table_code,omitempty"`
	Guests    int                 `json:"guests,omitempty"`
	Note      string              `json:"note,omitempty"`
	Lines     []LineInput         `json:"lines"`
}

// menuIndex is the menu the way CreateOrder needs it: by id.
type menuIndex struct {
	items     map[uuid.UUID]domain.MenuItem
	groups    map[uuid.UUID]domain.ModifierGroup
	modifiers map[uuid.UUID]domain.Modifier
}

func (s *Service) index(ctx context.Context, storeID uuid.UUID) (*menuIndex, error) {
	items, err := s.repo.MenuItems(ctx, storeID, true)
	if err != nil {
		return nil, err
	}
	groups, err := s.repo.ModifierGroups(ctx, storeID)
	if err != nil {
		return nil, err
	}
	ix := &menuIndex{items: map[uuid.UUID]domain.MenuItem{}, groups: map[uuid.UUID]domain.ModifierGroup{}, modifiers: map[uuid.UUID]domain.Modifier{}}
	for _, it := range items {
		ix.items[it.ID] = it
	}
	for _, g := range groups {
		ix.groups[g.ID] = g
		for _, m := range g.Modifiers {
			ix.modifiers[m.ID] = m
		}
	}
	return ix, nil
}

// checkModifiers makes sure every chosen option belongs to one of the item's groups and that each
// group's min/max is respected. Returns the options in the order chosen.
func (ix *menuIndex) checkModifiers(item domain.MenuItem, ids []uuid.UUID) ([]domain.Modifier, error) {
	allowed := map[uuid.UUID]bool{}
	for _, g := range item.ModifierGroupIDs {
		allowed[g] = true
	}
	count := map[uuid.UUID]int{}
	out := make([]domain.Modifier, 0, len(ids))
	for _, id := range ids {
		m, ok := ix.modifiers[id]
		if !ok || !m.IsActive || !allowed[m.GroupID] {
			return nil, domain.ErrModifierInvalid
		}
		count[m.GroupID]++
		out = append(out, m)
	}
	for _, gid := range item.ModifierGroupIDs {
		g, ok := ix.groups[gid]
		if !ok || !g.IsActive {
			continue
		}
		if n := count[gid]; n < g.MinSelect || n > g.MaxSelect {
			return nil, domain.ErrModifierInvalid.With("group", g.Name)
		}
	}
	return out, nil
}

// CreateOrder takes an order and, when the shop deducts on send, takes every dish's ingredients
// off stock right away — the shop's rule is "stock moves when the dish is made".
func (s *Service) CreateOrder(ctx context.Context, storeID uuid.UUID, actor Actor, in CreateOrderInput) (*domain.Order, error) {
	if !in.Channel.Valid() {
		return nil, domain.ErrValidation.With("field", "channel")
	}
	if len(in.Lines) == 0 {
		return nil, domain.ErrOrderEmpty
	}
	var out *domain.Order
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		ix, err := s.index(ctx, storeID)
		if err != nil {
			return err
		}
		settings, _ := s.stores.GetSettings(ctx, storeID)
		when := deductOn(settings)
		now := time.Now()
		no, err := s.repo.NextOrderNo(ctx, storeID, now)
		if err != nil {
			return err
		}
		order := &domain.Order{StoreID: storeID, OrderNo: no, Channel: in.Channel, TableCode: strings.TrimSpace(in.TableCode), Guests: in.Guests, Status: domain.OrderOpen, Note: strings.TrimSpace(in.Note), CreatedBy: actor.idPtr()}
		if err := s.repo.InsertOrder(ctx, order); err != nil {
			return err
		}
		for i, l := range in.Lines {
			item, ok := ix.items[l.MenuItemID]
			if !ok {
				return domain.ErrMenuItemNotFound
			}
			if !l.Qty.IsPositive() {
				return domain.ErrValidation.With("field", "lines.qty")
			}
			mods, err := ix.checkModifiers(item, l.ModifierIDs)
			if err != nil {
				return err
			}
			course := l.Course
			if course < 1 {
				course = 1
			}
			it := &domain.OrderItem{StoreID: storeID, OrderID: order.ID, MenuItemID: ptr(item.ID), StationID: item.StationID, Name: item.Name, Qty: l.Qty, UnitPrice: item.Price, Seat: l.Seat, Course: course, Note: strings.TrimSpace(l.Note), Status: domain.ItemSent, Sort: i}
			for _, m := range mods {
				mid := m.ID
				it.Modifiers = append(it.Modifiers, domain.OrderItemModifier{ModifierID: &mid, Name: m.Name, PriceDelta: m.PriceDelta})
			}
			if err := s.repo.InsertOrderItem(ctx, it); err != nil {
				return err
			}
			if when == domain.DeductOnSend {
				if err := s.deduct(ctx, storeID, actor, it, item, mods); err != nil {
					return err
				}
			}
			order.Items = append(order.Items, *it)
		}
		if err := s.repo.InsertEvent(ctx, storeID, order.ID, nil, "created", map[string]any{"lines": len(in.Lines), "channel": in.Channel}, actor.idPtr()); err != nil {
			return err
		}
		out, err = s.repo.GetOrder(ctx, storeID, order.ID)
		return err
	})
	if err == nil {
		s.hub.Publish(storeID, Event{Kind: "created", Order: out})
	}
	return out, err
}

// deduct takes one line's ingredients off stock and prices the line at average cost.
// A menu item with no recipe but a product behind it (a bottled drink) is the product itself.
func (s *Service) deduct(ctx context.Context, storeID uuid.UUID, actor Actor, it *domain.OrderItem, item domain.MenuItem, mods []domain.Modifier) error {
	var deds []Deduction
	switch {
	case item.Recipe != nil && len(item.Recipe.Lines) > 0:
		modLines := make([][]RecipeLine, 0, len(mods))
		for _, m := range mods {
			modLines = append(modLines, toLines(m.Lines))
		}
		var err error
		deds, err = Explode(it.Qty, Recipe{YieldQty: item.Recipe.YieldQty, Lines: toLines(item.Recipe.Lines)}, modLines)
		if err != nil {
			return err
		}
	case item.ProductID != nil:
		deds = []Deduction{{ProductID: *item.ProductID, Qty: it.Qty}}
	default:
		return nil // a dish with nothing behind it (a service, a surcharge) moves no stock
	}
	if len(deds) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, 0, len(deds))
	for _, d := range deds {
		ids = append(ids, d.ProductID)
	}
	costs, err := s.repo.IngredientCosts(ctx, storeID, ids)
	if err != nil {
		return err
	}
	note := "order #" + itoa(it.Sort+1) + " " + it.Name
	for _, d := range deds {
		c := costs[d.ProductID]
		if _, err := s.stock.Apply(ctx, storeID, d.ProductID, domain.MoveRecipe, d.Qty.Neg(), &c, domain.RefOrderItem, ptr(it.ID), note, actor.idPtr()); err != nil {
			return err
		}
	}
	cost := Cost(deds, costs)
	it.Cost, it.Deducted = cost, true
	return s.repo.SetItemDeducted(ctx, it.ID, cost)
}

func toLines(in []domain.RecipeLine) []RecipeLine {
	out := make([]RecipeLine, 0, len(in))
	for _, l := range in {
		mode := LineAdd
		if l.Mode == string(LineReplace) {
			mode = LineReplace
		}
		out = append(out, RecipeLine{IngredientID: l.IngredientProductID, Qty: l.Qty, FactorToStock: l.FactorToStock, WastePct: l.WastePct, Mode: mode, ReplacesID: l.ReplacesProductID})
	}
	return out
}

func ptr(id uuid.UUID) *uuid.UUID { return &id }

func itoa(n int) string { return decimal.NewFromInt(int64(n)).String() }

// SetItemStatus moves a line along sent → preparing → ready → served, or voids it.
//
// When the shop deducts on ready, the ingredients come off as the kitchen finishes the dish. A
// void after the deduction asks `made`: true writes the food off as waste, false puts the
// ingredients back.
func (s *Service) SetItemStatus(ctx context.Context, storeID uuid.UUID, actor Actor, orderID, itemID uuid.UUID, status domain.ItemStatus, made bool) (*domain.Order, error) {
	if !status.Valid() {
		return nil, domain.ErrValidation.With("field", "status")
	}
	var out *domain.Order
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		order, err := s.repo.GetOrder(ctx, storeID, orderID)
		if err != nil {
			return err
		}
		if order.Status == domain.OrderClosed || order.Status == domain.OrderVoid {
			return domain.ErrOrderClosed
		}
		var cur *domain.OrderItem
		for i := range order.Items {
			if order.Items[i].ID == itemID {
				cur = &order.Items[i]
			}
		}
		if cur == nil {
			return domain.ErrOrderNotFound
		}
		if cur.Status == domain.ItemVoid {
			return domain.ErrOrderClosed
		}
		settings, _ := s.stores.GetSettings(ctx, storeID)
		when := deductOn(settings)
		if err := s.repo.SetItemStatus(ctx, storeID, itemID, status); err != nil {
			return err
		}
		switch {
		case status == domain.ItemReady && when == domain.DeductOnReady && !cur.Deducted:
			ix, err := s.index(ctx, storeID)
			if err != nil {
				return err
			}
			if cur.MenuItemID != nil {
				if item, ok := ix.items[*cur.MenuItemID]; ok {
					mods := make([]domain.Modifier, 0, len(cur.Modifiers))
					for _, m := range cur.Modifiers {
						if m.ModifierID != nil {
							if md, ok := ix.modifiers[*m.ModifierID]; ok {
								mods = append(mods, md)
							}
						}
					}
					if err := s.deduct(ctx, storeID, actor, cur, item, mods); err != nil {
						return err
					}
				}
			}
		case status == domain.ItemVoid && cur.Deducted:
			// give the ingredients back, or write them off, by reversing the movements this line made
			if err := s.reverse(ctx, storeID, actor, cur, made); err != nil {
				return err
			}
		}
		if err := s.repo.InsertEvent(ctx, storeID, orderID, &itemID, "status:"+string(status), map[string]any{"made": made}, actor.idPtr()); err != nil {
			return err
		}
		out, err = s.repo.GetOrder(ctx, storeID, orderID)
		return err
	})
	if err == nil {
		s.hub.Publish(storeID, Event{Kind: "updated", Order: out})
	}
	return out, err
}

// reverse undoes a line's recipe movements. made=true keeps stock down and records the food as
// waste instead, so the ingredient report still shows where the milk went.
func (s *Service) reverse(ctx context.Context, storeID uuid.UUID, actor Actor, it *domain.OrderItem, made bool) error {
	rows, err := postgres.Q(ctx).Query(ctx, `SELECT product_id, qty_delta::text, unit_cost::text FROM stock_movements WHERE store_id=$1 AND ref_type=$2 AND ref_id=$3 AND move_type=$4`,
		storeID, domain.RefOrderItem, it.ID, domain.MoveRecipe)
	if err != nil {
		return err
	}
	type mv struct {
		pid  uuid.UUID
		qty  decimal.Decimal
		cost *decimal.Decimal
	}
	var moves []mv
	for rows.Next() {
		var pid uuid.UUID
		var q string
		var c *string
		if err := rows.Scan(&pid, &q, &c); err != nil {
			rows.Close()
			return err
		}
		m := mv{pid: pid, qty: decimal.RequireFromString(q)}
		if c != nil {
			d := decimal.RequireFromString(*c)
			m.cost = &d
		}
		moves = append(moves, m)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, m := range moves {
		if made {
			// stock already went; record that it became waste, as a zero-quantity marker with the
			// quantity in the note so the waste report can sum it without touching the balance
			if _, err := s.stock.Apply(ctx, storeID, m.pid, domain.MoveWaste, decimal.Zero, m.cost, domain.RefOrderItem, ptr(it.ID), "void after made: "+m.qty.Neg().String(), actor.idPtr()); err != nil {
				return err
			}
			continue
		}
		if _, err := s.stock.Apply(ctx, storeID, m.pid, domain.MoveRecipe, m.qty.Neg(), m.cost, domain.RefOrderItem, ptr(it.ID), "void, returned", actor.idPtr()); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) Get(ctx context.Context, storeID, id uuid.UUID) (*domain.Order, error) {
	var out *domain.Order
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.repo.GetOrder(ctx, storeID, id)
		return err
	})
	return out, err
}

// List returns today's orders (or every open one) with their lines, oldest first — the kitchen's view.
func (s *Service) List(ctx context.Context, storeID uuid.UUID, openOnly bool, since time.Time, limit int) ([]domain.Order, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	var out []domain.Order
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.repo.ListOrders(ctx, storeID, openOnly, since, limit)
		return err
	})
	return out, err
}

// SetStatus pays, closes or voids an order. Paying is recorded here; the bill itself is cut by
// the sales module against the order (sales.order_id) in the next step of the plan.
func (s *Service) SetStatus(ctx context.Context, storeID uuid.UUID, actor Actor, id uuid.UUID, status domain.OrderStatus) (*domain.Order, error) {
	switch status {
	case domain.OrderPaid, domain.OrderClosed, domain.OrderVoid, domain.OrderOpen:
	default:
		return nil, domain.ErrValidation.With("field", "status")
	}
	var out *domain.Order
	var rotated *TableToken
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		cur, err := s.repo.GetOrder(ctx, storeID, id)
		if err != nil {
			return err
		}
		if cur.Status == domain.OrderClosed || cur.Status == domain.OrderVoid {
			return domain.ErrOrderClosed
		}
		if err := s.repo.SetOrderStatus(ctx, storeID, id, status); err != nil {
			return err
		}
		if err := s.repo.InsertEvent(ctx, storeID, id, nil, "order:"+string(status), nil, actor.idPtr()); err != nil {
			return err
		}
		if out, err = s.repo.GetOrder(ctx, storeID, id); err != nil {
			return err
		}
		// the last bill on a table closing ends the customers' session: the code on their phones
		// stops working, and the tablet on the table shows the next party a fresh one
		if (status == domain.OrderClosed || status == domain.OrderVoid) && out.TableCode != "" {
			live, err := s.repo.ListOrdersForTable(ctx, storeID, out.TableCode)
			if err != nil {
				return err
			}
			if len(live) == 0 {
				r, err := s.repo.EnsureTableToken(ctx, storeID, out.TableCode, true)
				if err != nil {
					return err
				}
				rotated = tokenOf(r)
			}
		}
		return nil
	})
	if err == nil {
		s.hub.Publish(storeID, Event{Kind: "updated", Order: out})
		if rotated != nil {
			s.hub.Publish(storeID, Event{Kind: "table", Table: rotated})
		}
	}
	return out, err
}

// ---------------------------------------------------------------------------
// Tables: the QR a customer scans, and the tablet that lives on the table
// ---------------------------------------------------------------------------

// TableToken is one table's public handles. The QR customers scan carries /t/<token>, and that
// code is replaced every time the table is closed; the tablet fixed to the table opens
// /t/<kiosk_token>, which never changes — it is told the new customer code over its stream.
type TableToken struct {
	TableCode  string `json:"table_code"`
	Token      string `json:"token"`
	KioskToken string `json:"kiosk_token,omitempty"`
	IsActive   bool   `json:"is_active"`
}

func tokenOf(r *postgres.TableTokenRow) *TableToken {
	return &TableToken{TableCode: r.TableCode, Token: r.Token, KioskToken: r.KioskToken, IsActive: r.IsActive}
}

// TableTokens lists every table's token, making one for any table code asked for that has none.
func (s *Service) TableTokens(ctx context.Context, storeID uuid.UUID, ensure []string) ([]TableToken, error) {
	var out []TableToken
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		for _, code := range ensure {
			if _, err := s.repo.EnsureTableToken(ctx, storeID, strings.TrimSpace(code), false); err != nil {
				return err
			}
		}
		rows, err := s.repo.TableTokens(ctx, storeID)
		if err != nil {
			return err
		}
		for i := range rows {
			out = append(out, *tokenOf(&rows[i]))
		}
		return nil
	})
	if out == nil {
		out = []TableToken{}
	}
	return out, err
}

// RotateTableToken replaces a table's customer code by hand (it also happens by itself when the
// table is closed): whoever kept the old one can no longer order, and the tablet on the table
// hears the new one at once.
func (s *Service) RotateTableToken(ctx context.Context, storeID uuid.UUID, tableCode string) (*TableToken, error) {
	tableCode = strings.TrimSpace(tableCode)
	if tableCode == "" {
		return nil, domain.ErrValidation.With("field", "table_code")
	}
	var out *TableToken
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		r, err := s.repo.EnsureTableToken(ctx, storeID, tableCode, true)
		if err != nil {
			return err
		}
		out = tokenOf(r)
		return nil
	})
	if err == nil {
		s.hub.Publish(storeID, Event{Kind: "table", Table: out})
	}
	return out, err
}

// TableView is what the customer's phone sees after scanning: the shop, the table, the menu the
// shop lets customers order from themselves, and what this table has already ordered.
type TableView struct {
	StoreID   uuid.UUID      `json:"store_id"`
	StoreName string         `json:"store_name"`
	TableCode string         `json:"table_code"`
	Menu      *MenuView      `json:"menu"`
	Orders    []domain.Order `json:"orders"`
	// Kiosk is true when the tablet's own address opened the page; GuestToken is then the
	// current customer code for it to show as a QR. A customer's phone never sees it.
	Kiosk      bool   `json:"kiosk"`
	GuestToken string `json:"guest_token,omitempty"`
}

// resolveToken finds the store and table behind a public token, and whether it was the kiosk's.
// Bypasses RLS for the lookup only; everything after runs scoped to that store like any other
// request.
func (s *Service) resolveToken(ctx context.Context, token string) (uuid.UUID, string, bool, error) {
	var row *postgres.TableTokenRow
	var kiosk bool
	err := s.db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		row, kiosk, err = s.repo.TableByToken(ctx, token)
		return err
	})
	if err != nil {
		return uuid.Nil, "", false, err
	}
	return row.StoreID, row.TableCode, kiosk, nil
}

func (s *Service) TableByToken(ctx context.Context, token string) (*TableView, error) {
	storeID, code, kiosk, err := s.resolveToken(ctx, token)
	if err != nil {
		return nil, err
	}
	menu, err := s.Menu(ctx, storeID, true)
	if err != nil {
		return nil, err
	}
	// only what the shop lets customers order by themselves
	items := menu.Items[:0]
	for _, it := range menu.Items {
		for _, ch := range it.Channels {
			if ch == string(domain.ChannelSelfOrder) {
				items = append(items, it)
				break
			}
		}
	}
	menu.Items = items
	out := &TableView{StoreID: storeID, TableCode: code, Menu: menu, Kiosk: kiosk}
	err = s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		st, err := s.stores.Get(ctx, storeID)
		if err != nil {
			return err
		}
		out.StoreName = st.Name
		if kiosk {
			r, err := s.repo.EnsureTableToken(ctx, storeID, code, false)
			if err != nil {
				return err
			}
			out.GuestToken = r.Token
		}
		out.Orders, err = s.repo.ListOrdersForTable(ctx, storeID, code)
		return err
	})
	if out.Orders == nil {
		out.Orders = []domain.Order{}
	}
	return out, err
}

// TableOrders is the table's open orders, for the phone that keeps watching its food.
func (s *Service) TableOrders(ctx context.Context, token string) ([]domain.Order, error) {
	storeID, code, _, err := s.resolveToken(ctx, token)
	if err != nil {
		return nil, err
	}
	var out []domain.Order
	err = s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		out, err = s.repo.ListOrdersForTable(ctx, storeID, code)
		return err
	})
	if out == nil {
		out = []domain.Order{}
	}
	return out, err
}

// TableCreateOrder is an order placed from the table itself. The channel and the table come
// from the token, never from the request, and only self-order items are accepted.
func (s *Service) TableCreateOrder(ctx context.Context, token string, lines []LineInput, note string) (*domain.Order, error) {
	storeID, code, _, err := s.resolveToken(ctx, token)
	if err != nil {
		return nil, err
	}
	menu, err := s.Menu(ctx, storeID, true)
	if err != nil {
		return nil, err
	}
	allowed := map[uuid.UUID]bool{}
	for _, it := range menu.Items {
		for _, ch := range it.Channels {
			if ch == string(domain.ChannelSelfOrder) {
				allowed[it.ID] = true
			}
		}
	}
	for _, l := range lines {
		if !allowed[l.MenuItemID] {
			return nil, domain.ErrMenuItemNotFound
		}
	}
	return s.CreateOrder(ctx, storeID, Actor{Name: "table " + code}, CreateOrderInput{Channel: domain.ChannelSelfOrder, TableCode: code, Note: note, Lines: lines})
}

// SubscribeTable is the table's own event feed: only its orders, plus the moment its customer
// code changes. The tablet hears the new code so it can show it; a customer's phone only hears
// that its session is over.
func (s *Service) SubscribeTable(ctx context.Context, token string) (<-chan Event, error) {
	storeID, code, kiosk, err := s.resolveToken(ctx, token)
	if err != nil {
		return nil, err
	}
	src := s.hub.Subscribe(ctx, storeID)
	out := make(chan Event, 16)
	go func() {
		defer close(out)
		for ev := range src {
			switch {
			case ev.Order != nil && ev.Order.TableCode == code:
			case ev.Table != nil && ev.Table.TableCode == code:
				if !kiosk {
					ev = Event{Kind: ev.Kind, Table: &TableToken{TableCode: code}}
				}
			default:
				continue
			}
			select {
			case out <- ev:
			default:
			}
		}
	}()
	return out, nil
}
