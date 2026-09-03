package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
)

type ExpenseRepo struct{}

func (ExpenseRepo) ListTypes(ctx context.Context, storeID uuid.UUID) ([]domain.ExpenseType, error) {
	rows, err := Q(ctx).Query(ctx, `SELECT id, name, COALESCE(name_en,''), is_active FROM expense_types WHERE store_id=$1 ORDER BY name`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.ExpenseType{}
	for rows.Next() {
		var t domain.ExpenseType
		if err := rows.Scan(&t.ID, &t.Name, &t.NameEN, &t.IsActive); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (ExpenseRepo) CreateType(ctx context.Context, storeID uuid.UUID, t *domain.ExpenseType) error {
	err := Q(ctx).QueryRow(ctx, `INSERT INTO expense_types (store_id, name, name_en, is_active) VALUES ($1,$2,NULLIF($3,''),$4) RETURNING id`, storeID, t.Name, t.NameEN, t.IsActive).Scan(&t.ID)
	if isUniqueViolation(err) {
		return domain.ErrConflict.With("field", "name")
	}
	return err
}

func (ExpenseRepo) UpdateType(ctx context.Context, storeID uuid.UUID, t *domain.ExpenseType) error {
	tag, err := Q(ctx).Exec(ctx, `UPDATE expense_types SET name=$3, name_en=NULLIF($4,''), is_active=$5 WHERE store_id=$1 AND id=$2`, storeID, t.ID, t.Name, t.NameEN, t.IsActive)
	if err == nil && tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	if isUniqueViolation(err) {
		return domain.ErrConflict.With("field", "name")
	}
	return err
}

const expenseCols = `e.id, e.type_id, COALESCE(t.name,''), e.expensed_at, e.amount::text, COALESCE(e.note,''), e.paid_from::text, e.shift_id, e.created_by, COALESCE(e.created_by_name,''), e.created_at`

func scanExpense(row pgx.Row) (*domain.Expense, error) {
	var e domain.Expense
	var amt, pf string
	var d time.Time
	if err := row.Scan(&e.ID, &e.TypeID, &e.TypeName, &d, &amt, &e.Note, &pf, &e.ShiftID, &e.CreatedBy, &e.CreatedByName, &e.CreatedAt); err != nil {
		return nil, err
	}
	e.ExpensedAt, e.Amount, e.PaidFrom = d, dec(amt), domain.PaymentMethod(pf)
	return &e, nil
}

func (ExpenseRepo) Insert(ctx context.Context, storeID uuid.UUID, e *domain.Expense) error {
	return Q(ctx).QueryRow(ctx, `INSERT INTO expenses (store_id, type_id, expensed_at, amount, note, paid_from, shift_id, created_by, created_by_name)
		VALUES ($1,$2,$3,$4,NULLIF($5,''),$6::payment_method,$7,$8,NULLIF($9,'')) RETURNING id, created_at`,
		storeID, e.TypeID, e.ExpensedAt, e.Amount, e.Note, string(e.PaidFrom), e.ShiftID, e.CreatedBy, e.CreatedByName).Scan(&e.ID, &e.CreatedAt)
}

func (ExpenseRepo) Get(ctx context.Context, storeID, id uuid.UUID) (*domain.Expense, error) {
	e, err := scanExpense(Q(ctx).QueryRow(ctx, `SELECT `+expenseCols+` FROM expenses e LEFT JOIN expense_types t ON t.id=e.type_id WHERE e.store_id=$1 AND e.id=$2`, storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return e, err
}

func (ExpenseRepo) Update(ctx context.Context, storeID uuid.UUID, e *domain.Expense) error {
	tag, err := Q(ctx).Exec(ctx, `UPDATE expenses SET type_id=$3, expensed_at=$4, amount=$5, note=NULLIF($6,''), paid_from=$7::payment_method WHERE store_id=$1 AND id=$2`,
		storeID, e.ID, e.TypeID, e.ExpensedAt, e.Amount, e.Note, string(e.PaidFrom))
	if err == nil && tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return err
}

func (ExpenseRepo) Delete(ctx context.Context, storeID, id uuid.UUID) error {
	tag, err := Q(ctx).Exec(ctx, `DELETE FROM expenses WHERE store_id=$1 AND id=$2`, storeID, id)
	if err == nil && tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return err
}

type ExpenseFilter struct {
	From, To *time.Time
	TypeID   *uuid.UUID
	Limit    int
	Offset   int
}

func (ExpenseRepo) List(ctx context.Context, storeID uuid.UUID, f ExpenseFilter) ([]domain.Expense, int64, decimal.Decimal, error) {
	where := []string{"e.store_id=$1"}
	args := []any{storeID}
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, fmt.Sprintf(cond, len(args)))
	}
	if f.From != nil {
		add("e.expensed_at>=$%d", f.From.Format("2006-01-02"))
	}
	if f.To != nil {
		add("e.expensed_at<$%d", f.To.Format("2006-01-02"))
	}
	if f.TypeID != nil {
		add("e.type_id=$%d", *f.TypeID)
	}
	w := strings.Join(where, " AND ")
	var total int64
	var sum string
	if err := Q(ctx).QueryRow(ctx, `SELECT count(*), COALESCE(sum(e.amount),0)::text FROM expenses e WHERE `+w, args...).Scan(&total, &sum); err != nil {
		return nil, 0, decimal.Zero, err
	}
	args = append(args, f.Limit, f.Offset)
	rows, err := Q(ctx).Query(ctx, `SELECT `+expenseCols+` FROM expenses e LEFT JOIN expense_types t ON t.id=e.type_id WHERE `+w+
		fmt.Sprintf(` ORDER BY e.expensed_at DESC, e.created_at DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		return nil, 0, decimal.Zero, err
	}
	defer rows.Close()
	out := []domain.Expense{}
	for rows.Next() {
		e, err := scanExpense(rows)
		if err != nil {
			return nil, 0, decimal.Zero, err
		}
		out = append(out, *e)
	}
	return out, total, dec(sum), rows.Err()
}
