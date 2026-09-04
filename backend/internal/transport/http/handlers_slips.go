package httptransport

import (
	"encoding/base64"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/shopspring/decimal"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/usecase/salesuc"
)

// Payment QR + slip photographs. The till shows a PromptPay code, the customer pays with their
// banking app, and the cashier photographs the confirmation slip so a manager can check it later.

func (s *Server) mountSlips(r chi.Router) {
	r.With(requireRole(rolesSell...)).Get("/payment-qr", func(w http.ResponseWriter, r *http.Request) {
		amount := decimal.Zero
		if v := strings.TrimSpace(queryStr(r, "amount")); v != "" {
			a, err := decimal.NewFromString(v)
			if err != nil {
				fail(w, r, domain.ErrValidation.With("field", "amount"))
				return
			}
			amount = a
		}
		out, err := s.Sales.PaymentQRFor(r.Context(), storeID(r), amount)
		if err != nil {
			fail(w, r, err)
			return
		}
		ok(w, out)
	})

	r.Route("/slips", func(r chi.Router) {
		// the manager's queue of slips nobody has checked yet
		r.With(requireRole(rolesManage...)).Get("/pending", func(w http.ResponseWriter, r *http.Request) {
			page, size := paging(r)
			items, total, err := s.Sales.PendingSlips(r.Context(), storeID(r), size, (page-1)*size)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, Page[domain.PaymentSlip]{Items: items, Total: total, Page: page, PageSize: size})
		})
		r.With(requireRole(rolesAll...)).Get("/{id}/image", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			img, mime, err := s.Sales.SlipImage(r.Context(), storeID(r), id)
			if err != nil {
				fail(w, r, err)
				return
			}
			w.Header().Set("Content-Type", mime)
			w.Header().Set("Content-Length", strconv.Itoa(len(img)))
			w.Header().Set("Cache-Control", "private, max-age=300")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(img)
		})
		r.With(requireRole(rolesManage...)).Post("/{id}/verify", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			in := struct {
				Verified *bool `json:"verified"`
			}{}
			_ = decode(r, &in)
			verified := in.Verified == nil || *in.Verified
			out, err := s.Sales.SetSlipVerified(r.Context(), salesActor(r), storeID(r), id, verified)
			if err != nil {
				fail(w, r, err)
				return
			}
			ok(w, out)
		})
		r.With(requireRole(rolesManage...)).Delete("/{id}", func(w http.ResponseWriter, r *http.Request) {
			id, err := uuidParam(r, "id")
			if err != nil {
				fail(w, r, err)
				return
			}
			if err := s.Sales.DeleteSlip(r.Context(), salesActor(r), storeID(r), id); err != nil {
				fail(w, r, err)
				return
			}
			ok(w, map[string]any{"deleted": true})
		})
	})
}

// mountSaleSlips hangs the per-sale routes under /sales/{id}.
func (s *Server) mountSaleSlips(r chi.Router) {
	r.With(requireRole(rolesAll...)).Get("/slips", func(w http.ResponseWriter, r *http.Request) {
		id, err := uuidParam(r, "id")
		if err != nil {
			fail(w, r, err)
			return
		}
		out, err := s.Sales.SlipsOfSale(r.Context(), storeID(r), id)
		if err != nil {
			fail(w, r, err)
			return
		}
		ok(w, out)
	})
	r.With(requireRole(rolesSell...)).Post("/slips", func(w http.ResponseWriter, r *http.Request) {
		saleID, err := uuidParam(r, "id")
		if err != nil {
			fail(w, r, err)
			return
		}
		in, err := readSlipUpload(r)
		if err != nil {
			fail(w, r, err)
			return
		}
		in.SaleID = saleID
		out, err := s.Sales.AttachSlip(r.Context(), salesActor(r), storeID(r), in)
		if err != nil {
			fail(w, r, err)
			return
		}
		created(w, out)
	})
}

// readSlipUpload accepts either a multipart form (a phone's file picker) or JSON with a data URL
// (what the in-page camera produces). Both are common, and the till may be offline-ish and retry.
func readSlipUpload(r *http.Request) (salesuc.SlipInput, error) {
	var in salesuc.SlipInput
	ct := r.Header.Get("Content-Type")

	if strings.HasPrefix(ct, "multipart/form-data") {
		if err := r.ParseMultipartForm(int64(salesuc.MaxSlipBytes) + 1<<20); err != nil {
			return in, domain.ErrValidation.With("field", "image")
		}
		file, hdr, err := r.FormFile("image")
		if err != nil {
			return in, domain.ErrValidation.With("field", "image")
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, int64(salesuc.MaxSlipBytes)+1))
		if err != nil {
			return in, domain.ErrValidation.With("field", "image")
		}
		in.Image = data
		in.Mime = hdr.Header.Get("Content-Type")
		in.Method = r.FormValue("method")
		in.Note = r.FormValue("note")
		if v := strings.TrimSpace(r.FormValue("amount")); v != "" {
			if a, err := decimal.NewFromString(v); err == nil {
				in.Amount = a
			}
		}
		return in, nil
	}

	body := struct {
		Image  string `json:"image"` // raw base64 or a data: URL
		Mime   string `json:"mime"`
		Method string `json:"method"`
		Note   string `json:"note"`
		Amount string `json:"amount"`
	}{}
	if err := decode(r, &body); err != nil {
		return in, err
	}
	raw := body.Image
	mime := body.Mime
	if strings.HasPrefix(raw, "data:") {
		if i := strings.Index(raw, ","); i > 0 {
			head := raw[5:i]
			raw = raw[i+1:]
			if j := strings.Index(head, ";"); j > 0 {
				head = head[:j]
			}
			if mime == "" {
				mime = head
			}
		}
	}
	data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return in, domain.ErrValidation.With("field", "image")
	}
	in.Image, in.Mime, in.Method, in.Note = data, mime, body.Method, body.Note
	if v := strings.TrimSpace(body.Amount); v != "" {
		if a, err := decimal.NewFromString(v); err == nil {
			in.Amount = a
		}
	}
	return in, nil
}
