package salesuc

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/promptpay"
	"github.com/svdev/pos/internal/repository/postgres"
)

// PaymentQR is what the till shows the customer: the code to scan plus enough text for the
// cashier to confirm out loud which account the money is going to.
type PaymentQR struct {
	Payload      string          `json:"payload"`
	Amount       decimal.Decimal `json:"amount"`
	Kind         string          `json:"kind"`          // phone | national_id | ewallet
	MaskedID     string          `json:"masked_id"`     // 08x-xxx-5678
	MerchantName string          `json:"merchant_name"` // ASCII name carried in the code, may be empty
	StoreName    string          `json:"store_name"`
}

// maskID hides the middle of the account number; the last four digits are what a customer checks.
func maskID(raw string) string {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, raw)
	if len(digits) <= 4 {
		return digits
	}
	return strings.Repeat("x", len(digits)-4) + digits[len(digits)-4:]
}

// PaymentQRFor builds the PromptPay code for one amount using the store's configured account.
func (s *Service) PaymentQRFor(ctx context.Context, storeID uuid.UUID, amount decimal.Decimal) (*PaymentQR, error) {
	var out *PaymentQR
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		settings, err := s.stores.GetSettings(ctx, storeID)
		if err != nil {
			return err
		}
		raw, _ := settings["promptpay_id"].(string)
		if strings.TrimSpace(raw) == "" {
			return domain.ErrPromptPayUnset
		}
		target, err := promptpay.ParseTarget(raw)
		if err != nil {
			return domain.ErrPromptPayUnset
		}
		name, _ := settings["promptpay_name"].(string)
		store, err := s.stores.Get(ctx, storeID)
		if err != nil {
			return err
		}
		payload, err := promptpay.Payload(target, amount, name)
		if err != nil {
			return domain.ErrValidation.With("field", "amount")
		}
		out = &PaymentQR{Payload: payload, Amount: amount.Round(2), Kind: target.Kind,
			MaskedID: maskID(raw), MerchantName: name, StoreName: store.Name}
		return nil
	})
	return out, err
}
