package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/svdev/pos/internal/domain"
)

// ---------------------------------------------------------------------------
// Time-of-day promotions
// ---------------------------------------------------------------------------

const menuPromoCols = `id, store_id, name, kind, value::text, category_id, menu_item_id, days, start_time::text, end_time::text, starts_on, ends_on, is_active, sort`

func scanMenuPromo(row pgx.Row) (*domain.MenuPromo, error) {
	var p domain.MenuPromo
	var value string
	var days []int32
	if err := row.Scan(&p.ID, &p.StoreID, &p.Name, &p.Kind, &value, &p.CategoryID, &p.MenuItemID, &days, &p.StartTime, &p.EndTime, &p.StartsOn, &p.EndsOn, &p.IsActive, &p.Sort); err != nil {
		return nil, err
	}
	p.Value = dec(value)
	p.Days = make([]int, 0, len(days))
	for _, d := range days {
		p.Days = append(p.Days, int(d))
	}
	// "09:00:00" → "09:00"
	if len(p.StartTime) > 5 {
		p.StartTime = p.StartTime[:5]
	}
	if len(p.EndTime) > 5 {
		p.EndTime = p.EndTime[:5]
	}
	return &p, nil
}

func (FnbRepo) Promos(ctx context.Context, storeID uuid.UUID, activeOnly bool) ([]domain.MenuPromo, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT `+menuPromoCols+` FROM menu_promos WHERE store_id=$1 AND ($2 = false OR is_active) ORDER BY sort, name`, storeID, activeOnly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.MenuPromo{}
	for rows.Next() {
		p, err := scanMenuPromo(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

func (FnbRepo) UpsertPromo(ctx context.Context, p *domain.MenuPromo) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	days := make([]int32, 0, len(p.Days))
	for _, d := range p.Days {
		days = append(days, int32(d))
	}
	_, err := Q(ctx).Exec(ctx, `INSERT INTO menu_promos (id, store_id, name, kind, value, category_id, menu_item_id, days, start_time, end_time, starts_on, ends_on, is_active, sort)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::time,$10::time,$11,$12,$13,$14)
		ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, kind=EXCLUDED.kind, value=EXCLUDED.value, category_id=EXCLUDED.category_id, menu_item_id=EXCLUDED.menu_item_id,
			days=EXCLUDED.days, start_time=EXCLUDED.start_time, end_time=EXCLUDED.end_time, starts_on=EXCLUDED.starts_on, ends_on=EXCLUDED.ends_on, is_active=EXCLUDED.is_active, sort=EXCLUDED.sort, updated_at=now()`,
		p.ID, p.StoreID, p.Name, p.Kind, p.Value, p.CategoryID, p.MenuItemID, days, p.StartTime, p.EndTime, p.StartsOn, p.EndsOn, p.IsActive, p.Sort)
	return err
}

// ---------------------------------------------------------------------------
// Reservations and the waitlist
// ---------------------------------------------------------------------------

const reservationCols = `id, store_id, kind, name, COALESCE(phone,''), party_size, at, COALESCE(table_code,''), COALESCE(note,''), status, created_by, created_at`

func scanReservation(row pgx.Row) (*domain.Reservation, error) {
	var r domain.Reservation
	if err := row.Scan(&r.ID, &r.StoreID, &r.Kind, &r.Name, &r.Phone, &r.PartySize, &r.At, &r.TableCode, &r.Note, &r.Status, &r.CreatedBy, &r.CreatedAt); err != nil {
		return nil, err
	}
	return &r, nil
}

// Reservations lists the book for a day (bookings by time) plus every party still on the
// waitlist, whatever day it joined.
func (FnbRepo) Reservations(ctx context.Context, storeID uuid.UUID, dayStart, dayEnd time.Time) ([]domain.Reservation, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT `+reservationCols+` FROM fnb_reservations
		WHERE store_id=$1 AND ((at >= $2 AND at < $3) OR (kind='waitlist' AND status='waiting'))
		ORDER BY at`, storeID, dayStart, dayEnd)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Reservation{}
	for rows.Next() {
		r, err := scanReservation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

func (FnbRepo) GetReservation(ctx context.Context, storeID, id uuid.UUID) (*domain.Reservation, error) {
	r, err := scanReservation(Q(ctx).QueryRow(ctx, `SELECT `+reservationCols+` FROM fnb_reservations WHERE store_id=$1 AND id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return r, err
}

func (FnbRepo) UpsertReservation(ctx context.Context, r *domain.Reservation) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return Q(ctx).QueryRow(ctx, `INSERT INTO fnb_reservations (id, store_id, kind, name, phone, party_size, at, table_code, note, status, created_by)
		VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,NULLIF($8,''),NULLIF($9,''),$10,$11)
		ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, phone=EXCLUDED.phone, party_size=EXCLUDED.party_size, at=EXCLUDED.at, table_code=EXCLUDED.table_code,
			note=EXCLUDED.note, status=EXCLUDED.status, updated_at=now()
		RETURNING created_at`,
		r.ID, r.StoreID, r.Kind, r.Name, r.Phone, r.PartySize, r.At, r.TableCode, r.Note, r.Status, r.CreatedBy).Scan(&r.CreatedAt)
}

func (FnbRepo) SetReservationStatus(ctx context.Context, storeID, id uuid.UUID, status, tableCode string) error {
	tag, err := Q(ctx).Exec(ctx, `UPDATE fnb_reservations SET status=$3, table_code=COALESCE(NULLIF($4,''), table_code), updated_at=now() WHERE store_id=$1 AND id=$2`, storeID, id, status, tableCode)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// SplitItem carves `qty` off a line into a new line of its own (same dish, options, status and
// stock state; cost pro rata) and returns the new line's id. The stock movements stay with the
// original line.
func (FnbRepo) SplitItem(ctx context.Context, storeID, itemID uuid.UUID, qty string) (uuid.UUID, error) {
	var newID uuid.UUID
	err := Q(ctx).QueryRow(ctx, `WITH src AS (
			SELECT * FROM order_items WHERE store_id=$1 AND id=$2 AND qty > $3::numeric FOR UPDATE
		), ins AS (
			INSERT INTO order_items (store_id, order_id, menu_item_id, station_id, name, qty, unit_price, cost, seat, course, note, status, deducted, sort, sent_at, ready_at, served_at, promo_id, promo_name, list_price)
			SELECT store_id, order_id, menu_item_id, station_id, name, $3::numeric, unit_price, round(cost * $3::numeric / qty, 2), seat, course, note, status, deducted, sort, sent_at, ready_at, served_at, promo_id, promo_name, list_price FROM src
			RETURNING id
		), upd AS (
			UPDATE order_items o SET qty = o.qty - $3::numeric, cost = o.cost - round(o.cost * $3::numeric / o.qty, 2) FROM src WHERE o.id = src.id
		), mods AS (
			INSERT INTO order_item_modifiers (store_id, order_item_id, modifier_id, name, price_delta)
			SELECT m.store_id, ins.id, m.modifier_id, m.name, m.price_delta FROM order_item_modifiers m, ins WHERE m.order_item_id = $2
		)
		SELECT id FROM ins`, storeID, itemID, qty).Scan(&newID)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, domain.ErrValidation.With("field", "qty")
	}
	return newID, err
}
