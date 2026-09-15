package postgres

import (
	"context"

	"github.com/google/uuid"

	"github.com/svdev/pos/internal/domain"
)

// ---------------------------------------------------------------------------
// The dining room: zones and tables
// ---------------------------------------------------------------------------

func (FnbRepo) Zones(ctx context.Context, storeID uuid.UUID, activeOnly bool) ([]domain.FloorZone, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT id, store_id, name, COALESCE(name_en,''), color, sort, is_active FROM fnb_zones
		WHERE store_id=$1 AND ($2 = false OR is_active) ORDER BY sort, name`, storeID, activeOnly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.FloorZone{}
	for rows.Next() {
		var z domain.FloorZone
		if err := rows.Scan(&z.ID, &z.StoreID, &z.Name, &z.NameEn, &z.Color, &z.Sort, &z.IsActive); err != nil {
			return nil, err
		}
		out = append(out, z)
	}
	return out, rows.Err()
}

func (FnbRepo) UpsertZone(ctx context.Context, z *domain.FloorZone) error {
	if z.ID == uuid.Nil {
		z.ID = uuid.New()
	}
	_, err := Q(ctx).Exec(ctx, `INSERT INTO fnb_zones (id, store_id, name, name_en, color, sort, is_active)
		VALUES ($1,$2,$3,NULLIF($4,''),$5,$6,$7)
		ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, name_en=EXCLUDED.name_en, color=EXCLUDED.color, sort=EXCLUDED.sort, is_active=EXCLUDED.is_active, updated_at=now()`,
		z.ID, z.StoreID, z.Name, z.NameEn, z.Color, z.Sort, z.IsActive)
	return err
}

func (FnbRepo) Tables(ctx context.Context, storeID uuid.UUID, activeOnly bool) ([]domain.FloorTable, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT id, store_id, zone_id, code, seats, x::text, y::text, shape, rotation, sort, is_active FROM fnb_tables
		WHERE store_id=$1 AND ($2 = false OR is_active) ORDER BY sort, length(code), code`, storeID, activeOnly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.FloorTable{}
	for rows.Next() {
		var t domain.FloorTable
		var x, y string
		if err := rows.Scan(&t.ID, &t.StoreID, &t.ZoneID, &t.Code, &t.Seats, &x, &y, &t.Shape, &t.Rotation, &t.Sort, &t.IsActive); err != nil {
			return nil, err
		}
		t.X, t.Y = dec(x), dec(y)
		out = append(out, t)
	}
	return out, rows.Err()
}

// UpsertTable saves a table; a second table with the same code in the store is refused.
func (FnbRepo) UpsertTable(ctx context.Context, t *domain.FloorTable) error {
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	var clash bool
	if err := Q(ctx).QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM fnb_tables WHERE store_id=$1 AND code=$2 AND id<>$3)`, t.StoreID, t.Code, t.ID).Scan(&clash); err != nil {
		return err
	}
	if clash {
		return domain.ErrTableCodeTaken.With("code", t.Code)
	}
	_, err := Q(ctx).Exec(ctx, `INSERT INTO fnb_tables (id, store_id, zone_id, code, seats, x, y, shape, rotation, sort, is_active)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (id) DO UPDATE SET zone_id=EXCLUDED.zone_id, code=EXCLUDED.code, seats=EXCLUDED.seats, x=EXCLUDED.x, y=EXCLUDED.y,
			shape=EXCLUDED.shape, rotation=EXCLUDED.rotation, sort=EXCLUDED.sort, is_active=EXCLUDED.is_active, updated_at=now()`,
		t.ID, t.StoreID, t.ZoneID, t.Code, t.Seats, t.X, t.Y, t.Shape, t.Rotation, t.Sort, t.IsActive)
	return err
}

// SetOrderPaid records the bill that settled an order.
func (FnbRepo) SetOrderPaid(ctx context.Context, storeID, id, saleID uuid.UUID) error {
	tag, err := Q(ctx).Exec(ctx, `UPDATE orders SET status='paid', sale_id=$3 WHERE store_id=$1 AND id=$2`, storeID, id, saleID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrOrderNotFound
	}
	return nil
}
