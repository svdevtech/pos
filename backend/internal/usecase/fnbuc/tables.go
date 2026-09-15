package fnbuc

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

// ---------------------------------------------------------------------------
// Tables in service: moving a party, merging two tables, splitting a bill
// ---------------------------------------------------------------------------

// MoveTable puts everything on one table onto another — a party moving, or two tables becoming
// one (the target may already be occupied; its orders simply gain company). The table left
// behind is free again, so its customer QR code is replaced.
func (s *Service) MoveTable(ctx context.Context, storeID uuid.UUID, actor Actor, from, to string) ([]domain.Order, error) {
	from, to = strings.TrimSpace(from), strings.TrimSpace(to)
	if from == "" || to == "" || from == to {
		return nil, domain.ErrValidation.With("field", "to")
	}
	var moved []uuid.UUID
	var rotated *TableToken
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		ok, err := s.repo.TableExists(ctx, storeID, to)
		if err != nil {
			return err
		}
		if !ok {
			return domain.ErrTableNotFound.With("code", to)
		}
		if moved, err = s.repo.MoveOrders(ctx, storeID, from, to); err != nil {
			return err
		}
		if len(moved) == 0 {
			return domain.ErrTableEmpty.With("code", from)
		}
		for _, id := range moved {
			if err := s.repo.InsertEvent(ctx, storeID, id, nil, "table:move", map[string]any{"from": from, "to": to}, actor.idPtr()); err != nil {
				return err
			}
		}
		r, err := s.repo.EnsureTableToken(ctx, storeID, from, true)
		if err != nil {
			return err
		}
		rotated = tokenOf(r)
		return nil
	})
	if err != nil {
		return nil, err
	}
	out := make([]domain.Order, 0, len(moved))
	for _, id := range moved {
		if o, err := s.Get(ctx, storeID, id); err == nil {
			out = append(out, *o)
			s.hub.Publish(storeID, Event{Kind: "updated", Order: o})
		}
	}
	s.hub.Publish(storeID, Event{Kind: "table", Table: rotated})
	return out, nil
}

// SplitLine names a line to take, and optionally how much of it (less than the line's
// quantity carves that much off into a line of its own; zero or the full quantity takes it whole).
type SplitLine struct {
	ItemID uuid.UUID       `json:"item_id"`
	Qty    decimal.Decimal `json:"qty,omitempty"`
}

// SplitOrder takes some of an order's lines — or part of a line's quantity — into a new order
// on the same table, so they can be paid on their own bill. The rest stays as it was.
func (s *Service) SplitOrder(ctx context.Context, storeID uuid.UUID, actor Actor, orderID uuid.UUID, lines []SplitLine) (*domain.Order, error) {
	if len(lines) == 0 {
		return nil, domain.ErrValidation.With("field", "item_ids")
	}
	var fresh *domain.Order
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		cur, err := s.repo.GetOrder(ctx, storeID, orderID)
		if err != nil {
			return err
		}
		if cur.Status != domain.OrderOpen {
			return domain.ErrOrderClosed
		}
		want := map[uuid.UUID]decimal.Decimal{}
		for _, l := range lines {
			want[l.ItemID] = l.Qty
		}
		var itemIDs []uuid.UUID
		live, taking, partial := 0, 0, 0
		for _, it := range cur.Items {
			if it.Status == domain.ItemVoid {
				continue
			}
			live++
			q, ok := want[it.ID]
			if !ok {
				continue
			}
			taking++
			if q.IsPositive() && q.LessThan(it.Qty) {
				// part of the line: carve it off first, then move the new line
				id, err := s.repo.SplitItem(ctx, storeID, it.ID, q.String())
				if err != nil {
					return err
				}
				itemIDs = append(itemIDs, id)
				partial++
				continue
			}
			itemIDs = append(itemIDs, it.ID)
		}
		if taking != len(want) {
			return domain.ErrOrderNotFound.With("field", "item_ids")
		}
		if taking == live && partial == 0 {
			return domain.ErrValidation.With("reason", "nothing left on the original order")
		}
		now := time.Now()
		no, err := s.repo.NextOrderNo(ctx, storeID, now)
		if err != nil {
			return err
		}
		fresh = &domain.Order{StoreID: storeID, OrderNo: no, Channel: cur.Channel, TableCode: cur.TableCode, Guests: cur.Guests, Status: domain.OrderOpen, Note: fmt.Sprintf("split from #%d", cur.OrderNo), CreatedBy: actor.idPtr()}
		if err := s.repo.InsertOrder(ctx, fresh); err != nil {
			return err
		}
		if _, err := s.repo.MoveItems(ctx, storeID, cur.ID, fresh.ID, itemIDs); err != nil {
			return err
		}
		if err := s.repo.InsertEvent(ctx, storeID, cur.ID, nil, "order:split", map[string]any{"to": fresh.ID, "items": len(itemIDs)}, actor.idPtr()); err != nil {
			return err
		}
		if err := s.repo.InsertEvent(ctx, storeID, fresh.ID, nil, "order:split-from", map[string]any{"from": cur.ID}, actor.idPtr()); err != nil {
			return err
		}
		fresh, err = s.repo.GetOrder(ctx, storeID, fresh.ID)
		return err
	})
	if err != nil {
		return nil, err
	}
	if o, err := s.Get(ctx, storeID, orderID); err == nil {
		s.hub.Publish(storeID, Event{Kind: "updated", Order: o})
	}
	s.hub.Publish(storeID, Event{Kind: "created", Order: fresh})
	return fresh, nil
}

// qrRequiresOpenTable is the shop's choice to take self-orders only from a table a member of
// staff has opened, so a photographed QR cannot order at an empty table from elsewhere.
func qrRequiresOpenTable(settings domain.StoreSettings) bool {
	if v, ok := settings["fnb"].(map[string]any); ok {
		if b, ok := v["qr_requires_open_table"].(bool); ok {
			return b
		}
	}
	return false
}
