// Package domain holds the core entities and errors shared by all use cases.
package domain

import (
	"errors"
	"fmt"
	"net/http"
)

// Error is a machine-readable application error. Code maps to a localized message in internal/i18n.
type Error struct {
	Code   string         `json:"code"`
	Status int            `json:"-"`
	Params map[string]any `json:"params,omitempty"`
	Cause  error          `json:"-"`
}

func (e *Error) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %v", e.Code, e.Cause)
	}
	return e.Code
}

func (e *Error) Unwrap() error { return e.Cause }

// Is matches errors by code so that errors.Is(err.With(...), ErrX) holds.
func (e *Error) Is(target error) bool {
	t, ok := target.(*Error)
	return ok && t.Code == e.Code
}

func (e *Error) With(k string, v any) *Error {
	cp := *e
	cp.Params = map[string]any{}
	for kk, vv := range e.Params {
		cp.Params[kk] = vv
	}
	cp.Params[k] = v
	return &cp
}

func (e *Error) Wrap(cause error) *Error {
	cp := *e
	cp.Cause = cause
	return &cp
}

func NewError(code string, status int) *Error { return &Error{Code: code, Status: status} }

// AsError extracts a *Error from err, or wraps unknown errors as INTERNAL.
func AsError(err error) *Error {
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	return ErrInternal.Wrap(err)
}

var (
	ErrInternal        = NewError("INTERNAL", http.StatusInternalServerError)
	ErrValidation      = NewError("VALIDATION", http.StatusBadRequest)
	ErrBadRequest      = NewError("BAD_REQUEST", http.StatusBadRequest)
	ErrUnauthorized    = NewError("UNAUTHORIZED", http.StatusUnauthorized)
	ErrForbidden       = NewError("FORBIDDEN", http.StatusForbidden)
	ErrNotFound        = NewError("NOT_FOUND", http.StatusNotFound)
	ErrConflict        = NewError("CONFLICT", http.StatusConflict)
	ErrRateLimited     = NewError("RATE_LIMITED", http.StatusTooManyRequests)
	ErrFeatureDisabled = NewError("FEATURE_DISABLED", http.StatusServiceUnavailable)

	ErrLoginFailed      = NewError("AUTH_LOGIN_FAILED", http.StatusUnauthorized)
	ErrUserDisabled     = NewError("AUTH_USER_DISABLED", http.StatusForbidden)
	ErrStoreInactive    = NewError("AUTH_STORE_INACTIVE", http.StatusForbidden)
	ErrTokenInvalid     = NewError("AUTH_TOKEN_INVALID", http.StatusUnauthorized)
	ErrPasswordWeak     = NewError("AUTH_PASSWORD_WEAK", http.StatusBadRequest)
	ErrPasswordMismatch = NewError("AUTH_PASSWORD_MISMATCH", http.StatusBadRequest)
	ErrStoreRequired    = NewError("TENANT_STORE_REQUIRED", http.StatusBadRequest)

	ErrProductNotFound = NewError("PRODUCT_NOT_FOUND", http.StatusNotFound)
	ErrBarcodeNotFound = NewError("BARCODE_NOT_FOUND", http.StatusNotFound)
	ErrBarcodeExists   = NewError("BARCODE_EXISTS", http.StatusConflict)
	ErrSKUExists       = NewError("SKU_EXISTS", http.StatusConflict)
	ErrProductArchived = NewError("PRODUCT_ARCHIVED", http.StatusBadRequest)

	ErrMemberNotFound    = NewError("MEMBER_NOT_FOUND", http.StatusNotFound)
	ErrMemberCodeExists  = NewError("MEMBER_CODE_EXISTS", http.StatusConflict)
	ErrMemberLinked      = NewError("MEMBER_ALREADY_LINKED", http.StatusConflict)
	ErrLinkCodeInvalid   = NewError("MEMBER_LINK_CODE_INVALID", http.StatusBadRequest)
	ErrShareInsufficient = NewError("MEMBER_SHARE_INSUFFICIENT", http.StatusBadRequest)

	ErrSaleEmpty             = NewError("SALE_EMPTY", http.StatusBadRequest)
	ErrSaleNotFound          = NewError("SALE_NOT_FOUND", http.StatusNotFound)
	ErrSaleAlreadyCancelled  = NewError("SALE_ALREADY_CANCELLED", http.StatusConflict)
	ErrSalePaymentShort      = NewError("SALE_PAYMENT_SHORT", http.StatusBadRequest)
	ErrSaleCreditNeedsMember = NewError("SALE_CREDIT_NEEDS_MEMBER", http.StatusBadRequest)
	ErrSaleSerialRequired    = NewError("SALE_SERIAL_REQUIRED", http.StatusBadRequest)
	ErrStockInsufficient     = NewError("STOCK_INSUFFICIENT", http.StatusBadRequest)
	ErrShiftNotOpen          = NewError("SHIFT_NOT_OPEN", http.StatusBadRequest)
	ErrShiftAlreadyOpen      = NewError("SHIFT_ALREADY_OPEN", http.StatusConflict)
	ErrReturnExceeds         = NewError("RETURN_EXCEEDS_SOLD", http.StatusBadRequest)

	ErrARNothingDue = NewError("AR_NOTHING_DUE", http.StatusBadRequest)
	ErrAROverpay    = NewError("AR_OVERPAY", http.StatusBadRequest)

	ErrReceiptNotFound  = NewError("RECEIPT_NOT_FOUND", http.StatusNotFound)
	ErrStockTakeClosed  = NewError("STOCKTAKE_CLOSED", http.StatusConflict)
	ErrReceiptCancelled = NewError("RECEIPT_ALREADY_CANCELLED", http.StatusConflict)

	ErrDividendPeriodExists  = NewError("DIVIDEND_PERIOD_EXISTS", http.StatusConflict)
	ErrDividendNotFound      = NewError("DIVIDEND_NOT_FOUND", http.StatusNotFound)
	ErrDividendLocked        = NewError("DIVIDEND_LOCKED", http.StatusConflict)
	ErrDividendBadTransition = NewError("DIVIDEND_BAD_TRANSITION", http.StatusConflict)
	ErrDividendNoRun         = NewError("DIVIDEND_NO_RUN", http.StatusBadRequest)
	ErrDividendCriteria      = NewError("DIVIDEND_CRITERIA_INVALID", http.StatusBadRequest)
	ErrDividendNotApproved   = NewError("DIVIDEND_NOT_APPROVED", http.StatusConflict)
	ErrDividendPayoutExceeds = NewError("DIVIDEND_PAYOUT_EXCEEDS", http.StatusBadRequest)

	ErrAIUnsafeSQL = NewError("AI_UNSAFE_SQL", http.StatusBadRequest)
	ErrAIUpstream  = NewError("AI_UPSTREAM", http.StatusBadGateway)

	ErrImportManifest = NewError("IMPORT_MANIFEST_INVALID", http.StatusBadRequest)

	ErrMemberInactive = NewError("MEMBER_INACTIVE", http.StatusForbidden)
	ErrLineUpstream   = NewError("LINE_UPSTREAM", http.StatusBadGateway)
)
