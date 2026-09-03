package httptransport

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/i18n"
)

const maxBody = 4 << 20 // 4 MiB

// ErrorBody is the JSON error envelope: {"error":{"code":..., "message":..., "params":{...}}}
type ErrorBody struct {
	Error ErrorDetail `json:"error"`
}

type ErrorDetail struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Params  map[string]any    `json:"params,omitempty"`
	Fields  map[string]string `json:"fields,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	_ = json.NewEncoder(w).Encode(v)
}

func ok(w http.ResponseWriter, v any)      { writeJSON(w, http.StatusOK, v) }
func created(w http.ResponseWriter, v any) { writeJSON(w, http.StatusCreated, v) }
func noContent(w http.ResponseWriter)      { w.WriteHeader(http.StatusNoContent) }

func localeOf(r *http.Request) i18n.Locale {
	if l := r.URL.Query().Get("lang"); l == "en" || l == "th" {
		return i18n.Locale(l)
	}
	if l := r.Header.Get("X-Locale"); l == "en" || l == "th" {
		return i18n.Locale(l)
	}
	return i18n.FromAcceptLanguage(r.Header.Get("Accept-Language"), i18n.TH)
}

// fail writes a localized error envelope.
func fail(w http.ResponseWriter, r *http.Request, err error) {
	e := domain.AsError(err)
	if e.Status >= 500 {
		slog.Error("request failed", "path", r.URL.Path, "err", err)
	}
	body := ErrorBody{Error: ErrorDetail{
		Code:    e.Code,
		Message: i18n.Message(localeOf(r), e.Code, e.Params),
		Params:  e.Params,
	}}
	var ve *ValidationError
	if errors.As(err, &ve) {
		body.Error.Fields = ve.Fields
	}
	writeJSON(w, e.Status, body)
}

// ValidationError carries per-field messages; it wraps domain.ErrValidation.
type ValidationError struct {
	Fields map[string]string
}

func (v *ValidationError) Error() string { return "validation failed" }
func (v *ValidationError) Unwrap() error { return domain.ErrValidation }

func validation(field, msg string) error {
	return &ValidationError{Fields: map[string]string{field: msg}}
}

func decode(r *http.Request, dst any) error {
	body := http.MaxBytesReader(nil, r.Body, maxBody)
	defer body.Close()
	dec := json.NewDecoder(body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		if errors.Is(err, io.EOF) {
			return domain.ErrBadRequest.With("reason", "empty body")
		}
		return domain.ErrBadRequest.With("reason", err.Error())
	}
	return nil
}

func uuidParam(r *http.Request, name string) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, name))
	if err != nil {
		return uuid.Nil, domain.ErrBadRequest.With("reason", "invalid id")
	}
	return id, nil
}

func queryInt(r *http.Request, name string, def int) int {
	if v, err := strconv.Atoi(r.URL.Query().Get(name)); err == nil {
		return v
	}
	return def
}

func queryStr(r *http.Request, name string) string { return r.URL.Query().Get(name) }

// Page is the standard list envelope.
type Page[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"page_size"`
}

func paging(r *http.Request) (page, size int) {
	page = queryInt(r, "page", 1)
	size = queryInt(r, "page_size", 50)
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 500 {
		size = 50
	}
	return
}
