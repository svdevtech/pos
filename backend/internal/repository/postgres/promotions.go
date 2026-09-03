package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/svdev/pos/internal/domain"
)

type PromoRepo struct{}

const promoCols = `p.id, p.name, p.scope::text, p.product_id, COALESCE(pr.name,''), p.min_qty::text, p.min_amount::text, p.discount_type::text, p.discount_value::text, p.free_qty::text, p.starts_at, p.ends_at, p.is_active`

func scanPromo(row pgx.Row) (*domain.Promotion, error) {
	var p domain.Promotion
	var mq, ma, dv, fq string
	if err := row.Scan(&p.ID, &p.Name, &p.Scope, &p.ProductID, &p.ProductName, &mq, &ma, &p.DiscountType, &dv, &fq, &p.StartsAt, &p.EndsAt, &p.IsActive); err != nil {
		return nil, err
	}
	p.MinQty, p.MinAmount, p.DiscountValue, p.FreeQty = dec(mq), dec(ma), dec(dv), dec(fq)
	return &p, nil
}

func (PromoRepo) List(ctx context.Context, storeID uuid.UUID, activeOnly bool, at time.Time) ([]domain.Promotion, error) {
	q := `SELECT ` + promoCols + ` FROM promotions p LEFT JOIN products pr ON pr.id=p.product_id WHERE p.store_id=$1`
	args := []any{storeID}
	if activeOnly {
		q += ` AND p.is_active AND (p.starts_at IS NULL OR p.starts_at<=$2) AND (p.ends_at IS NULL OR p.ends_at>=$2)`
		args = append(args, at)
	}
	q += ` ORDER BY p.scope, p.name`
	rows, err := Q(ctx).Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Promotion{}
	for rows.Next() {
		p, err := scanPromo(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

func (PromoRepo) Get(ctx context.Context, storeID, id uuid.UUID) (*domain.Promotion, error) {
	p, err := scanPromo(Q(ctx).QueryRow(ctx, `SELECT `+promoCols+` FROM promotions p LEFT JOIN products pr ON pr.id=p.product_id WHERE p.store_id=$1 AND p.id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return p, err
}

func (PromoRepo) Insert(ctx context.Context, storeID uuid.UUID, p *domain.Promotion) error {
	return Q(ctx).QueryRow(ctx, `INSERT INTO promotions (store_id, name, scope, product_id, min_qty, min_amount, discount_type, discount_value, free_qty, starts_at, ends_at, is_active)
		VALUES ($1,$2,$3::promo_scope,$4,$5,$6,$7::discount_type,$8,$9,$10,$11,$12) RETURNING id`,
		storeID, p.Name, p.Scope, p.ProductID, p.MinQty, p.MinAmount, p.DiscountType, p.DiscountValue, p.FreeQty, p.StartsAt, p.EndsAt, p.IsActive).Scan(&p.ID)
}

func (PromoRepo) Update(ctx context.Context, storeID uuid.UUID, p *domain.Promotion) error {
	tag, err := Q(ctx).Exec(ctx, `UPDATE promotions SET name=$3, scope=$4::promo_scope, product_id=$5, min_qty=$6, min_amount=$7, discount_type=$8::discount_type, discount_value=$9, free_qty=$10, starts_at=$11, ends_at=$12, is_active=$13
		WHERE store_id=$1 AND id=$2`, storeID, p.ID, p.Name, p.Scope, p.ProductID, p.MinQty, p.MinAmount, p.DiscountType, p.DiscountValue, p.FreeQty, p.StartsAt, p.EndsAt, p.IsActive)
	if err == nil && tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return err
}

func (PromoRepo) Delete(ctx context.Context, storeID, id uuid.UUID) error {
	tag, err := Q(ctx).Exec(ctx, `DELETE FROM promotions WHERE store_id=$1 AND id=$2`, storeID, id)
	if err == nil && tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return err
}
