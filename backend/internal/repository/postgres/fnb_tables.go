package postgres

import (
	"context"

	"github.com/google/uuid"
)

// TableExists says whether the store has an active table with that code.
func (FnbRepo) TableExists(ctx context.Context, storeID uuid.UUID, code string) (bool, error) {
	var ok bool
	err := Q(ctx).QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM fnb_tables WHERE store_id=$1 AND code=$2 AND is_active)`, storeID, code).Scan(&ok)
	return ok, err
}

// MoveOrders puts every live order of one table on another and returns their ids.
func (FnbRepo) MoveOrders(ctx context.Context, storeID uuid.UUID, from, to string) ([]uuid.UUID, error) {
	rows, err := Q(ctx).Query(ctx, `UPDATE orders SET table_code=$3 WHERE store_id=$1 AND table_code=$2 AND status IN ('open','paid') RETURNING id`, storeID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// MoveItems hands the given lines of one order to another (a bill being split).
func (FnbRepo) MoveItems(ctx context.Context, storeID, from, to uuid.UUID, itemIDs []uuid.UUID) (int64, error) {
	tag, err := Q(ctx).Exec(ctx, `UPDATE order_items SET order_id=$3 WHERE store_id=$1 AND order_id=$2 AND id = ANY($4)`, storeID, from, to, itemIDs)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// LiveOrderCount is how many open or paid orders a table has — zero means nobody is on it.
func (FnbRepo) LiveOrderCount(ctx context.Context, storeID uuid.UUID, tableCode string) (int, error) {
	var n int
	err := Q(ctx).QueryRow(ctx, `SELECT count(*) FROM orders WHERE store_id=$1 AND table_code=$2 AND status IN ('open','paid')`, storeID, tableCode).Scan(&n)
	return n, err
}
